import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { pushSubscriptions } from "@/db/schema";
import { captureExceptionAndLog } from "@/lib/shared/sentry";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  oldEndpoint: z.string().nullable().optional(),
  endpoint: z.string().min(1),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
});

/**
 * Receives a rotated push subscription from the service worker's `pushsubscriptionchange` handler.
 *
 * This exists as a route rather than a tRPC procedure because a service worker cannot use the React
 * tRPC client. It still authenticates the same way: the subscription is written against the signed-in
 * user from the session cookie, never against an id supplied by the caller, so one employee can
 * never register a device under another's account.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const { oldEndpoint, endpoint, p256dh, auth } = parsed.data;
  const userAgent = request.headers.get("user-agent");

  try {
    // Drop the retired endpoint first so this device keeps exactly one row rather than accumulating
    // a dead one per rotation. Scoped to this user, so it can only ever clear their own row.
    if (oldEndpoint && oldEndpoint !== endpoint) {
      await db
        .delete(pushSubscriptions)
        .where(and(eq(pushSubscriptions.userId, user.id), eq(pushSubscriptions.endpoint, oldEndpoint)));
    }

    await db
      .insert(pushSubscriptions)
      .values({ userId: user.id, endpoint, p256dh, auth, userAgent, lastUsedAt: new Date() })
      .onConflictDoUpdate({
        target: [pushSubscriptions.userId, pushSubscriptions.endpoint],
        set: { p256dh, auth, userAgent, lastUsedAt: new Date(), updatedAt: new Date() },
      });

    return NextResponse.json({ success: true });
  } catch (error) {
    captureExceptionAndLog(error);
    return NextResponse.json({ error: "Failed to store subscription" }, { status: 500 });
  }
}
