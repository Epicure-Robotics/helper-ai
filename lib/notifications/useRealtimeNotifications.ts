"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";
import { useSession } from "@/components/useSession";
import { DISABLED, useRealtimeEvent } from "@/lib/realtime/hooks";
import { api } from "@/trpc/react";

type WebNotification = {
  id: number;
  userId: string;
  conversationId: number;
  messageId?: number | null;
  noteId?: number | null;
  type: "new_message" | "assignment_change" | "internal_note";
  title: string;
  body: string;
  actionUrl: string;
  sentAt: Date;
  readAt?: Date | null;
  deliveredAt?: Date | null;
};

/**
 * Hook that listens for real-time web notifications and displays them
 * as toasts when the app is active, or lets the service worker handle
 * them via push notifications when the app is inactive.
 */
export function useRealtimeNotifications() {
  const { user } = useSession();
  const router = useRouter();
  const utils = api.useUtils();

  const { mutate: markRead } = api.user.markNotificationRead.useMutation({
    onSuccess: () => {
      // Invalidate unread count query to update badge
      utils.user.getUnreadNotificationCount.invalidate();
    },
  });

  useRealtimeEvent<WebNotification>(
    user ? { name: `user-notifications-${user.id}`, private: true } : DISABLED,
    "notification.created",
    (message) => {
      const notification = message.data;

      // Check if the tab/window is currently visible
      const isVisible = document.visibilityState === "visible";

      if (isVisible) {
        // Check if user has in-app toast notifications enabled (default is OFF)
        const notificationPrefs = user.preferences?.notifications || {};
        const inAppToastEnabled = notificationPrefs.inAppToastEnabled === true;

        if (inAppToastEnabled) {
          // Show in-app toast notification
          toast(notification.title, {
            description: notification.body,
            duration: 5000,
            action: {
              label: "View",
              onClick: () => {
                // Mark as read when user clicks
                markRead({ notificationId: notification.id });

                // Navigate to the conversation
                router.push(notification.actionUrl);
              },
            },
            onDismiss: () => {
              // Optionally mark as read when dismissed
              // markRead({ notificationId: notification.id });
            },
          });
        }

        // Invalidate unread count to update badge
        utils.user.getUnreadNotificationCount.invalidate();
      } else {
        // Tab is hidden - service worker will handle push notification
        // The service worker push handler in /public/sw.js will show the notification
        console.log("Tab hidden - push notification will be handled by service worker");
      }
    },
  );

  // Listen for notification clicks from service worker
  useEffect(() => {
    const handleServiceWorkerMessage = (event: MessageEvent) => {
      if (event.data.type === "NOTIFICATION_CLICKED") {
        const { notificationId, url } = event.data;

        // Mark notification as read
        if (notificationId) {
          markRead({ notificationId });
        }

        // Navigate to the conversation if URL provided
        if (url) {
          router.push(url);
        }

        // Invalidate unread count
        utils.user.getUnreadNotificationCount.invalidate();
      }
    };

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", handleServiceWorkerMessage);

      return () => {
        navigator.serviceWorker.removeEventListener("message", handleServiceWorkerMessage);
      };
    }
  }, [markRead, router, utils]);
}
