import { isMacOS } from "@tiptap/core";
import { ChevronDown, CornerUpLeft, Eye, Lightbulb, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { toast } from "sonner";
import { create } from "zustand";
import { useConversationContext } from "@/app/(dashboard)/[category]/conversation/conversationContext";
import { FollowButton } from "@/app/(dashboard)/[category]/conversation/followButton";
import { EmailSignature } from "@/app/(dashboard)/[category]/emailSignature";
import { DraftedEmail } from "@/app/types/global";
import { useFileUpload } from "@/components/fileUploadContext";
import { GenerateKnowledgeBankDialog } from "@/components/generateKnowledgeBankDialog";
import { useSpeechRecognition } from "@/components/hooks/useSpeechRecognition";
import { isInDialog } from "@/components/isInDialog";
import LabeledInput from "@/components/labeledInput";
import TipTapEditor, { type TipTapEditorRef } from "@/components/tiptap/editor";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HtmlTemplatePreview } from "@/components/ui/htmlTemplatePreview";
import { useBreakpoint } from "@/components/useBreakpoint";
import { useDebouncedCallback } from "@/components/useDebouncedCallback";
import { useSession } from "@/components/useSession";
import { parseEmailList } from "@/components/utils/email";
import { publicConversationChannelId } from "@/lib/realtime/channels";
import { useBroadcastRealtimeEvent } from "@/lib/realtime/hooks";
import { captureExceptionAndLog } from "@/lib/shared/sentry";
import { cn } from "@/lib/utils";
import { RouterOutputs } from "@/trpc";
import { api } from "@/trpc/react";
import { useConversationListContext } from "../list/conversationListContext";
import { useConversationsListInput } from "../shared/queries";
import { TicketCommandBar } from "../ticketCommandBar";
import { useUndoneEmailStore } from "./useUndoneEmailStore";

export const FAILED_ATTACHMENTS_TOOLTIP_MESSAGE = "Remove the failed file attachments first";

export const isEmptyContent = (text: string | undefined) => {
  if (!text?.trim()) return true;
  const domParser = new DOMParser();
  const dom = domParser.parseFromString(text, "text/html");
  return !dom.documentElement.textContent && !dom.querySelector('img[src]:not([src=""])');
};

export const useSendDisabled = (
  message: string | undefined,
  htmlBody: string | undefined,
  conversationStatus?: string | null,
) => {
  const [sending, setSending] = useState(false);
  const { uploading, failedAttachmentsExist, hasReadyFileAttachments } = useFileUpload();

  const hasContent = !isEmptyContent(message) || !!htmlBody;

  const sendDisabled =
    sending ||
    (!hasContent && !hasReadyFileAttachments) ||
    uploading ||
    failedAttachmentsExist ||
    conversationStatus === "closed" ||
    conversationStatus === "spam";
  return { sendDisabled, sending, setSending };
};

const useKnowledgeBankDialogState = create<
  ({ isVisible: false } | { isVisible: true; messageId: number }) & {
    show: (messageId: number) => void;
    hide: () => void;
  }
>((set) => ({
  isVisible: false,
  show: (messageId) => set({ isVisible: true, messageId }),
  hide: () => set({ isVisible: false }),
}));

export const useAlternateHotkeyInEditor = (normalKey: string, alternateKey: string, callback: () => void) => {
  useHotkeys(normalKey, callback, {
    preventDefault: true,
    enabled: () => !isInDialog(),
  });
  useHotkeys(alternateKey, callback, {
    enableOnContentEditable: true,
    enableOnFormTags: true,
    preventDefault: true,
    enabled: () => !isInDialog(),
  });
};

type ConversationItem = NonNullable<RouterOutputs["mailbox"]["conversations"]["get"]>["messages"][number];
type ConversationMessage = Extract<ConversationItem, { type: "message" }>;

/**
 * `Array.filter` with a plain boolean callback does not narrow the result, so the timeline union
 * (message | note | event | ...) survives and `.role` is unreachable on it. A type predicate keeps
 * the narrowing that the `type === "message"` check already proves.
 */
const isMessageWithRole =
  (...roles: ConversationMessage["role"][]) =>
  (item: ConversationItem): item is ConversationMessage =>
    item.type === "message" && roles.includes(item.role);

export const MessageActions = () => {
  const { navigateToConversation, removeConversation } = useConversationListContext();
  const { data: conversation, updateStatus } = useConversationContext();
  const { searchParams } = useConversationsListInput();
  const utils = api.useUtils();
  const { isAboveMd } = useBreakpoint("md");

  const broadcastEvent = useBroadcastRealtimeEvent();
  const lastTypingBroadcastRef = useRef<number>(0);

  const handleTypingEvent = useCallback(
    (conversationSlug: string) => {
      const now = Date.now();
      if (now - lastTypingBroadcastRef.current >= 8000) {
        broadcastEvent(publicConversationChannelId(conversationSlug), "agent-typing", {
          timestamp: now,
        });
        lastTypingBroadcastRef.current = now;
      }
    },
    [broadcastEvent],
  );

  const { user } = useSession() ?? {};

  const shouldAutoAssign = !!user?.preferences?.autoAssignOnReply && !conversation?.assignedToId;

  const replyMutation = api.mailbox.conversations.messages.reply.useMutation({
    onSuccess: (_, variables) => {
      // Non-blocking invalidation - don't await, let it happen in background
      utils.mailbox.conversations.get.invalidate({
        conversationSlug: variables.conversationSlug,
      });
    },
  });

  useHotkeys(
    "z",
    () => {
      if (conversation?.status === "closed" || conversation?.status === "spam") {
        updateStatus("open");
      }
    },
    { enabled: () => !isInDialog() },
  );

  useAlternateHotkeyInEditor("s", "mod+shift+s", () => {
    if (conversation?.status !== "spam") {
      updateStatus("spam");
    }
  });

  useAlternateHotkeyInEditor("c", "mod+shift+c", () => {
    if (conversation?.status !== "closed") {
      updateStatus("closed");
    }
  });

  // Backend draft management
  const saveDraftMutation = api.mailbox.conversations.saveDraft.useMutation();
  const deleteDraftMutation = api.mailbox.conversations.deleteDraft.useMutation();
  const { data: serverDraft } = api.mailbox.conversations.getDraft.useQuery(
    { conversationSlug: conversation?.slug ?? "" },
    { enabled: !!conversation?.slug },
  );

  const [currentDraftVersion, setCurrentDraftVersion] = useState<number>(0);

  const initialMessage = conversation?.draft?.body ?? serverDraft?.body ?? "";
  const generateInitialDraftedEmail = (conversation: RouterOutputs["mailbox"]["conversations"]["get"] | null) => {
    return {
      to: serverDraft?.emailTo ?? conversation?.emailFrom ?? "",
      cc: serverDraft?.emailCc?.join(", ") ?? conversation?.cc ?? "",
      bcc: serverDraft?.emailBcc?.join(", ") ?? "",
      message: initialMessage,
      files: [],
      modified: false,
    };
  };
  const [draftedEmail, setDraftedEmail] = useState<DraftedEmail & { modified: boolean }>(
    generateInitialDraftedEmail(conversation),
  );
  const [initialMessageObject, setInitialMessageObject] = useState({ content: "" });
  const { undoneEmail, setUndoneEmail } = useUndoneEmailStore();

  // Debounced auto-save to backend (every 3 seconds)
  const debouncedSaveDraft = useDebouncedCallback((content: string, to: string, cc: string, bcc: string) => {
    if (!conversation?.slug || isEmptyContent(content)) return;

    saveDraftMutation.mutate(
      {
        conversationSlug: conversation.slug,
        message: content,
        to: to || null,
        cc: cc ? cc.split(",").map((e) => e.trim()) : null,
        bcc: bcc ? bcc.split(",").map((e) => e.trim()) : null,
        version: currentDraftVersion,
      },
      {
        onSuccess: (data) => {
          setCurrentDraftVersion(data.draftVersion);
        },
        onError: (error) => {
          if (error.message.includes("DRAFT_CONFLICT")) {
            toast.error("Draft conflict detected", {
              description: "Another team member edited this draft. Refreshing...",
            });
            utils.mailbox.conversations.get.invalidate();
          }
        },
      },
    );
  }, 3000);

  useEffect(() => {
    if (!conversation) return;

    if (!draftedEmail.modified) {
      const email = generateInitialDraftedEmail(conversation);
      setDraftedEmail(email);
      setInitialMessageObject({ content: email.message });
    }
  }, [conversation]);

  useEffect(() => {
    // Load staff draft from backend on mount
    if (serverDraft && !draftedEmail.modified) {
      const message = serverDraft.body ?? "";
      setDraftedEmail((prev) => ({
        ...prev,
        message,
        to: serverDraft.emailTo ?? prev.to,
        cc: serverDraft.emailCc?.join(", ") ?? prev.cc,
        bcc: serverDraft.emailBcc?.join(", ") ?? prev.bcc,
        modified: true,
      }));
      setInitialMessageObject({ content: message });
      setCurrentDraftVersion(serverDraft.draftVersion);
      if (editorRef.current?.editor && !editorRef.current.editor.isDestroyed) {
        editorRef.current.editor.commands.setContent(message);
      }
    }
  }, [serverDraft?.id]);

  useEffect(() => {
    if (conversation?.draft?.id) {
      const message = conversation?.draft.body ?? "";
      if (!draftedEmail.modified) {
        setDraftedEmail((email) => ({ ...email, message }));
        setInitialMessageObject({ content: message });
        editorRef.current?.editor?.commands.setContent(message);
      }
    }
  }, [conversation?.draft?.id]);

  const autoGenerateDraftMutation = api.mailbox.conversations.generateDraft.useMutation({
    onSuccess: (draft) => {
      if (draft) {
        utils.mailbox.conversations.get.setData({ conversationSlug: conversation?.slug ?? "" }, (data) =>
          data ? { ...data, draft } : data,
        );
      }
    },
    onError: (error) => {
      if (error.data?.code === "BAD_REQUEST") return;
      captureExceptionAndLog("[autoGenerateDraft]", error);
    },
  });
  const autoGenerateTriggeredForMessageRef = useRef<number | null>(null);

  const lastUserMessage = conversation?.messages
    ?.filter(isMessageWithRole("user"))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  const lastNonDraftMessage = conversation?.messages
    ?.filter(isMessageWithRole("user", "staff"))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  useEffect(() => {
    if (!conversation || !lastUserMessage || !lastNonDraftMessage) return;
    if (lastNonDraftMessage.role !== "user") return;
    if (conversation.draft || serverDraft?.body) return;
    if (conversation.status === "closed" || conversation.status === "spam") return;
    if (autoGenerateTriggeredForMessageRef.current === lastUserMessage.id) return;

    autoGenerateTriggeredForMessageRef.current = lastUserMessage.id;
    autoGenerateDraftMutation.mutate({ conversationSlug: conversation.slug });
  }, [conversation?.slug, conversation?.draft, serverDraft?.id, lastUserMessage?.id]);

  const [showCommandBar, setShowCommandBar] = useState(false);
  const [showCc, setShowCc] = useState(false);
  const toRef = useRef<HTMLInputElement>(null);
  const ccRef = useRef<HTMLInputElement>(null);
  const bccRef = useRef<HTMLInputElement>(null);
  const commandInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<TipTapEditorRef | null>(null);
  const [isEditorFocused, setIsEditorFocused] = useState(false);

  useEffect(() => {
    if (showCc) {
      toRef.current?.focus();
    }
  }, [showCc]);

  useEffect(() => {
    editorRef.current?.focus();
  }, []);

  const onToggleCc = useCallback(() => setShowCc((prev) => !prev), []);

  const handleSegment = useCallback((segment: string) => {
    if (editorRef.current?.editor) {
      editorRef.current.editor.commands.insertContent(segment);
    }
  }, []);

  const handleError = useCallback((error: string) => {
    toast.error(`Speech Recognition Error`, {
      description: error,
    });
  }, []);

  const {
    isSupported: isRecordingSupported,
    isRecording,
    startRecording,
    stopRecording,
  } = useSpeechRecognition({
    onSegment: handleSegment,
    onError: handleError,
  });

  const { readyFiles, resetFiles } = useFileUpload();
  const { sendDisabled, sending, setSending } = useSendDisabled(
    draftedEmail.message,
    draftedEmail.htmlBody,
    conversation?.status,
  );

  useEffect(() => {
    if (!conversation || !undoneEmail) return;

    const hasUnsavedChanges = draftedEmail.modified && !isEmptyContent(draftedEmail.message);

    if (hasUnsavedChanges) {
      const shouldOverwrite = confirm(
        "You have unsaved changes that will be lost. Do you want to continue with restoring the unsent message?",
      );

      if (!shouldOverwrite) {
        setUndoneEmail(undefined);
        return;
      }
    }

    setDraftedEmail({ ...undoneEmail, modified: true });
    setInitialMessageObject({ content: undoneEmail.message });
    resetFiles(undoneEmail.files);

    if (editorRef.current?.editor && !editorRef.current.editor.isDestroyed) {
      editorRef.current.editor.commands.setContent(undoneEmail.message);
    }

    setUndoneEmail(undefined);
  }, [undoneEmail, conversation]);

  const knowledgeBankDialogState = useKnowledgeBankDialogState();

  const handleSend = async ({ assign, close = false }: { assign: boolean; close?: boolean }) => {
    if (sendDisabled || !conversation?.slug) return;

    stopRecording();
    setSending(true);
    const originalDraftedEmail = { ...draftedEmail, files: readyFiles };

    try {
      const to = parseEmailList(draftedEmail.to);
      if (!to.success)
        return toast.error(`Invalid To email address: ${to.error.issues.map((issue) => issue.message).join(", ")}`);

      const cc = parseEmailList(draftedEmail.cc);
      if (!cc.success)
        return toast.error(`Invalid CC email address: ${cc.error.issues.map((issue) => issue.message).join(", ")}`);

      const bcc = parseEmailList(draftedEmail.bcc);
      if (!bcc.success)
        return toast.error(`Invalid BCC email address: ${bcc.error.issues.map((issue) => issue.message).join(", ")}`);

      const conversationSlug = conversation.slug;

      const lastUserMessage = conversation.messages
        ?.filter((m) => m.type === "message" && m.role === "user")
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

      const { id: emailId } = await replyMutation.mutateAsync({
        conversationSlug,
        message: draftedEmail.message,
        htmlBody: draftedEmail.htmlBody,
        fileSlugs: readyFiles.flatMap((f) => (f.slug ? [f.slug] : [])),
        to: to.data,
        cc: cc.data,
        bcc: bcc.data,
        shouldAutoAssign: assign,
        shouldClose: close,
        responseToId: lastUserMessage?.id ?? null,
      });

      // Clear the draft immediately after message is sent successfully
      setDraftedEmail((prev) => ({ ...prev, message: "", htmlBody: undefined, files: [], modified: false }));
      setHtmlTemplate(null);
      setInitialMessageObject({ content: "" });
      resetFiles([]);
      setShowCommandBar(false);

      // Clear backend draft
      if (conversation?.slug) {
        deleteDraftMutation.mutate({ conversationSlug: conversation.slug });
      }

      try {
        if (editorRef.current?.editor && !editorRef.current.editor.isDestroyed) {
          editorRef.current.editor.commands.clearContent();
        }
      } catch (error) {
        captureExceptionAndLog(error);
      }

      // The reply mutation already closes the conversation server-side (shouldClose: close).
      // Navigate away immediately without an extra API round-trip.
      if (conversation.status === "open" && close) {
        removeConversation();
      }
      toast.success(close ? "Replied and closed" : "Message sent!", {
        duration: 10000,
        description: (
          <div className="flex gap-2 items-center mt-2">
            {close && (
              <button
                className="inline-flex items-center gap-1 px-1.5 py-1 text-xs font-medium rounded-md border hover:bg-accent transition-colors"
                onClick={(event) => {
                  if (event.ctrlKey || event.metaKey) {
                    window.open(`/conversations?id=${conversation.slug}`, "_blank");
                  } else {
                    navigateToConversation(conversation.slug);
                  }
                }}
              >
                <Eye className="h-3 w-3" />
                Visit
              </button>
            )}
            <button
              className="inline-flex items-center gap-1 px-1.5 py-1 text-xs font-medium rounded-md border hover:bg-accent transition-colors"
              onClick={() => knowledgeBankDialogState.show(emailId)}
            >
              <Lightbulb className="h-3 w-3" />
              Generate knowledge
            </button>
            <button
              className="inline-flex items-center gap-1 px-1.5 py-1 text-xs font-medium rounded-md border hover:bg-accent transition-colors"
              onClick={async () => {
                try {
                  await utils.client.mailbox.conversations.undo.mutate({
                    conversationSlug,
                    emailId,
                  });
                  setUndoneEmail(originalDraftedEmail);
                  toast.success("Message unsent");
                } catch (e) {
                  captureExceptionAndLog(e);
                  toast.error("Failed to unsend email", {
                    description: e instanceof Error ? e.message : "Unknown error",
                  });
                } finally {
                  utils.mailbox.conversations.get.invalidate({ conversationSlug });
                  navigateToConversation(conversation.slug);
                }
              }}
            >
              <Undo2 className="h-3 w-3" />
              Undo
            </button>
          </div>
        ),
      });
    } catch (error) {
      captureExceptionAndLog(error);
      toast.error("Error submitting message");
    } finally {
      setSending(false);
    }
  };

  const actionButtons = (
    <>
      <div className="flex items-center justify-between w-full gap-6">
        {(conversation?.status ?? searchParams.status) !== "spam" &&
          ((conversation?.status ?? searchParams.status) === "closed" ? (
            <Button variant="outlined" onClick={() => updateStatus("open")}>
              <CornerUpLeft className="mr-2 h-4 w-4" />
              Reopen
            </Button>
          ) : (
            <>
              {/* Left side: Primary send action with dropdown */}
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => handleSend({ assign: shouldAutoAssign })}
                  disabled={sendDisabled}
                  className="min-w-[90px] rounded-full"
                >
                  {sending ? "Sending..." : "Send"}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outlined" iconOnly disabled={sendDisabled} className="rounded-full">
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem
                      onClick={() => !sendDisabled && handleSend({ assign: shouldAutoAssign, close: true })}
                    >
                      Send and close
                      {isMacOS() && <DropdownMenuShortcut>⌘⏎</DropdownMenuShortcut>}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => !sendDisabled && handleSend({ assign: shouldAutoAssign, close: false })}
                    >
                      Send
                      {isMacOS() && <DropdownMenuShortcut>⌥⏎</DropdownMenuShortcut>}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Right side: Secondary text link actions */}
              <div className="flex items-center gap-4">
                {conversation?.status !== "closed" && (
                  <>
                    <button
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => updateStatus("closed")}
                    >
                      Close
                      {isMacOS() && isEditorFocused && <span className="ml-1.5 text-xs opacity-60">⌘⇧C</span>}
                    </button>
                    {conversation?.status === "waiting_on_customer" ? (
                      <button
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => updateStatus("open")}
                      >
                        Mark active
                      </button>
                    ) : (
                      <button
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => updateStatus("waiting_on_customer")}
                      >
                        Mark waiting
                      </button>
                    )}
                    {conversation?.status !== "check_back_later" && (
                      <button
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => updateStatus("check_back_later")}
                      >
                        Check back later
                      </button>
                    )}
                  </>
                )}
              </div>
            </>
          ))}
      </div>
    </>
  );

  const followButton = conversation?.slug ? (
    <FollowButton conversationSlug={conversation.slug} size={isAboveMd ? "default" : "sm"} />
  ) : null;

  const updateDraftedEmail = (changes: Partial<DraftedEmail>) => {
    setDraftedEmail((email) => {
      const updated = { ...email, ...changes, modified: true };
      // Trigger debounced save to backend
      if (changes.message !== undefined) {
        debouncedSaveDraft(updated.message, updated.to, updated.cc, updated.bcc);
      }
      return updated;
    });
  };

  const [htmlTemplate, setHtmlTemplate] = useState<{ name: string; content: string } | null>(null);

  const handleInsertReply = (content: string, isHtmlTemplate?: boolean, templateName?: string) => {
    console.log("[handleInsertReply]", { isHtmlTemplate, templateName, contentLength: content?.length });

    if (isHtmlTemplate && templateName) {
      // For HTML templates, store separately and show preview card
      setHtmlTemplate({ name: templateName, content });
      setDraftedEmail((email) => ({ ...email, htmlBody: content, modified: true }));
    } else {
      // For regular rich text, insert into TipTap editor
      editorRef.current?.editor?.commands.insertContent(content);
      editorRef.current?.editor?.commands.focus();
    }
  };

  const handleRemoveHtmlTemplate = () => {
    setHtmlTemplate(null);
    setDraftedEmail((email) => ({ ...email, htmlBody: undefined, modified: true }));
  };

  return (
    <div className="flex flex-col pt-2">
      <TicketCommandBar
        open={showCommandBar}
        onOpenChange={setShowCommandBar}
        onInsertReply={handleInsertReply}
        onToggleCc={onToggleCc}
        inputRef={commandInputRef}
      />
      {!showCc && !showCommandBar && (
        <div className="flex gap-3 text-sm text-muted-foreground mt-2">
          <button onClick={() => setShowCc(true)} className="hover:text-foreground transition-colors" type="button">
            Cc
          </button>
          <button onClick={() => setShowCc(true)} className="hover:text-foreground transition-colors" type="button">
            Bcc
          </button>
        </div>
      )}
      <div className={cn("shrink-0 space-y-2 mb-3", (!showCc || showCommandBar) && "hidden")}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 space-y-2">
            <LabeledInput
              ref={toRef}
              name="To"
              value={draftedEmail.to}
              onChange={(to) => updateDraftedEmail({ to })}
              onModEnter={() => {}}
            />
            <LabeledInput
              ref={ccRef}
              name="CC"
              value={draftedEmail.cc}
              onChange={(cc) => updateDraftedEmail({ cc })}
              onModEnter={() => {}}
            />
            <LabeledInput
              ref={bccRef}
              name="BCC"
              value={draftedEmail.bcc}
              onChange={(bcc) => updateDraftedEmail({ bcc })}
              onModEnter={() => {}}
            />
          </div>
          <button
            onClick={() => setShowCc(false)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors mt-1"
            type="button"
          >
            ✕
          </button>
        </div>
      </div>
      {htmlTemplate && !showCommandBar && (
        <div className="flex-1 flex flex-col min-h-0 my-2">
          <div className="flex-1 overflow-auto min-h-0">
            <HtmlTemplatePreview
              templateName={htmlTemplate.name}
              htmlContent={htmlTemplate.content}
              onRemove={handleRemoveHtmlTemplate}
              onChange={(content) => {
                setHtmlTemplate({ ...htmlTemplate, content });
                setDraftedEmail((email) => ({ ...email, htmlBody: content, modified: true }));
              }}
            />
          </div>
          <div className="shrink-0 border-t p-4">{actionButtons}</div>
        </div>
      )}
      <TipTapEditor
        ref={editorRef}
        className={cn("my-2", showCommandBar && "hidden", htmlTemplate && "hidden")}
        ariaLabel="Conversation editor"
        placeholder="Type your reply here..."
        defaultContent={initialMessageObject}
        editable={true}
        onFocusChange={setIsEditorFocused}
        onUpdate={(message, isEmpty) => {
          updateDraftedEmail({ message: isEmpty ? "" : message });
          if (!isEmpty && conversation?.slug) {
            handleTypingEvent(conversation.slug);
          }
        }}
        onModEnter={() => !sendDisabled && handleSend({ assign: shouldAutoAssign, close: true })}
        onOptionEnter={() => !sendDisabled && handleSend({ assign: shouldAutoAssign, close: false })}
        onSlashKey={() => {
          setShowCommandBar(true);
          setTimeout(() => commandInputRef.current?.focus(), 100);
        }}
        enableImageUpload
        enableFileUpload
        actionButtons={actionButtons}
        followButton={followButton}
        signature={<EmailSignature />}
        isRecordingSupported={isRecordingSupported}
        isRecording={isRecording}
        startRecording={startRecording}
        stopRecording={stopRecording}
      />
      {knowledgeBankDialogState.isVisible && (
        <GenerateKnowledgeBankDialog
          open={knowledgeBankDialogState.isVisible}
          onOpenChange={(open) => !open && knowledgeBankDialogState.hide()}
          messageId={knowledgeBankDialogState.messageId}
        />
      )}
    </div>
  );
};
