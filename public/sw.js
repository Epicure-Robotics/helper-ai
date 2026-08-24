// Service Worker for Web Push Notifications
// This runs in the background and handles push events even when the app is closed

self.addEventListener("push", (event) => {
  if (!event.data) {
    console.log("Push event received with no data");
    return;
  }

  try {
    // Try to parse as JSON first, fallback to text
    let data;
    try {
      data = event.data.json();
    } catch (e) {
      // If not JSON, treat as plain text for testing
      const text = event.data.text();
      data = {
        title: "New Notification",
        body: text,
        actionUrl: "/",
      };
    }

    console.log("Push notification received:", data);

    const options = {
      body: data.body || "You have a new notification",
      icon: "/logo_icon.png",
      badge: "/logo_icon.png",
      tag: data.conversationId ? `conversation-${data.conversationId}` : "notification",
      data: {
        url: data.actionUrl || "/",
        notificationId: data.notificationId,
        conversationId: data.conversationId,
      },
      actions: [
        { action: "open", title: "View" },
        { action: "close", title: "Dismiss" },
      ],
      requireInteraction: false, // Auto-dismiss after timeout
      vibrate: [200, 100, 200], // Vibration pattern
      silent: false,
    };

    event.waitUntil(self.registration.showNotification(data.title || "Notification", options));
  } catch (error) {
    console.error("Error processing push event:", error);
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const notificationData = event.notification.data;

  if (event.action === "close") {
    // User clicked dismiss - just close the notification
    return;
  }

  // User clicked "View" or the notification body
  if (event.action === "open" || !event.action) {
    event.waitUntil(
      (async () => {
        try {
          // Try to find an existing window with the app
          const allClients = await clients.matchAll({
            type: "window",
            includeUncontrolled: true,
          });

          // Check if we have an existing window
          for (const client of allClients) {
            if (client.url.includes(new URL(notificationData.url).origin) && "focus" in client) {
              // Navigate to the conversation
              client.postMessage({
                type: "NOTIFICATION_CLICKED",
                notificationId: notificationData.notificationId,
                conversationId: notificationData.conversationId,
                url: notificationData.url,
              });
              return client.focus();
            }
          }

          // No existing window found - open a new one
          if (clients.openWindow) {
            const newClient = await clients.openWindow(notificationData.url);
            if (newClient) {
              // Inform the new window about the notification click
              newClient.postMessage({
                type: "NOTIFICATION_CLICKED",
                notificationId: notificationData.notificationId,
                conversationId: notificationData.conversationId,
              });
            }
            return newClient;
          }
        } catch (error) {
          console.error("Error handling notification click:", error);
        }
      })(),
    );
  }
});

// Handle notification close event (when user dismisses without clicking)
self.addEventListener("notificationclose", (event) => {
  console.log("Notification was closed:", event.notification.tag);
  // Could track dismissals here if needed
});

// Service worker activation
self.addEventListener("activate", (event) => {
  console.log("Service worker activated");
  event.waitUntil(clients.claim());
});

// Service worker installation
self.addEventListener("install", (event) => {
  console.log("Service worker installed");
  self.skipWaiting();
});

/**
 * The browser can retire this device's push subscription on its own (browser update, storage
 * eviction, key rotation). When it does, the row in `push_subscriptions` still points at the old
 * endpoint and this device silently stops receiving anything. Re-subscribe with the same VAPID key
 * and hand the new endpoint to the server straight away.
 *
 * `fetch` from a service worker sends same-origin cookies, so the route authenticates as the
 * employee who is signed in on this device — the new row lands against the right person.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const applicationServerKey =
          event.oldSubscription?.options?.applicationServerKey ?? event.newSubscription?.options?.applicationServerKey;

        const subscription =
          event.newSubscription ??
          (await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey }));

        const keys = subscription.toJSON().keys ?? {};
        await fetch("/api/push/resubscribe", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            oldEndpoint: event.oldSubscription?.endpoint ?? null,
            endpoint: subscription.endpoint,
            p256dh: keys.p256dh ?? "",
            auth: keys.auth ?? "",
          }),
        });
      } catch (error) {
        console.error("Failed to handle pushsubscriptionchange:", error);
      }
    })(),
  );
});
