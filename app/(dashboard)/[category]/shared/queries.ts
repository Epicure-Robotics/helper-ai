import { useParams } from "next/navigation";
import { parseAsArrayOf, parseAsBoolean, parseAsInteger, parseAsString, parseAsStringEnum, useQueryStates } from "nuqs";
import { LEAD_PRIORITY_ORDER } from "@/lib/leads/leadPriority";

export const useConversationsListInput = () => {
  const params = useParams<{
    category: "all" | "assigned" | "mine";
  }>();
  const [searchParams, setSearchParams] = useQueryStates({
    status: parseAsStringEnum([
      "all",
      "open",
      "waiting_on_customer",
      "closed",
      "spam",
      "check_back_later",
      "ignored",
    ] as const),
    sort: parseAsStringEnum(["oldest", "newest", "highest_value"] as const),
    search: parseAsString,
    assignee: parseAsArrayOf(parseAsString),
    createdAfter: parseAsString,
    createdBefore: parseAsString,
    repliedBy: parseAsArrayOf(parseAsString),
    customer: parseAsArrayOf(parseAsString),
    issueGroupId: parseAsInteger,
    isClassified: parseAsBoolean,
    isAssigned: parseAsBoolean,
    hasUnreadMessages: parseAsBoolean,
    priority: parseAsArrayOf(parseAsStringEnum([...LEAD_PRIORITY_ORDER])),
  });

  // When "all" is selected, pass all statuses to show all conversations regardless of status
  const allStatuses = ["open", "waiting_on_customer", "closed", "spam", "check_back_later", "ignored"] as const;
  const input = {
    status: searchParams.status === "all" ? [...allStatuses] : searchParams.status ? [searchParams.status] : ["open"],
    sort: searchParams.sort,
    category: params.category,
    search: searchParams.search ?? null,
    assignee: searchParams.assignee ?? undefined,
    createdAfter: searchParams.createdAfter ?? undefined,
    createdBefore: searchParams.createdBefore ?? undefined,
    repliedBy: searchParams.repliedBy ?? undefined,
    customer: searchParams.customer ?? undefined,
    issueGroupId: searchParams.issueGroupId ?? undefined,
    isClassified: searchParams.isClassified ?? undefined,
    isAssigned: searchParams.isAssigned ?? undefined,
    hasUnreadMessages: searchParams.hasUnreadMessages ?? undefined,
    priority: searchParams.priority?.length ? searchParams.priority : undefined,
    displayUnreadBehavior: ["mine", "assigned"].includes(params.category),
  };

  return { input, searchParams, setSearchParams };
};
