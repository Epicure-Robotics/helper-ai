import { upperFirst } from "lodash-es";
import {
  AlertCircle,
  ArrowLeftFromLine,
  ArrowRightFromLine,
  Bot,
  ChevronDown,
  ChevronRight,
  Clock4,
  User,
} from "lucide-react";
import { useState } from "react";
import { ConversationEvent } from "@/app/types/global";
import HumanizedTime from "@/components/humanizedTime";
import { useMembers } from "@/components/useMembers";

const eventDescriptions: Partial<Record<ConversationEvent["eventType"], string>> = {
  request_human_support: "Human support requested",
  email_auto_ignored: "Email auto ignored",
  device_deleted: "Linked device removed",
};

const statusVerbs = {
  open: "opened",
  waiting_on_customer: "waiting on user",
  closed: "closed",
  spam: "marked as spam",
  check_back_later: "check back later",
  ignored: "ignored",
};

const statusIcons = {
  open: ArrowRightFromLine,
  waiting_on_customer: Clock4,
  closed: ArrowLeftFromLine,
  spam: AlertCircle,
  check_back_later: Clock4,
  ignored: ArrowLeftFromLine,
};

export const EventItem = ({
  event,
  initialExpanded = false,
}: {
  event: ConversationEvent;
  initialExpanded?: boolean;
}) => {
  const [detailsExpanded, setDetailsExpanded] = useState(initialExpanded);

  const { data: orgMembers, isLoading: isLoadingMembers, error: membersError } = useMembers();

  const getUserDisplayName = (userId: string | null | undefined): string | null => {
    if (!userId) return null;
    const member = orgMembers?.find((m) => m.id === userId);
    return member?.displayName?.trim() || null;
  };

  if (!event.changes) return null;

  const assignedToUserName = getUserDisplayName(event.changes.assignedToId);

  const getAssignmentDescription = () => {
    if (event.changes.assignedToAI) return null;
    if (event.changes.assignedToId === undefined) return null;
    if (event.changes.assignedToId === null) return "unassigned";
    if (assignedToUserName) return `assigned to ${assignedToUserName}`;
    if (membersError) return "assigned to (error loading users)";
    if (isLoadingMembers) return "assigned to...";
    return "assigned to unknown user";
  };

  const description = [
    eventDescriptions[event.eventType],
    event.changes.status ? statusVerbs[event.changes.status] : null,
    getAssignmentDescription(),
    event.changes.assignedToAI ? "assigned to AI assistant" : null,
    event.changes.assignedToAI === false ? "AI assistant unassigned" : null,
  ]
    .filter(Boolean)
    .join(" and ");

  const hasDetails = event.byUserId || event.reason;
  const byUserName = getUserDisplayName(event.byUserId);

  const Icon = event.changes.assignedToAI ? Bot : event.changes.status ? statusIcons[event.changes.status] : User;

  return (
    <article className="flex flex-col mx-auto">
      <button
        className="flex items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        onClick={() => setDetailsExpanded(!detailsExpanded)}
        aria-label="Toggle event details"
      >
        {hasDetails && (detailsExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />)}
        <Icon className="h-4 w-4" />
        <span className="flex items-center gap-1">{upperFirst(description)}</span>
        <span>·</span>
        <span>
          <HumanizedTime time={event.createdAt} />
        </span>
      </button>

      {hasDetails && detailsExpanded && (
        <section className="mt-2 text-sm text-muted-foreground border rounded p-4">
          <div className="flex flex-col gap-1">
            {byUserName && (
              <div>
                <strong>By:</strong> {byUserName}
              </div>
            )}
            {event.reason && (
              <div>
                <strong>Reason:</strong> {event.reason}
              </div>
            )}
          </div>
        </section>
      )}
    </article>
  );
};
