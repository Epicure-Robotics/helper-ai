import { and, isNotNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { pushSubscriptions } from "@/db/schema";

/** Browsers that have not accepted a push in this long are treated as gone for good. */
const STALE_AFTER_DAYS = 90;

/**
 * Removes push subscriptions that can no longer deliver.
 *
 * `sendPushToUser` already drops an endpoint the moment a push service says it is gone (404/410) or
 * its stored keys fail to encrypt. Two cases slip past that and would otherwise accumulate forever,
 * costing a failed request on every notification:
 *
 *  - **Rotated VAPID keys.** Subscriptions are bound to the application server key they were created
 *    with, so after a key rotation every existing row is rejected with 403 — which is deliberately
 *    *not* treated as expired, because a botched deploy would otherwise wipe every device's
 *    registration. Those rows instead age out here.
 *  - **Devices that quietly stopped.** A machine that is wiped or never opened again leaves a row
 *    that no send ever reaches a verdict on.
 *
 * `lastUsedAt` is set on every successful send and on every (re)subscribe, so it is a true
 * last-known-good timestamp. Rows that have never been used fall back to `createdAt`.
 */
export const cleanupStalePushSubscriptions = async () => {
  const cutoff = sql`now() - ${`${STALE_AFTER_DAYS} days`}::interval`;

  const deleted = await db
    .delete(pushSubscriptions)
    .where(
      or(
        and(isNotNull(pushSubscriptions.lastUsedAt), lt(pushSubscriptions.lastUsedAt, cutoff)),
        and(sql`${pushSubscriptions.lastUsedAt} is null`, lt(pushSubscriptions.createdAt, cutoff)),
      ),
    )
    .returning({ id: pushSubscriptions.id });

  return `Removed ${deleted.length} push subscription(s) unused for over ${STALE_AFTER_DAYS} days`;
};
