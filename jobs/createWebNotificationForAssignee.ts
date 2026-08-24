import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { conversations, userProfiles, webNotifications, type WebNotificationType } from "@/db/schema";
import { env } from "@/lib/env";
import { isWebPushConfigured, sendPushToUser } from "@/lib/notifications/sendPush";
import { publishToRealtime } from "@/lib/realtime/publish";
import { captureExceptionAndLog } from "@/lib/shared/sentry";

type CreateWebNotificationPayload = {
  conversationId: number;
  type: WebNotificationType;
  messageId?: number;
  noteId?: number;
  triggeredByUserId?: string;
};

export const createWebNotificationForAssignee = async (payload: CreateWebNotificationPayload) => {
  try {
    const { conversationId, type, messageId, noteId, triggeredByUserId } = payload;

    console.log("[createWebNotificationForAssignee] Starting with payload:", JSON.stringify(payload));

    if (!conversationId || !type) {
      console.log("[createWebNotificationForAssignee] Missing required fields");
      return { success: false, reason: "Missing required fields" };
    }

    // Fetch conversation with assignee info
    const conversation = await db.query.conversations.findFirst({
      where: eq(conversations.id, conversationId),
      columns: {
        id: true,
        slug: true,
        subject: true,
        emailFrom: true,
        assignedToId: true,
      },
    });

    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }

    // No assignee = no notification
    if (!conversation.assignedToId) {
      console.log("[createWebNotificationForAssignee] No assignee, skipping notification");
      return { success: false, reason: "No assignee" };
    }

    // Don't notify if the assignee triggered the event themselves
    if (conversation.assignedToId === triggeredByUserId) {
      console.log("[createWebNotificationForAssignee] Assignee triggered event, skipping notification");
      return { success: false, reason: "Assignee triggered the event" };
    }

    // Check user notification preferences
    const assignee = await db.query.userProfiles.findFirst({
      where: eq(userProfiles.id, conversation.assignedToId),
      columns: {
        id: true,
        displayName: true,
        preferences: true,
      },
      with: {
        user: {
          columns: {
            email: true,
          },
        },
      },
    });

    if (!assignee) {
      console.log("[createWebNotificationForAssignee] Assignee not found");
      return { success: false, reason: "Assignee not found" };
    }

    console.log("[createWebNotificationForAssignee] Assignee:", assignee.displayName, assignee.id);

    // Check notification preferences (default is OFF for all notifications)
    const prefs = assignee.preferences as any;
    const notificationPrefs = prefs?.notifications || {};

    console.log("[createWebNotificationForAssignee] Notification preferences:", JSON.stringify(notificationPrefs));

    // Only send notifications if explicitly enabled by the user
    if (type === "new_message" && notificationPrefs.notifyOnNewMessage !== true) {
      console.log("[createWebNotificationForAssignee] User has not enabled new message notifications");
      return { success: false, reason: "User has not enabled new message notifications" };
    }
    if (type === "assignment_change" && notificationPrefs.notifyOnAssignment !== true) {
      console.log("[createWebNotificationForAssignee] User has not enabled assignment notifications");
      return { success: false, reason: "User has not enabled assignment notifications" };
    }
    if (type === "internal_note" && notificationPrefs.notifyOnNote !== true) {
      console.log("[createWebNotificationForAssignee] User has not enabled note notifications");
      return { success: false, reason: "User has not enabled note notifications" };
    }

    // Generate notification content
    const { title, body } = generateNotificationContent(type, conversation);
    const actionUrl = `${env.AUTH_URL}/conversations?id=${conversation.slug}`;

    // Create notification record
    const [notification] = await db
      .insert(webNotifications)
      .values({
        userId: conversation.assignedToId,
        conversationId: conversation.id,
        messageId,
        noteId,
        type,
        title,
        body,
        actionUrl,
        sentAt: new Date(),
      })
      .returning();

    if (!notification) {
      throw new Error("Failed to create notification");
    }

    console.log("[createWebNotificationForAssignee] Created notification record:", notification.id);

    // Publish to realtime channel for in-app notifications
    try {
      console.log("[createWebNotificationForAssignee] Publishing to realtime channel");
      await publishToRealtime({
        channel: { name: `user-notifications-${conversation.assignedToId}`, private: true },
        event: "notification.created",
        data: notification,
      });
      console.log("[createWebNotificationForAssignee] Successfully published to realtime");
    } catch (error) {
      console.error("[createWebNotificationForAssignee] Failed to publish to realtime:", error);
      captureExceptionAndLog(error);
      // Don't fail the entire job if realtime publish fails
    }

    // Send push notifications to all user's subscribed devices
    if (isWebPushConfigured() && notificationPrefs.webPushEnabled === true) {
      try {
        const pushResults = await sendPushToUser(conversation.assignedToId, {
          title,
          body,
          conversationId: conversation.id,
          actionUrl,
          notificationId: notification.id,
        });
        console.log("[createWebNotificationForAssignee] Push results:", JSON.stringify(pushResults));

        // Update deliveredAt timestamp if at least one push succeeded
        if (pushResults.some((r) => r.success)) {
          console.log("[createWebNotificationForAssignee] At least one push succeeded, updating deliveredAt");
          await db
            .update(webNotifications)
            .set({ deliveredAt: new Date() })
            .where(eq(webNotifications.id, notification.id));
        } else {
          console.log(`[createWebNotificationForAssignee] No push delivered (${pushResults.length} device(s) tried)`);
        }
      } catch (error) {
        console.error("[createWebNotificationForAssignee] Error in push notification flow:", error);
        captureExceptionAndLog(error);
      }
    } else {
      console.log(
        "[createWebNotificationForAssignee] Skipping push notifications. VAPID configured:",
        isWebPushConfigured(),
        "webPushEnabled:",
        notificationPrefs.webPushEnabled === true,
      );
    }

    // Return success (realtime notification was sent, plus any push notifications)
    return {
      success: true,
      notificationId: notification.id,
      reason: "Notifications sent successfully",
    };
  } catch (error) {
    console.error("[createWebNotificationForAssignee] Fatal error:", error);
    captureExceptionAndLog(error);
    throw error;
  }
};

function generateNotificationContent(
  type: WebNotificationType,
  conversation: { subject: string | null; emailFrom: string | null },
): { title: string; body: string } {
  const subject = conversation.subject || "Untitled Conversation";
  const customer = conversation.emailFrom || "A customer";

  switch (type) {
    case "new_message":
      return {
        title: "New message",
        body: `${customer} sent a new message in "${subject}"`,
      };
    case "assignment_change":
      return {
        title: "New assignment",
        body: `You've been assigned to "${subject}"`,
      };
    case "internal_note":
      return {
        title: "New note",
        body: `A teammate added a note to "${subject}"`,
      };
    default:
      return {
        title: "Notification",
        body: `Update in "${subject}"`,
      };
  }
}
