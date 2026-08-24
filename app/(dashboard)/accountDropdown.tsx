"use client";

import { ChevronUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSession } from "@/components/useSession";
import { getFullName } from "@/lib/auth/authUtils";
import { getExistingPushSubscription, unsubscribeFromPushNotifications } from "@/lib/notifications/sw-register";
import { createClient } from "@/lib/supabase/client";
import { api } from "@/trpc/react";

const supabase = createClient();

export function AccountDropdown() {
  const { user } = useSession() ?? {};
  const router = useRouter();
  const unsubscribeFromPush = api.user.unsubscribeFromPush.useMutation();

  /**
   * Unregister this device before dropping the session.
   *
   * Push subscriptions belong to the browser, not the account: the next person to sign in here gets
   * the *same* endpoint back. Leaving the row behind would mean the previous employee's ticket
   * notifications — subject lines and customer names included — keep arriving on a machine someone
   * else is now using. Must run before `signOut`, while the request is still authenticated.
   */
  const unregisterThisDevice = async () => {
    try {
      const subscription = await getExistingPushSubscription();
      if (!subscription) return;
      await unsubscribeFromPush.mutateAsync({ endpoint: subscription.endpoint });
      await unsubscribeFromPushNotifications();
    } catch (error) {
      // Never block sign-out on this; the endpoint is pruned server-side on its next failed send.
      console.error("Failed to unregister push subscription on sign out:", error);
    }
  };

  const handleSignOut = async () => {
    await unregisterThisDevice();
    await supabase.auth.signOut();
    router.push("/login");
  };

  if (!user) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="sidebar"
          size="sm"
          className="flex items-center gap-2 w-full h-10 px-2 rounded-lg transition-colors hover:bg-sidebar-accent/80 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
          aria-label="Account menu"
        >
          <Avatar fallback={getFullName(user)} size="sm" />
          <span className="truncate text-sm group-data-[collapsible=icon]:hidden">{user.email}</span>
          <ChevronUp className="ml-auto h-4 w-4 group-data-[collapsible=icon]:hidden" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="w-(--radix-popper-anchor-width)">
        <DropdownMenuItem className="cursor-pointer" onClick={handleSignOut}>
          <span>Sign out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
