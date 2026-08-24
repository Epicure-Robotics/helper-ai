"use client";

import { env } from "@/lib/env";

/**
 * Registers the service worker for push notifications
 * Should be called once when the app loads (if user is logged in)
 */
export async function registerServiceWorker(): Promise<{
  supported: boolean;
  registration?: ServiceWorkerRegistration;
  error?: string;
}> {
  // Check if service workers are supported
  if (!("serviceWorker" in navigator)) {
    return { supported: false, error: "Service workers not supported" };
  }

  // Check if Push API is supported
  if (!("PushManager" in window)) {
    return { supported: false, error: "Push notifications not supported" };
  }

  try {
    // Register the service worker
    const registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none", // Always check for updates
    });

    console.log("Service worker registered successfully:", registration.scope);

    // Check for updates periodically (every hour)
    setInterval(
      () => {
        registration.update().catch((error) => {
          console.error("Failed to update service worker:", error);
        });
      },
      60 * 60 * 1000,
    );

    // Update on page visibility change (when user returns to tab)
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        registration.update().catch((error) => {
          console.error("Failed to update service worker:", error);
        });
      }
    });

    return { supported: true, registration };
  } catch (error) {
    console.error("Service worker registration failed:", error);
    return { supported: false, error: String(error) };
  }
}

/**
 * Unregisters the service worker (useful for cleanup or testing)
 */
export async function unregisterServiceWorker(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) {
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration) {
      const result = await registration.unregister();
      console.log("Service worker unregistered:", result);
      return result;
    }
    return false;
  } catch (error) {
    console.error("Failed to unregister service worker:", error);
    return false;
  }
}

/**
 * Subscribes the user to push notifications
 * Requires a registered service worker and user permission
 */
export async function subscribeToPushNotifications(): Promise<{
  success: boolean;
  subscription?: PushSubscription;
  error?: string;
}> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { success: false, error: "Push notifications not supported" };
  }

  try {
    // Get the service worker registration
    const registration = await navigator.serviceWorker.ready;

    // Check if user already has a subscription
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      // Request permission if needed
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        return { success: false, error: "Permission denied" };
      }

      // Get VAPID public key from environment
      const vapidPublicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidPublicKey) {
        return { success: false, error: "VAPID public key not configured" };
      }

      // Subscribe to push notifications
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true, // Required by Chrome
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      console.log("Successfully subscribed to push notifications:", subscription.endpoint);
    }

    return { success: true, subscription };
  } catch (error) {
    console.error("Failed to subscribe to push notifications:", error);
    return { success: false, error: String(error) };
  }
}

/**
 * Unsubscribes from push notifications
 */
export async function unsubscribeFromPushNotifications(): Promise<{
  success: boolean;
  error?: string;
}> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { success: false, error: "Push notifications not supported" };
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (subscription) {
      const success = await subscription.unsubscribe();
      console.log("Unsubscribed from push notifications:", success);
      return { success };
    }

    return { success: true }; // Already unsubscribed
  } catch (error) {
    console.error("Failed to unsubscribe from push notifications:", error);
    return { success: false, error: String(error) };
  }
}

/** The shape `user.subscribeToPush` stores: one row per (employee, device). */
export type PushSubscriptionPayload = {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string;
};

export const toPushSubscriptionPayload = (subscription: PushSubscription): PushSubscriptionPayload => {
  const keys = subscription.toJSON().keys;
  return {
    endpoint: subscription.endpoint,
    p256dh: keys?.p256dh ?? "",
    auth: keys?.auth ?? "",
    userAgent: navigator.userAgent,
  };
};

/**
 * The browser's current subscription for this device, if one exists — never prompts.
 *
 * Browsers keep the notification *permission* independently of the *subscription*, and they rotate
 * or drop subscriptions on their own (storage eviction, browser update, `pushsubscriptionchange`).
 * So "permission === granted" does not imply this device has a live row in `push_subscriptions`;
 * call this on load and re-upsert whatever it returns.
 */
export async function getExistingPushSubscription(): Promise<PushSubscriptionPayload | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return subscription ? toPushSubscriptionPayload(subscription) : null;
  } catch (error) {
    console.error("Failed to read existing push subscription:", error);
    return null;
  }
}

/**
 * Checks if push notifications are currently supported and permitted
 */
export function checkPushNotificationSupport(): {
  supported: boolean;
  permission: NotificationPermission | null;
  reason?: string;
} {
  if (!("serviceWorker" in navigator)) {
    return { supported: false, permission: null, reason: "Service workers not supported" };
  }

  if (!("PushManager" in window)) {
    return { supported: false, permission: null, reason: "Push notifications not supported" };
  }

  if (!("Notification" in window)) {
    return { supported: false, permission: null, reason: "Notifications API not supported" };
  }

  return {
    supported: true,
    permission: Notification.permission,
  };
}

/**
 * Utility function to convert VAPID public key from base64 to Uint8Array
 * Required for push subscription
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}
