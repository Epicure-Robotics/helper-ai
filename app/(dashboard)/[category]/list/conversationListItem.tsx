import { escape } from "lodash-es";
import { useRef } from "react";
import { ConversationListItem as ConversationListItemType } from "@/app/types/global";
import HumanizedTime from "@/components/humanizedTime";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useMembers } from "@/components/useMembers";
import { isLeadPriority, LEAD_PRIORITY_BADGE_STYLES, LEAD_PRIORITY_LABELS } from "@/lib/leads/leadPriority";
import { createSearchSnippet } from "@/lib/search/searchSnippet";
import { cn } from "@/lib/utils";
import { api } from "@/trpc/react";
import { useConversationsListInput } from "../shared/queries";
import { useConversationListContext } from "./conversationListContext";
import { highlightKeywords } from "./filters/highlightKeywords";
import { UnreadIndicator } from "./unreadIndicator";

type ListItem = ConversationListItemType & { isNew?: boolean };

type ConversationListItemProps = {
  conversation: ListItem;
  onSelectConversation: (slug: string) => void;
  isSelected: boolean;
  onToggleSelect: (isSelected: boolean, shiftKey: boolean) => void;
};

export const ConversationListItem = ({
  conversation,
  onSelectConversation,
  isSelected,
  onToggleSelect,
}: ConversationListItemProps) => {
  const utils = api.useUtils();
  const hoverTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // Only prefetch if user hovers for >300ms (intentional hover, not just scrolling)
  // This reduces unnecessary prefetches while keeping instant navigation for real hovers
  const handleMouseEnter = (_e: React.MouseEvent) => {
    hoverTimeoutRef.current = setTimeout(() => {
      void utils.mailbox.conversations.get.ensureData({ conversationSlug: conversation.slug });
    }, 150);
  };

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
  };

  return (
    <div className="px-1 md:px-2 relative">
      <div
        className={cn(
          "flex w-full cursor-pointer items-center border-b border-border py-1.5 transition-colors",
          "hover:bg-muted/65 dark:hover:bg-white/[0.02]",
          isSelected && "bg-muted/80 dark:bg-white/[0.06]",
        )}
      >
        <div className="flex items-center gap-3 md:gap-4 px-2 md:px-4 flex-1 min-w-0">
          <div className="w-5 flex items-center shrink-0">
            <Checkbox
              checked={isSelected}
              onClick={(event) => onToggleSelect(!isSelected, event.nativeEvent.shiftKey)}
            />
          </div>
          <a
            className="flex-1 min-w-0"
            href={`/conversations?id=${conversation.slug}`}
            onClick={(e) => {
              if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
                e.preventDefault();
                onSelectConversation(conversation.slug);
              }
            }}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            style={{ overflowAnchor: "none" }}
          >
            <ConversationListItemContent conversation={conversation} />
          </a>
        </div>
      </div>
    </div>
  );
};

type ConversationListItemContentProps = {
  conversation: ListItem;
  emailPrefix?: string;
};

export const ConversationListItemContent = ({ conversation, emailPrefix }: ConversationListItemContentProps) => {
  const { searchParams, input } = useConversationsListInput();
  const { issueGroups } = useConversationListContext();
  const searchTerms = searchParams.search ? searchParams.search.split(/\s+/).filter(Boolean) : [];

  const issueGroup = issueGroups?.find((g) => g.id === conversation.issueGroupId);
  const priority = isLeadPriority(conversation.leadPriority) ? conversation.leadPriority : null;
  const priorityStyle = priority ? LEAD_PRIORITY_BADGE_STYLES[priority] : null;

  let highlightedSubject = escape(conversation.subject);
  let bodyText = conversation.matchedMessageText ?? conversation.recentMessageText ?? "";

  if (searchTerms.length > 0 && conversation.matchedMessageText) {
    bodyText = createSearchSnippet(bodyText, searchTerms);
  }

  let highlightedBody = escape(bodyText);

  if (searchTerms.length > 0) {
    highlightedSubject = highlightKeywords(highlightedSubject, searchTerms);

    if (conversation.matchedMessageText) {
      highlightedBody = highlightKeywords(highlightedBody, searchTerms);
    }
  }

  const displayEmailFrom = `${emailPrefix ?? ""}${conversation.emailFrom ?? "Anonymous"}`;

  return (
    <div className="flex items-center gap-3" data-testid="conversation-list-item-content">
      {/* Left side: Sender name + badges */}
      <div className="flex items-center gap-2 w-48 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <p
            className={cn(
              "text-foreground truncate text-sm",
              conversation.unreadMessageCount ? "font-semibold" : "font-normal",
            )}
          >
            {displayEmailFrom}
          </p>
          {input.displayUnreadBehavior && <UnreadIndicator hasUnread={!!conversation.unreadMessageCount} />}
        </div>
        {conversation.platformCustomer?.value &&
          (conversation.platformCustomer.isVip ? (
            <TooltipProvider delayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="bright" className="gap-1 text-[8px] shrink-0">
                    {parseFloat(conversation.platformCustomer.value) / 100}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs">
                  VIP
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <Badge variant="gray" className="gap-1 text-[8px] shrink-0">
              {parseFloat(conversation.platformCustomer.value) / 100}
            </Badge>
          ))}
      </div>

      {/* Middle: Subject + preview + badges on same line */}
      <div className="flex-1 min-w-0 flex items-center gap-2">
        {priority && priorityStyle && (
          <Badge variant="gray" className={cn("text-[10px] shrink-0 uppercase", priorityStyle)}>
            {LEAD_PRIORITY_LABELS[priority]}
          </Badge>
        )}
        {issueGroup && (
          <Badge
            variant="gray"
            className="text-[10px] normal-case shrink-0 max-w-[120px] truncate"
            style={
              issueGroup.color
                ? {
                    backgroundColor: `${issueGroup.color}20`,
                    color: issueGroup.color,
                    borderColor: `${issueGroup.color}40`,
                  }
                : undefined
            }
          >
            {issueGroup.title}
          </Badge>
        )}
        {conversation.status === "waiting_on_customer" && (
          <Badge variant="gray" className="text-[10px] shrink-0">
            Waiting on user
          </Badge>
        )}
        {conversation.status === "check_back_later" && (
          <Badge variant="gray" className="text-[10px] shrink-0">
            Check back later
          </Badge>
        )}
        {(conversation.assignedToId || conversation.assignedToAI) && (
          <AssignedToLabel
            className="flex items-center text-muted-foreground text-[10px] shrink-0"
            assignedToId={conversation.assignedToId}
            assignedToAI={conversation.assignedToAI}
          />
        )}
        <div className="flex-1 min-w-0 truncate">
          <span
            className={cn("text-foreground text-sm", conversation.unreadMessageCount ? "font-semibold" : "font-normal")}
            dangerouslySetInnerHTML={{ __html: highlightedSubject || "(no subject)" }}
          />
          {highlightedBody && (
            <>
              <span className="text-muted-foreground text-sm mx-1">—</span>
              <span className="text-muted-foreground text-sm" dangerouslySetInnerHTML={{ __html: highlightedBody }} />
            </>
          )}
        </div>
      </div>

      {/* Right side: Time + new indicator */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="text-muted-foreground text-[10px] whitespace-nowrap">
          {conversation.status === "closed" ? (
            <HumanizedTime time={conversation.closedAt ?? conversation.updatedAt} titlePrefix="Closed on" />
          ) : (
            <HumanizedTime time={conversation.lastMessageAt ?? conversation.updatedAt} titlePrefix="Last message on" />
          )}
        </div>
        {conversation.isNew && <div className="h-2 w-2 shrink-0 rounded-full bg-primary shadow-sm shadow-primary/40" />}
      </div>
    </div>
  );
};

const AssignedToLabel = ({
  assignedToId,
  assignedToAI,
  className,
}: {
  assignedToId: string | null;
  assignedToAI?: boolean;
  className?: string;
}) => {
  const { data: members } = useMembers();

  if (assignedToAI) {
    return (
      <div className={className} title="Assigned to AI assistant">
        AI
      </div>
    );
  }

  const displayName = members?.find((m) => m.id === assignedToId)?.displayName?.split(" ")[0];

  return displayName ? (
    <div className={className} title={`Assigned to ${displayName}`}>
      {displayName}
    </div>
  ) : null;
};
