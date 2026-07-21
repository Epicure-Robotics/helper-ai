import { ArrowRight, Check, Circle } from "lucide-react";
import Link from "next/link";
import { HandHello } from "@/app/(dashboard)/[category]/icons/handHello";
import { InboxZero } from "@/app/(dashboard)/[category]/icons/inboxZero";
import { useConversationListContext } from "@/app/(dashboard)/[category]/list/conversationListContext";
import { useConversationsListInput } from "@/app/(dashboard)/[category]/shared/queries";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const NoConversations = ({ filtered, onClearFilters }: { filtered?: boolean; onClearFilters?: () => void }) => {
  const { input } = useConversationsListInput();
  const { conversationListData } = useConversationListContext();

  const onboardingState = conversationListData?.onboardingState;
  // Widget install is a separate, optional feature (embeddable website chat) — email
  // support only needs SMTP + Gmail, so it shouldn't block seeing an otherwise-populated inbox.
  const isOnboarding = !onboardingState?.hasSmtp || !onboardingState?.hasGmailSupportEmail;

  const shouldShowNoTickets = !input.status?.length || input.status?.[0] === "open";

  if (filtered) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center">
        <h2 className="font-semibold mb-2">No conversations found for this filter</h2>
        <p className="text-sm text-muted-foreground mb-4">Try adjusting your filters or search.</p>
        <Button variant="outlined" onClick={onClearFilters}>
          Clear filters
        </Button>
      </div>
    );
  }

  if (isOnboarding) {
    return (
      <div className="mx-auto flex-1 flex flex-col items-center justify-center gap-6 text-muted-foreground">
        <HandHello className="w-36 h-36 -mb-10" />
        <h2 className="text-xl text-center font-semibold text-foreground">Welcome! Let's complete your setup.</h2>
        <div className="grid gap-2">
          <Link
            href={`/settings/in-app-chat`}
            className="border transition-colors hover:border-foreground rounded-lg p-4"
          >
            <div className="flex items-center gap-2">
              {onboardingState?.hasWidgetHost ? <Check className="w-5 h-5" /> : <Circle className="w-5 h-5" />}
              <p className={cn(onboardingState?.hasWidgetHost && "line-through")}>
                Add the chat widget to your website
              </p>
            </div>
            {!onboardingState?.hasWidgetHost && (
              <div className="mt-2 flex items-center gap-1 ml-7 text-sm text-bright">
                Learn how <ArrowRight className="w-4 h-4" />
              </div>
            )}
          </Link>
          <Link
            href="/settings/integrations"
            className="border transition-colors hover:border-foreground rounded-lg p-4"
          >
            <div className="flex items-center gap-2">
              {onboardingState?.hasSmtp ? <Check className="w-5 h-5" /> : <Circle className="w-5 h-5" />}
              <p className={cn(onboardingState?.hasSmtp && "line-through")}>
                Set up SMTP to send emails from Epicure Assist
              </p>
            </div>
            {!onboardingState?.hasSmtp && (
              <div className="mt-2 flex items-center gap-1 ml-7 text-sm text-bright">
                Learn how <ArrowRight className="w-4 h-4" />
              </div>
            )}
          </Link>
          <Link href="/settings/integrations" className="border transition-colors hover:border-foreground rounded-lg p-4">
            <div className="flex items-center gap-2">
              {onboardingState?.hasGmailSupportEmail ? <Check className="w-5 h-5" /> : <Circle className="w-5 h-5" />}
              <p className={cn(onboardingState?.hasGmailSupportEmail && "line-through")}>
                Connect Gmail to handle your incoming emails
              </p>
            </div>
            {!onboardingState?.hasGmailSupportEmail && (
              <div className="mt-2 flex items-center gap-1 ml-7 text-sm text-bright">
                Learn how <ArrowRight className="w-4 h-4" />
              </div>
            )}
          </Link>
        </div>
      </div>
    );
  }

  if (shouldShowNoTickets) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center">
        <InboxZero className="h-60 w-60 dark:text-bright" />
        <h2 className="font-semibold mb-2">No open tickets</h2>
        <p className="text-sm text-muted-foreground">You're all caught up!</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center">
      <h2 className="font-semibold mb-2">No tickets found</h2>
    </div>
  );
};
