import {
  CornerUpLeft as ArrowUturnLeftIcon,
  CornerRightUp as ArrowUturnUpIcon,
  MessageSquare as ChatBubbleLeftIcon,
  Mail as EnvelopeIcon,
  PenSquare as PencilSquareIcon,
  Play as PlayIcon,
  MessageSquareText as SavedReplyIcon,
  ShieldAlert as ShieldExclamationIcon,
  Sparkles as SparklesIcon,
  User as UserIcon,
} from "lucide-react";
import { useCallback, useMemo, useRef } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { toast } from "sonner";
import { useConversationContext } from "@/app/(dashboard)/[category]/conversation/conversationContext";
import { Tool } from "@/app/(dashboard)/[category]/ticketCommandBar/toolForm";
import { isInDialog } from "@/components/isInDialog";
import { captureExceptionAndLog } from "@/lib/shared/sentry";
import { RouterOutputs } from "@/trpc";
import { api } from "@/trpc/react";
import { CommandGroup } from "./types";

type SavedReply = RouterOutputs["mailbox"]["savedReplies"]["list"][number];

type MainPageProps = {
  onOpenChange: (open: boolean) => void;
  setPage: (page: "main" | "previous-replies" | "assignees" | "notes") => void;
  setSelectedItemId: (id: string | null) => void;
  onToggleCc: () => void;
  setSelectedTool: (tool: Tool) => void;
  onInsertReply: (content: string, isHtmlTemplate?: boolean, templateName?: string) => void;
  onOpenGenerateDraftDialog: () => void;
  onShowVariableDialog?: (savedReply: SavedReply) => void;
};

export const useMainPage = ({
  onOpenChange,
  setPage,
  setSelectedItemId,
  onToggleCc,
  setSelectedTool,
  onInsertReply,
  onOpenGenerateDraftDialog,
  onShowVariableDialog,
}: MainPageProps): { commandGroups: CommandGroup[] } => {
  const { data: conversation, updateStatus, conversationSlug } = useConversationContext();

  const { data: tools } = api.mailbox.conversations.tools.list.useQuery(
    { conversationSlug },
    { staleTime: Infinity, refetchOnMount: false, refetchOnWindowFocus: false, enabled: !!conversationSlug },
  );

  const { data: savedReplies } = api.mailbox.savedReplies.list.useQuery(
    { onlyActive: true },
    { refetchOnWindowFocus: false, refetchOnMount: true },
  );

  const { mutate: incrementSavedReplyUsage } = api.mailbox.savedReplies.incrementUsage.useMutation();

  useHotkeys(
    "n",
    () => {
      onOpenChange(true);
      setPage("notes");
      setSelectedItemId(null);
    },
    {
      enabled: () => !isInDialog(),
      preventDefault: true,
    },
  );

  const handleSavedReplySelect = useCallback(
    (savedReply: SavedReply) => {
      console.log("[handleSavedReplySelect]", {
        name: savedReply.name,
        templateType: savedReply.templateType,
        hasVariables: savedReply.variables?.length,
        variables: savedReply.variables,
      });

      try {
        if (!onInsertReply) {
          throw new Error("onInsertReply function is not available");
        }

        // Check if this is an HTML template with variables
        if (savedReply.templateType === "html_template" && savedReply.variables && savedReply.variables.length > 0) {
          // Show the variable dialog
          if (onShowVariableDialog) {
            onShowVariableDialog(savedReply);
            onOpenChange(false);
          } else {
            toast.error("Variable dialog not available");
          }
          return;
        }

        // No variables, insert directly
        console.log("[handleSavedReplySelect] Inserting reply", {
          isHtmlTemplate: savedReply.templateType === "html_template",
          templateName: savedReply.name,
        });
        onInsertReply(savedReply.content, savedReply.templateType === "html_template", savedReply.name);
        onOpenChange(false);

        // Track usage separately - don't fail the insertion if tracking fails
        incrementSavedReplyUsage(
          { slug: savedReply.slug },
          {
            onError: (error) => {
              // Log tracking error but don't show to user since content was inserted successfully
              captureExceptionAndLog("Failed to track saved reply usage:", error);
            },
          },
        );
      } catch (error) {
        captureExceptionAndLog("Failed to insert saved reply content", {
          extra: {
            error,
          },
        });
        toast.error("Failed to insert saved reply", {
          description: "Could not insert the saved reply content. Please try again.",
        });
      }
    },
    [onInsertReply, incrementSavedReplyUsage, onOpenChange, onShowVariableDialog],
  );

  const commandGroups = useMemo(
    () => [
      {
        heading: "Actions",
        items: [
          {
            id: "close",
            label: "Close ticket",
            icon: ArrowUturnLeftIcon,
            onSelect: () => {
              updateStatus("closed");
              onOpenChange(false);
            },
            shortcut: "C",
            hidden: conversation?.status === "closed" || conversation?.status === "spam",
          },
          {
            id: "waiting-on-customer",
            label: conversation?.status === "waiting_on_customer" ? "Mark active" : "Waiting on user",
            icon: UserIcon,
            onSelect: () => {
              updateStatus(conversation?.status === "waiting_on_customer" ? "open" : "waiting_on_customer");
              onOpenChange(false);
            },
            shortcut: "W",
            hidden: conversation?.status === "closed" || conversation?.status === "spam",
          },
          {
            id: "check-back-later",
            label: "Check back later",
            icon: UserIcon,
            onSelect: () => {
              updateStatus("check_back_later");
              onOpenChange(false);
            },
            shortcut: "B",
            hidden:
              conversation?.status === "closed" ||
              conversation?.status === "spam" ||
              conversation?.status === "check_back_later",
          },
          {
            id: "reopen",
            label: "Reopen ticket",
            icon: ArrowUturnUpIcon,
            onSelect: () => {
              updateStatus("open");
              onOpenChange(false);
            },
            shortcut: "Z",
            hidden: conversation?.status === "open",
          },
          {
            id: "assign",
            label: "Assign ticket",
            icon: UserIcon,
            onSelect: () => {
              setPage("assignees");
              setSelectedItemId(null);
            },
            shortcut: "A",
          },
          {
            id: "spam",
            label: "Mark as spam",
            icon: ShieldExclamationIcon,
            onSelect: () => {
              updateStatus("spam");
              onOpenChange(false);
            },
            shortcut: "S",
            hidden: conversation?.status === "spam",
          },
          {
            id: "add-note",
            label: "Add internal note",
            icon: PencilSquareIcon,
            onSelect: () => {
              setPage("notes");
              setSelectedItemId(null);
            },
            shortcut: "N",
          },
        ],
      },
      {
        heading: "Compose",
        items: [
          {
            id: "generate-draft",
            label: "Generate draft",
            icon: SparklesIcon,
            onSelect: () => {
              onOpenGenerateDraftDialog();
              onOpenChange(false);
            },
          },
          {
            id: "previous-replies",
            label: "Use previous replies",
            icon: ChatBubbleLeftIcon,
            onSelect: () => {
              setPage("previous-replies");
              setSelectedItemId(null);
            },
          },
          {
            id: "toggle-cc-bcc",
            label: "Add CC or BCC",
            icon: EnvelopeIcon,
            onSelect: () => {
              onToggleCc();
              onOpenChange(false);
            },
          },
        ],
      },
      ...(savedReplies && savedReplies.length > 0
        ? [
            {
              heading: "Saved replies",
              items: savedReplies.map((savedReply) => ({
                id: savedReply.slug,
                label: savedReply.name,
                icon: SavedReplyIcon,
                onSelect: () => handleSavedReplySelect(savedReply),
              })),
            },
          ]
        : []),
      ...(tools && tools.all.length > 0
        ? [
            {
              heading: "Tools",
              items: tools.all.map((tool) => ({
                id: tool.slug,
                label: tool.name,
                icon: PlayIcon,
                onSelect: () => setSelectedTool(tool),
              })),
            },
          ]
        : []),
    ],
    [onOpenChange, conversation, tools?.suggested, onToggleCc, savedReplies, handleSavedReplySelect],
  );

  return { commandGroups };
};

export const useGenerateDraft = () => {
  const { conversationSlug } = useConversationContext();
  const utils = api.useUtils();

  const dismissToastRef = useRef<() => void>(() => {});
  const { mutate: generateDraft } = api.mailbox.conversations.generateDraft.useMutation({
    onMutate: () => {
      const toastId = toast("Generating draft...", {
        duration: 30_000,
      });
      dismissToastRef.current = () => toast.dismiss(toastId);
    },
    onSuccess: (draft) => {
      dismissToastRef.current?.();
      if (draft) {
        utils.mailbox.conversations.get.setData({ conversationSlug }, (data) => (data ? { ...data, draft } : data));
      } else {
        toast.error("Error generating draft");
      }
    },
    onError: (error) => {
      dismissToastRef.current?.();
      if (error.data?.code === "BAD_REQUEST") {
        toast.warning("Can't generate draft yet", { description: error.message });
        return;
      }
      toast.error("Couldn't generate draft", { description: error.message });
    },
  });

  return generateDraft;
};
