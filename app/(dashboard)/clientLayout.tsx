"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { registerServiceWorker } from "@/lib/notifications/sw-register";
import { usePushSubscriptionSync } from "@/lib/notifications/usePushSubscriptionSync";
import { useRealtimeNotifications } from "@/lib/notifications/useRealtimeNotifications";

export const useShowChatWidget = create<{
  showChatWidget: boolean;
  setShowChatWidget: (showChatWidget: boolean) => void;
}>((set) => ({
  showChatWidget: false,
  setShowChatWidget: (showChatWidget) => set({ showChatWidget }),
}));

export default function InboxClientLayout({ children }: { children: React.ReactNode }) {
  const { showChatWidget } = useShowChatWidget();

  // Set up real-time notifications
  useRealtimeNotifications();

  // Re-register this device's push subscription if the browser rotated it since last visit
  usePushSubscriptionSync();

  // Register service worker for push notifications
  useEffect(() => {
    registerServiceWorker()
      .then(({ supported, error }) => {
        if (supported) {
          console.log("Service worker registered successfully");
        } else {
          console.warn("Service worker not supported:", error);
        }
      })
      .catch((error) => {
        console.error("Failed to register service worker:", error);
      });
  }, []);

  return (
    <>
      {/* We show the widget for testing on the chat settings page. Need to improve the SDK to allow destroying the widget so we can move the provider there */}
      {!showChatWidget && (
        <style>
          {`
            .helper-widget-icon {
              display: none !important;
            }
          `}
        </style>
      )}
      {children}
    </>
  );
}
