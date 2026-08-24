import { Archive, Ban, Forward, RotateCcw, UserPlus } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { toast } from "sonner";
import { ConversationListItem as ConversationItem } from "@/app/types/global";
import { AssigneeOption, AssignSelect } from "@/components/assignSelect";
import { ConfirmationDialog } from "@/components/confirmationDialog";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FilterButton } from "@/components/ui/filter-button";
import { Tooltip, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useSelected } from "@/components/useSelected";
import { useShiftSelected } from "@/components/useShiftSelected";
import { conversationsListChannelId } from "@/lib/realtime/channels";
import { useRealtimeEvent } from "@/lib/realtime/hooks";
import { generateSlug } from "@/lib/shared/slug";
import { api } from "@/trpc/react";
import { useConversationsListInput } from "../shared/queries";
import { BulkForwardDialog } from "./bulkForwardDialog";
import { ConversationFilters, useConversationFilters } from "./conversationFilters";
import { useConversationListContext } from "./conversationListContext";
import { ConversationListItem } from "./conversationListItem";
import { ConversationListSkeleton } from "./conversationListSkeleton";
import { ConversationSearchBar } from "./conversationSearchBar";
import { NoConversations } from "./emptyState";
import NewConversationModalContent from "./newConversationModal";

export const List = () => {
  const { searchParams, input } = useConversationsListInput();
  const {
    conversationListData,
    navigateToConversation,
    isPending,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useConversationListContext();

  /**
   * Starts closed on both server and client, then restores the saved preference after mount.
   *
   * Reading localStorage in the useState initialiser made the server render the bar closed and the
   * client render it open, which is a hydration mismatch: React throws away the server tree and
   * re-renders the whole list on the client.
   */
  const [showFilters, setShowFilters] = useState(false);
  const [filtersRestored, setFiltersRestored] = useState(false);
  const { filterValues, activeFilterCount, updateFilter, clearFilters } = useConversationFilters();

  useEffect(() => {
    setShowFilters(localStorage.getItem("conversationFiltersVisible") === "true");
    setFiltersRestored(true);
  }, []);

  useEffect(() => {
    // Don't persist the pre-restore default, or the first render would clear a saved "open".
    if (!filtersRestored) return;
    localStorage.setItem("conversationFiltersVisible", String(showFilters));
  }, [showFilters, filtersRestored]);
  const [allConversationsSelected, setAllConversationsSelected] = useState(false);
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);
  const utils = api.useUtils();
  const { mutate: bulkUpdate } = api.mailbox.conversations.bulkUpdate.useMutation({
    onError: (err) => {
      toast.error("Failed to update conversations", { description: err.message });
    },
  });

  const conversations = conversationListData?.conversations ?? [];
  const defaultSort = conversationListData?.defaultSort;
  const supportsHighestValueSort = conversationListData?.supportsHighestValueSort ?? false;

  const loadMoreRef = useRef<HTMLDivElement>(null);
  const resultsContainerRef = useRef<HTMLDivElement>(null);

  const {
    selected: selectedConversations,
    change: changeSelectedConversations,
    clear: clearSelectedConversations,
    set: setSelectedConversations,
  } = useSelected<number>([]);

  const onShiftSelectConversation = useShiftSelected<number>(
    conversations.map((c) => c.id),
    changeSelectedConversations,
  );

  const toggleConversation = (id: number, isSelected: boolean, shiftKey: boolean) => {
    if (allConversationsSelected) {
      // If all conversations are selected, toggle the selected conversation
      setAllConversationsSelected(false);
      setSelectedConversations(conversations.flatMap((c) => (c.id === id ? [] : [c.id])));
    } else {
      onShiftSelectConversation(id, isSelected, shiftKey);
    }
  };

  const toggleAllConversations = (forceValue?: boolean) => {
    setAllConversationsSelected((prev) => forceValue ?? !prev);
    clearSelectedConversations();
  };

  const handleBulkUpdate = (
    status: "open" | "waiting_on_customer" | "closed" | "spam" | "check_back_later" | "ignored",
  ) => {
    setIsBulkUpdating(true);
    try {
      const conversationFilter = allConversationsSelected
        ? conversations.length <= 25 && !hasNextPage
          ? conversations.map((c) => c.id)
          : input
        : selectedConversations;

      bulkUpdate(
        {
          conversationFilter,
          status,
        },
        {
          onSuccess: ({ updatedImmediately }) => {
            setAllConversationsSelected(false);
            clearSelectedConversations();
            void utils.mailbox.conversations.list.invalidate();
            void utils.mailbox.conversations.count.invalidate();

            if (updatedImmediately) {
              const ticketsText = allConversationsSelected
                ? "All matching tickets"
                : `${selectedConversations.length} ticket${selectedConversations.length === 1 ? "" : "s"}`;

              const actionText = status === "open" ? "reopened" : status === "closed" ? "closed" : "marked as spam";
              toast.success(`${ticketsText} ${actionText}`);
            } else {
              toast.success("Starting update, refresh to see status.");
            }
          },
        },
      );
    } finally {
      setIsBulkUpdating(false);
    }
  };

  const handleBulkAssign = (assignee: AssigneeOption | null) => {
    setIsBulkUpdating(true);
    try {
      const conversationFilter = allConversationsSelected
        ? conversations.length <= 25 && !hasNextPage
          ? conversations.map((c) => c.id)
          : input
        : selectedConversations;

      const assignedToId = assignee && "id" in assignee ? assignee.id : null;
      const assignedToAI = !!(assignee && "ai" in assignee);

      bulkUpdate(
        {
          conversationFilter,
          assignedToId,
          assignedToAI,
        },
        {
          onSuccess: ({ updatedImmediately }) => {
            setAllConversationsSelected(false);
            clearSelectedConversations();
            void utils.mailbox.conversations.list.invalidate();
            void utils.mailbox.conversations.count.invalidate();

            if (updatedImmediately) {
              const ticketsText = allConversationsSelected
                ? "All matching tickets"
                : `${selectedConversations.length} ticket${selectedConversations.length === 1 ? "" : "s"}`;

              const assigneeName =
                assignee && "displayName" in assignee
                  ? assignee.displayName
                  : assignee && "ai" in assignee
                    ? "AI assistant"
                    : "Unassigned";
              toast.success(`${ticketsText} assigned to ${assigneeName}`);
            } else {
              toast.success("Starting update, refresh to see assignment.");
            }
          },
        },
      );
    } finally {
      setIsBulkUpdating(false);
    }
  };

  const [pendingBulkAssignee, setPendingBulkAssignee] = useState<AssigneeOption | null>(null);

  useEffect(() => {
    if (!pendingBulkAssignee) return;

    const count = allConversationsSelected ? "all matching" : selectedConversations.length;
    const assigneeName =
      "id" in pendingBulkAssignee
        ? pendingBulkAssignee.displayName
        : "ai" in pendingBulkAssignee
          ? "AI assistant"
          : "Unassigned";

    if (allConversationsSelected || selectedConversations.length > 1) {
      const confirmed = window.confirm(`Are you sure you want to assign ${count} tickets to ${assigneeName}?`);
      if (confirmed) {
        handleBulkAssign(pendingBulkAssignee);
      }
    } else {
      handleBulkAssign(pendingBulkAssignee);
    }
    setPendingBulkAssignee(null);
  }, [pendingBulkAssignee, allConversationsSelected, selectedConversations.length]);

  useEffect(() => {
    const currentRef = loadMoreRef.current;
    if (!currentRef || !hasNextPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: "500px", root: resultsContainerRef.current },
    );

    observer.observe(currentRef);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  useHotkeys("mod+a", () => toggleAllConversations(true), {
    enableOnFormTags: false,
    preventDefault: true,
  });

  // Clear selections when status filter changes
  useEffect(() => {
    toggleAllConversations(false);
  }, [searchParams.status, clearSelectedConversations]);

  useRealtimeEvent(conversationsListChannelId(), "conversation.new", (message) => {
    const newConversation = message.data as ConversationItem;
    if (newConversation.status !== (searchParams.status ?? "open")) return;

    switch (input.category) {
      case "all":
        break;
      case "assigned":
        if (!newConversation.assignedToId) return;
        break;
      case "mine": {
        const firstAssignedId = conversationListData?.assignedToIds?.[0];
        if (firstAssignedId !== undefined && newConversation.assignedToId !== firstAssignedId) return;
        break;
      }
      default:
        break;
    }

    void utils.mailbox.conversations.list.invalidate();
    void utils.mailbox.openCount.invalidate();
  });

  const conversationsText = allConversationsSelected
    ? "all matching conversations"
    : `${selectedConversations.length} conversation${selectedConversations.length === 1 ? "" : "s"}`;

  return (
    <div className="flex w-full h-full">
      {/* Main conversation list */}
      <div className="flex flex-col flex-1 min-w-0 h-full">
        <div className="px-3 md:px-6 py-2.5 shrink-0 border-b border-border/70">
          <div className="flex flex-col gap-2">
            <ConversationSearchBar
              toggleAllConversations={toggleAllConversations}
              allConversationsSelected={allConversationsSelected}
              activeFilterCount={activeFilterCount}
              defaultSort={defaultSort}
              supportsHighestValueSort={supportsHighestValueSort}
              showFilters={showFilters}
              setShowFilters={setShowFilters}
              conversationCount={conversations.length}
            />
            {(allConversationsSelected || selectedConversations.length > 0) && (
              <div className="flex items-center justify-between gap-4 px-1 animate-in fade-in slide-in-from-top-1">
                <div className="flex items-center gap-2 overflow-x-auto scrollbar-hidden">
                  <TooltipProvider delayDuration={0}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center gap-2 mr-2">
                          <Badge variant="bright" className="text-xs font-bold rounded-sm px-1.5">
                            {allConversationsSelected ? "ALL" : selectedConversations.length}
                          </Badge>
                          <span className="text-sm font-medium text-muted-foreground whitespace-nowrap">
                            {allConversationsSelected ? "All matching" : "selected"}
                          </span>
                        </div>
                      </TooltipTrigger>
                    </Tooltip>
                  </TooltipProvider>

                  <div className="h-4 w-px bg-border mx-1 shrink-0" />

                  <div className="flex items-center gap-1">
                    {searchParams.status !== "open" && (
                      <ConfirmationDialog
                        message={`Are you sure you want to reopen ${conversationsText}?`}
                        onConfirm={() => handleBulkUpdate("open")}
                        confirmLabel="Yes, reopen"
                        confirmVariant="bright"
                      >
                        <FilterButton label="Reopen" icon={RotateCcw} disabled={isBulkUpdating} />
                      </ConfirmationDialog>
                    )}
                    {searchParams.status !== "closed" && (
                      <ConfirmationDialog
                        message={`Are you sure you want to close ${conversationsText}?`}
                        onConfirm={() => handleBulkUpdate("closed")}
                        confirmLabel="Yes, close"
                        confirmVariant="bright"
                      >
                        <FilterButton label="Close" icon={Archive} disabled={isBulkUpdating} />
                      </ConfirmationDialog>
                    )}

                    {searchParams.status !== "spam" && (
                      <ConfirmationDialog
                        message={`Are you sure you want to mark ${conversationsText} as spam?`}
                        onConfirm={() => handleBulkUpdate("spam")}
                        confirmLabel="Yes, mark as spam"
                        confirmVariant="bright"
                      >
                        <FilterButton label="Spam" icon={Ban} disabled={isBulkUpdating} />
                      </ConfirmationDialog>
                    )}
                    <BulkForwardDialog
                      conversationSlugs={
                        allConversationsSelected
                          ? conversations.map((c) => c.slug)
                          : conversations.filter((c) => selectedConversations.includes(c.id)).map((c) => c.slug)
                      }
                      onSuccess={() => {
                        setAllConversationsSelected(false);
                        clearSelectedConversations();
                      }}
                    >
                      <FilterButton label="Forward" icon={Forward} disabled={isBulkUpdating} />
                    </BulkForwardDialog>
                    <AssignSelect
                      onChange={setPendingBulkAssignee}
                      aiOption
                      trigger={<FilterButton label="Assign" icon={UserPlus} disabled={isBulkUpdating} />}
                    />
                  </div>
                </div>
              </div>
            )}
            {showFilters && (
              <ConversationFilters
                filterValues={filterValues}
                onUpdateFilter={updateFilter}
                onClearFilters={clearFilters}
                activeFilterCount={activeFilterCount}
              />
            )}
          </div>
        </div>
        {isPending || (isFetching && conversations.length === 0) ? (
          <div className="flex-1 px-4">
            <ConversationListSkeleton count={8} />
          </div>
        ) : conversations.length === 0 ? (
          <NoConversations filtered={activeFilterCount > 0 || !!input.search} onClearFilters={clearFilters} />
        ) : (
          <div ref={resultsContainerRef} className="flex-1 overflow-y-auto">
            {conversations.map((conversation) => (
              <ConversationListItem
                key={conversation.slug}
                conversation={conversation}
                onSelectConversation={navigateToConversation}
                isSelected={allConversationsSelected || selectedConversations.includes(conversation.id)}
                onToggleSelect={(isSelected, shiftKey) => toggleConversation(conversation.id, isSelected, shiftKey)}
              />
            ))}
            <div ref={loadMoreRef} />
            {isFetchingNextPage && (
              <div className="flex justify-center py-4">
                <ConversationListSkeleton count={3} />
              </div>
            )}
          </div>
        )}
        <NewConversationModal />
      </div>
    </div>
  );
};

const NewConversationModal = () => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [newConversationModalOpen, setNewConversationModalOpen] = useState(false);
  const [newConversationSlug, setNewConversationSlug] = useState(generateSlug());
  useEffect(() => {
    if (newConversationModalOpen) setNewConversationSlug(generateSlug());
  }, [newConversationModalOpen]);

  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setNewConversationModalOpen(true);
    }
  }, [searchParams]);

  const closeModal = () => {
    setNewConversationModalOpen(false);

    const next = new URLSearchParams(searchParams.toString());
    if (next.get("new") === "1") {
      next.delete("new");
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname);
    }
  };

  return (
    <Dialog
      open={newConversationModalOpen}
      onOpenChange={(open) => {
        if (!open) closeModal();
        else setNewConversationModalOpen(true);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New message</DialogTitle>
          <DialogDescription className="sr-only">Compose and send a new conversation.</DialogDescription>
        </DialogHeader>
        <NewConversationModalContent conversationSlug={newConversationSlug} onSubmit={closeModal} />
      </DialogContent>
    </Dialog>
  );
};
