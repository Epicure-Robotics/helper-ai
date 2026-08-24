import { eq } from "drizzle-orm";
import webpush from "web-push";
import { db } from "@/db/client";
import { pushSubscriptions } from "@/db/schema";
import { env } from "@/lib/env";
import { captureExceptionAndLog } from "@/lib/shared/sentry";

export type PushPayload = {
  title: string;
  body: string;
  actionUrl?: string;
  conversationId?: number;
  notificationId?: number;
};

export type PushDeliveryResult = {
  subscriptionId: number;
  success: boolean;
  /** Set when the push service rejected the endpoint for good and the row was removed. */
  expired?: boolean;
  error?: string;
};

export const isWebPushConfigured = () => !!(env.VAPID_PRIVATE_KEY && env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);

/** Push services require a contact address so they can reach the sender about a misbehaving app. */
const vapidContact = () => {
  if (!env.VAPID_MAILTO) return `mailto:noreply@${new URL(env.AUTH_URL).hostname}`;
  return env.VAPID_MAILTO.startsWith("mailto:") ? env.VAPID_MAILTO : `mailto:${env.VAPID_MAILTO}`;
};

/**
 * Fans a notification out to every device one employee has registered.
 *
 * `push_subscriptions` holds one row per (userId, endpoint): the endpoint identifies the browser
 * install, so the same person on a laptop and a phone is two rows, and two people sharing a laptop
 * are also two rows. Selecting by `userId` therefore reaches exactly that employee's devices and
 * nobody else's.
 *
 * A 404/410 from the push service means the endpoint is permanently gone (browser uninstalled, data
 * cleared), so the row is deleted rather than retried — otherwise dead devices accumulate forever
 * and every send pays for them.
 */
export const sendPushToUser = async (userId: string, payload: PushPayload): Promise<PushDeliveryResult[]> => {
  if (!isWebPushConfigured()) return [];

  webpush.setVapidDetails(vapidContact(), env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);

  const subscriptions = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));

  return Promise.all(
    subscriptions.map(async (subscription): Promise<PushDeliveryResult> => {
      try {
        await webpush.sendNotification(
          { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
          JSON.stringify(payload),
        );

        await db
          .update(pushSubscriptions)
          .set({ lastUsedAt: new Date() })
          .where(eq(pushSubscriptions.id, subscription.id));

        return { subscriptionId: subscription.id, success: true };
      } catch (error: any) {
        // 404/410 from the push service: the endpoint is permanently gone.
        // ERR_CRYPTO_*: the stored p256dh/auth pair cannot encrypt at all, so web-push throws before
        // any request is made and there is no status code — retrying can never succeed either.
        const gone = error?.statusCode === 404 || error?.statusCode === 410;
        const unusableKeys = typeof error?.code === "string" && error.code.startsWith("ERR_CRYPTO_");

        if (gone || unusableKeys) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscription.id));
          return { subscriptionId: subscription.id, success: false, expired: true };
        }
        captureExceptionAndLog(error);
        return { subscriptionId: subscription.id, success: false, error: error?.message ?? "Unknown error" };
      }
    }),
  );
};
