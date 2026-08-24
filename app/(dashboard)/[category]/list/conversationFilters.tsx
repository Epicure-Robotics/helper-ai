import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useDebouncedCallback } from "@/components/useDebouncedCallback";
import { type LeadPriorityValue } from "@/lib/leads/leadPriority";
import { useConversationsListInput } from "../shared/queries";
import { AssigneeFilter } from "./filters/assigneeFilter";
import { CustomerFilter } from "./filters/customerFilter";
import { DateFilter } from "./filters/dateFilter";
import { IssueGroupFilter } from "./filters/issueGroupFilter";
import { PriorityFilter } from "./filters/priorityFilter";
import { ResponderFilter } from "./filters/responderFilter";
import { UnreadMessagesFilter } from "./filters/unreadMessagesFilter";

interface FilterValues {
  assignee: string[];
  createdAfter: string | null;
  createdBefore: string | null;
  repliedBy: string[];
  customer: string[];
  issueGroupId: number | null;
  isClassified: boolean | undefined;
  isAssigned: boolean | undefined;
  hasUnreadMessages: boolean | undefined;
  priority: LeadPriorityValue[];
}

interface ConversationFiltersProps {
  filterValues: FilterValues;
  onUpdateFilter: (updates: Partial<FilterValues>) => void;
  onClearFilters: () => void;
  activeFilterCount: number;
}

export const useConversationFilters = () => {
  const { searchParams, setSearchParams } = useConversationsListInput();

  const [filterValues, setFilterValues] = useState<FilterValues>({
    assignee: searchParams.isAssigned === false ? ["unassigned"] : (searchParams.assignee ?? []),
    createdAfter: searchParams.createdAfter ?? null,
    createdBefore: searchParams.createdBefore ?? null,
    repliedBy: searchParams.repliedBy ?? [],
    customer: searchParams.customer ?? [],
    issueGroupId: searchParams.issueGroupId ?? null,
    isClassified: searchParams.isClassified ?? undefined,
    isAssigned: searchParams.isAssigned ?? undefined,
    hasUnreadMessages: searchParams.hasUnreadMessages ?? undefined,
    priority: searchParams.priority ?? [],
  });

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filterValues.assignee.length > 0) count++;
    if (filterValues.createdAfter || filterValues.createdBefore) count++;
    if (filterValues.repliedBy.length > 0) count++;
    if (filterValues.customer.length > 0) count++;
    if (filterValues.issueGroupId !== null || filterValues.isClassified !== undefined) count++;
    if (filterValues.isAssigned !== undefined) count++;
    if (filterValues.hasUnreadMessages !== undefined) count++;
    if (filterValues.priority.length > 0) count++;
    return count;
  }, [filterValues]);

  const debouncedSetFilters = useDebouncedCallback((newFilters: Partial<FilterValues>) => {
    setSearchParams((prev) => ({ ...prev, ...newFilters }));
  }, 300);

  useEffect(() => {
    setFilterValues({
      assignee: searchParams.assignee ?? [],
      createdAfter: searchParams.createdAfter ?? null,
      createdBefore: searchParams.createdBefore ?? null,
      repliedBy: searchParams.repliedBy ?? [],
      customer: searchParams.customer ?? [],
      issueGroupId: searchParams.issueGroupId ?? null,
      isClassified: searchParams.isClassified ?? undefined,
      isAssigned: searchParams.isAssigned ?? undefined,
      hasUnreadMessages: searchParams.hasUnreadMessages ?? undefined,
      priority: searchParams.priority ?? [],
    });
  }, [searchParams]);

  const updateFilter = (updates: Partial<FilterValues>) => {
    setFilterValues((prev) => ({ ...prev, ...updates }));
    debouncedSetFilters(updates);
  };

  const clearFilters = () => {
    const clearedFilters = {
      assignee: null,
      createdAfter: null,
      createdBefore: null,
      repliedBy: null,
      customer: null,
      issueGroupId: null,
      isClassified: null,
      isAssigned: null,
      hasUnreadMessages: null,
      priority: null,
    };
    setSearchParams((prev) => ({ ...prev, ...clearedFilters }));
  };

  return {
    filterValues,
    activeFilterCount,
    updateFilter,
    clearFilters,
  };
};

export const ConversationFilters = ({
  filterValues,
  onUpdateFilter,
  activeFilterCount,
  onClearFilters,
}: ConversationFiltersProps) => {
  const { input } = useConversationsListInput();

  const handleUnreadMessagesChange = useCallback(
    (hasUnreadMessages: boolean | undefined) => {
      onUpdateFilter({ hasUnreadMessages });
    },
    [onUpdateFilter],
  );

  return (
    <div className="flex w-full items-center gap-2 overflow-x-auto scrollbar-hidden py-0.5 px-0.5">
      <DateFilter
        startDate={filterValues.createdAfter}
        endDate={filterValues.createdBefore}
        onSelect={(startDate, endDate) => {
          onUpdateFilter({ createdAfter: startDate, createdBefore: endDate });
        }}
      />
      {input.displayUnreadBehavior && (
        <UnreadMessagesFilter
          hasUnreadMessages={filterValues.hasUnreadMessages}
          onChange={handleUnreadMessagesChange}
        />
      )}
      {input.category === "all" && (
        <AssigneeFilter
          includeUnassigned={input.category === "all"}
          selectedAssignees={filterValues.isAssigned === false ? ["unassigned"] : filterValues.assignee}
          onChange={(assignees) => {
            const hasUnassigned = assignees.includes("unassigned");
            const memberAssignees = assignees.filter((id) => id !== "unassigned");
            onUpdateFilter({
              assignee: memberAssignees,
              isAssigned: hasUnassigned ? false : memberAssignees.length > 0 ? true : undefined,
            });
          }}
        />
      )}
      <ResponderFilter
        selectedResponders={filterValues.repliedBy}
        onChange={(responders) => onUpdateFilter({ repliedBy: responders })}
      />
      <CustomerFilter
        selectedCustomers={filterValues.customer}
        onChange={(customers) => onUpdateFilter({ customer: customers })}
      />
      <PriorityFilter priority={filterValues.priority} onChange={(priority) => onUpdateFilter({ priority })} />
      <IssueGroupFilter
        issueGroupId={filterValues.issueGroupId}
        isClassified={filterValues.isClassified}
        onChange={(issueGroupId, isClassified) => onUpdateFilter({ issueGroupId, isClassified })}
      />
      {activeFilterCount > 0 && (
        <>
          <div className="h-4 w-px bg-border mx-1 shrink-0" />
          <Button
            aria-label="Clear Filters"
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground hover:text-foreground px-2"
            onClick={onClearFilters}
          >
            Clear
          </Button>
        </>
      )}
    </div>
  );
};
