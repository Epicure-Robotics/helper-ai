"use client";

import { useEffect, useRef } from "react";
import { useSession } from "@/components/useSession";
import { getExistingPushSubscription } from "@/lib/notifications/sw-register";
import { api } from "@/trpc/react";

/**
 * Keeps this device's row in `push_subscriptions` in step with the browser, once per page load.
 *
 * Push subscriptions are not stable: browsers rotate the endpoint on update, drop it when storage is
 * evicted, and re-issue it after a `pushsubscriptionchange`. The stored row then points at an
 * endpoint the push service no longer knows, and that device goes quiet with nothing in the UI to
 * show it. Re-upserting whatever the browser currently holds repairs that on the next visit.
 *
 * Deliberately does not prompt: `getExistingPushSubscription` only reads. A device that has never
 * opted in stays unregistered until the employee turns the toggle on in Settings → Notifications.
 */
export const usePushSubscriptionSync = () => {
  const { user } = useSession() ?? {};
  const subscribeToPush = api.user.subscribeToPush.useMutation();
  const syncedRef = useRef(false);

  const webPushEnabled = user?.preferences?.notifications?.webPushEnabled === true;

  useEffect(() => {
    if (syncedRef.current || !webPushEnabled) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;

    syncedRef.current = true;
    void getExistingPushSubscription().then((subscription) => {
      if (subscription) subscribeToPush.mutate(subscription);
    });
  }, [webPushEnabled]);
};
