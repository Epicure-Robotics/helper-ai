"use client";

import {
  AlertTriangle,
  Bell,
  FileText,
  Globe,
  Laptop,
  MessageSquare,
  Settings2,
  Smartphone,
  UserPlus,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useSavingIndicator } from "@/components/hooks/useSavingIndicator";
import { SavingIndicator } from "@/components/savingIndicator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useSession } from "@/components/useSession";
import {
  checkPushNotificationSupport,
  subscribeToPushNotifications,
  toPushSubscriptionPayload,
} from "@/lib/notifications/sw-register";
import { cn } from "@/lib/utils";
import { api } from "@/trpc/react";

const NotificationsSetting = () => {
  const { user } = useSession() ?? {};
  const notificationPrefs = user?.preferences?.notifications || {};

  const [webPushEnabled, setWebPushEnabled] = useState(notificationPrefs.webPushEnabled ?? false);
  const [inAppToastEnabled, setInAppToastEnabled] = useState(notificationPrefs.inAppToastEnabled ?? false);
  const [notifyOnNewMessage, setNotifyOnNewMessage] = useState(notificationPrefs.notifyOnNewMessage ?? false);
  const [notifyOnAssignment, setNotifyOnAssignment] = useState(notificationPrefs.notifyOnAssignment ?? false);
  const [notifyOnNote, setNotifyOnNote] = useState(notificationPrefs.notifyOnNote ?? false);

  const [permissionStatus, setPermissionStatus] = useState<NotificationPermission | null>(null);

  const savingIndicator = useSavingIndicator();
  const utils = api.useUtils();

  const { mutate: updatePreferences } = api.user.updateNotificationPreferences.useMutation({
    onSuccess: () => {
      utils.user.currentUser.invalidate();
      savingIndicator.setState("saved");
      toast.success("Notification preferences updated");
    },
    onError: (error) => {
      savingIndicator.setState("error");
      toast.error("Error updating preferences", { description: error.message });
    },
  });

  const { mutate: subscribeToPush } = api.user.subscribeToPush.useMutation({
    onSuccess: () => {
      utils.user.listPushSubscriptions.invalidate();
      toast.success("Device registered for push notifications");
    },
    onError: (error) => {
      toast.error("Failed to enable push notifications", { description: error.message });
    },
  });

  const { mutate: unsubscribeFromPush } = api.user.unsubscribeFromPush.useMutation({
    onSuccess: () => {
      utils.user.listPushSubscriptions.invalidate();
      toast.success("Device unregistered");
    },
    onError: (error) => {
      toast.error("Failed to disable push notifications", { description: error.message });
    },
  });

  const { data: subscriptionsData } = api.user.listPushSubscriptions.useQuery();

  const { mutate: sendTestPush, isPending: isSendingTest } = api.user.sendTestPush.useMutation({
    onSuccess: ({ delivered, attempted, expired }) => {
      utils.user.listPushSubscriptions.invalidate();
      toast.success(`Test push delivered to ${delivered} of ${attempted} device(s)`, {
        description: expired ? `${expired} expired subscription(s) were removed.` : undefined,
      });
    },
    onError: (error) => {
      toast.error("Test push failed", { description: error.message });
    },
  });

  useEffect(() => {
    const support = checkPushNotificationSupport();
    setPermissionStatus(support.permission);
  }, []);

  const handlePreferenceChange = (key: string, value: boolean) => {
    savingIndicator.setState("saving");
    updatePreferences({ [key]: value });
  };

  /**
   * Registers *this* device against the signed-in employee. Safe to call repeatedly: the browser
   * hands back its existing subscription when there is one, and the server upserts on
   * (userId, endpoint), so re-running only refreshes the keys and `lastUsedAt`.
   */
  const registerThisDevice = async () => {
    try {
      const result = await subscribeToPushNotifications();

      if (result.success && result.subscription) {
        subscribeToPush(toPushSubscriptionPayload(result.subscription));
        setPermissionStatus("granted");
        // Also enable the preference if not already
        if (!webPushEnabled) {
          setWebPushEnabled(true);
          handlePreferenceChange("webPushEnabled", true);
        }
      } else {
        toast.error("Permission denied", { description: result.error });
      }
    } catch (error) {
      toast.error("Failed to enable notifications", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  const handleTestNotification = () => {
    if (Notification.permission !== "granted") {
      toast.error("Notification permission not granted");
      return;
    }
    sendTestPush();
  };

  const handleWebPushToggle = (checked: boolean) => {
    setWebPushEnabled(checked);
    handlePreferenceChange("webPushEnabled", checked);
    // Register unconditionally when enabling. Gating this on `permission !== "granted"` meant that on
    // a device which had already granted permission — and permission outlives logouts, DB resets and
    // the whole period VAPID keys were missing — no `push_subscriptions` row was ever written, so the
    // toggle read as on while the device received nothing.
    if (checked) {
      registerThisDevice();
    }
  };

  const support = checkPushNotificationSupport();

  return (
    <div className="mx-auto max-w-5xl space-y-10 py-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Notifications</h1>
          <p className="mt-2 text-muted-foreground text-lg">
            Manage how you receive alerts and stay updated with your team&apos;s activity.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SavingIndicator state={savingIndicator.state} />
        </div>
      </div>

      {/* Browser Support Warning */}
      {!support.supported && (
        <Card className="flex items-center gap-4 bg-yellow-50/50 p-4 border-yellow-200">
          <AlertTriangle className="h-5 w-5 text-yellow-600" />
          <p className="text-sm text-yellow-800">
            <strong>Browser not supported:</strong> {support.reason}
          </p>
        </Card>
      )}

      {/* Channels Section */}
      <section className="space-y-5">
        <div className="flex items-center gap-2">
          <Settings2 className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold tracking-tight">Delivery Channels</h2>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Web Push Card */}
          <Card
            className={cn(
              "relative flex flex-col justify-between overflow-hidden p-6 transition-all border-l-4",
              webPushEnabled ? "border-l-primary shadow-md" : "border-l-transparent bg-muted/40",
            )}
          >
            <div className="space-y-4">
              <div className="flex items-start justify-between">
                <div className="rounded-full bg-primary/10 p-2.5">
                  <Globe className="h-5 w-5 text-primary" />
                </div>
                <Switch aria-label="Browser Push" checked={webPushEnabled} onCheckedChange={handleWebPushToggle} />
              </div>
              <div>
                <h3 className="font-semibold text-lg">Browser Push</h3>
                <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                  Receive notifications on your device even when the app is closed.
                </p>
              </div>
            </div>
            {webPushEnabled && (
              <div className="mt-6 flex flex-wrap gap-2">
                <Badge variant={permissionStatus === "granted" ? "gray" : "destructive"}>
                  Permission: {permissionStatus || "unknown"}
                </Badge>
                {permissionStatus === "granted" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={handleTestNotification}
                    disabled={isSendingTest}
                  >
                    {isSendingTest ? "Sending…" : "Test"}
                  </Button>
                )}
              </div>
            )}
          </Card>

          {/* In-App Toast Card */}
          <Card
            className={cn(
              "relative flex flex-col justify-between overflow-hidden p-6 transition-all border-l-4",
              inAppToastEnabled ? "border-l-primary shadow-md" : "border-l-transparent bg-muted/40",
            )}
          >
            <div className="space-y-4">
              <div className="flex items-start justify-between">
                <div className="rounded-full bg-primary/12 p-2.5">
                  <Bell className="h-5 w-5 text-primary" />
                </div>
                <Switch
                  aria-label="In-App Toasts"
                  checked={inAppToastEnabled}
                  onCheckedChange={(checked) => {
                    setInAppToastEnabled(checked);
                    handlePreferenceChange("inAppToastEnabled", checked);
                  }}
                />
              </div>
              <div>
                <h3 className="font-semibold text-lg">In-App Toasts</h3>
                <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                  Show temporary toast popups while you are actively using the application.
                </p>
              </div>
            </div>
          </Card>
        </div>
      </section>

      <Separator />

      {/* Events Section */}
      <section className="space-y-5">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold tracking-tight">Activity Preferences</h2>
        </div>

        <Card className="divide-y overflow-hidden rounded-xl border shadow-sm">
          {/* Message */}
          <div className="flex items-center justify-between p-4 sm:p-6 hover:bg-muted/50 transition-colors">
            <div className="flex items-start gap-4">
              <div className="mt-1 rounded-full bg-primary/12 p-2 text-primary">
                <MessageSquare className="h-5 w-5" />
              </div>
              <div>
                <h4 className="font-semibold">New Customer Messages</h4>
                <p className="text-sm text-muted-foreground max-w-lg">
                  Notify me when a customer replies or sends a new message on a ticket assigned to me.
                </p>
              </div>
            </div>
            <Switch
              checked={notifyOnNewMessage}
              onCheckedChange={(checked) => {
                setNotifyOnNewMessage(checked);
                handlePreferenceChange("notifyOnNewMessage", checked);
              }}
            />
          </div>

          {/* Assignments */}
          <div className="flex items-center justify-between p-4 sm:p-6 hover:bg-muted/50 transition-colors">
            <div className="flex items-start gap-4">
              <div className="mt-1 rounded-full bg-orange-100 p-2 text-orange-600 dark:bg-orange-900/40 dark:text-orange-400">
                <UserPlus className="h-5 w-5" />
              </div>
              <div>
                <h4 className="font-semibold">Ticket Assignments</h4>
                <p className="text-sm text-muted-foreground max-w-lg">
                  Notify me immediately when a new ticket is assigned to me.
                </p>
              </div>
            </div>
            <Switch
              checked={notifyOnAssignment}
              onCheckedChange={(checked) => {
                setNotifyOnAssignment(checked);
                handlePreferenceChange("notifyOnAssignment", checked);
              }}
            />
          </div>

          {/* Notes */}
          <div className="flex items-center justify-between p-4 sm:p-6 hover:bg-muted/50 transition-colors">
            <div className="flex items-start gap-4">
              <div className="mt-1 rounded-full bg-purple-100 p-2 text-purple-600 dark:bg-purple-900/40 dark:text-purple-400">
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <h4 className="font-semibold">Internal Notes</h4>
                <p className="text-sm text-muted-foreground max-w-lg">
                  Notify me when a team member mentions me or adds a note to my ticket.
                </p>
              </div>
            </div>
            <Switch
              checked={notifyOnNote}
              onCheckedChange={(checked) => {
                setNotifyOnNote(checked);
                handlePreferenceChange("notifyOnNote", checked);
              }}
            />
          </div>
        </Card>
      </section>

      {/* Active Sessions */}
      {subscriptionsData && subscriptionsData.subscriptions.length > 0 && (
        <section className="space-y-4 pt-4">
          <div className="flex items-center gap-2 mb-2">
            <Smartphone className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold tracking-tight">Active Devices</h2>
          </div>

          <div className="rounded-xl border bg-card shadow-sm">
            <div className="grid grid-cols-[1fr_auto] gap-4 p-4 font-medium text-sm text-muted-foreground border-b bg-muted/40">
              <div>Device / Browser</div>
              <div>Action</div>
            </div>
            <div className="divide-y">
              {subscriptionsData.subscriptions.map((sub) => (
                <div key={sub.id} className="grid grid-cols-[1fr_auto] gap-4 p-4 items-center">
                  <div className="flex items-center gap-3">
                    <div className="rounded-full bg-secondary p-2">
                      <Laptop className="h-4 w-4 text-foreground" />
                    </div>
                    <div>
                      <p className="font-medium text-sm text-foreground">{sub.userAgent || "Unknown Device"}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                        <span>Added {new Date(sub.createdAt).toLocaleDateString()}</span>
                        {sub.lastUsedAt && (
                          <>
                            <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                            <span>Last active {new Date(sub.lastUsedAt).toLocaleDateString()}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => unsubscribeFromPush({ endpoint: sub.endpoint })}
                    className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  >
                    Revoke
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
};

export default NotificationsSetting;
