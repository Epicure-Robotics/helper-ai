import { Forward } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { Conversation, Message } from "@/app/types/global";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { parseEmailList } from "@/components/utils/email";
import { api } from "@/trpc/react";

export const ForwardMessageDialog = ({
  conversation,
  message,
  children,
}: {
  conversation: Conversation;
  message: Message;
  children?: React.ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  const [recipients, setRecipients] = useState("");
  const [note, setNote] = useState("");
  const [includeFullThread, setIncludeFullThread] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const forwardMutation = api.mailbox.conversations.messages.forward.useMutation({
    onSuccess: () => {
      toast.success("Message forwarded successfully");
      setOpen(false);
      setRecipients("");
      setNote("");
    },
    onError: (error) => {
      toast.error("Failed to forward message", { description: error.message });
    },
  });

  const handleForward = async () => {
    // Parse and validate email addresses
    const emailList = parseEmailList(recipients);
    if (!emailList.success) {
      toast.error("Invalid email address", {
        description: emailList.error.issues.map((issue) => issue.message).join(", "),
      });
      return;
    }

    if (emailList.data.length === 0) {
      toast.error("Please enter at least one email address");
      return;
    }

    setIsSending(true);
    try {
      await forwardMutation.mutateAsync({
        conversationSlug: conversation.slug,
        messageId: includeFullThread ? undefined : message.id,
        includeFullThread,
        to: emailList.data,
        note: note.trim() || undefined,
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>
              {children || (
                <button className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                  <Forward className="h-4 w-4" />
                  <span className="text-xs">Forward</span>
                </button>
              )}
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p>Forward this message via email</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Forward {includeFullThread ? "Conversation" : "Message"}</DialogTitle>
          <DialogDescription>
            Send {includeFullThread ? "the entire conversation thread" : "this message"} to external email addresses.
            Multiple addresses can be separated by commas.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="includeFullThread"
              checked={includeFullThread}
              onCheckedChange={(checked) => setIncludeFullThread(checked === true)}
            />
            <label htmlFor="includeFullThread" className="text-sm font-medium cursor-pointer">
              Forward entire conversation thread (
              {conversation.messages?.filter((m) => m.type === "message" && ["user", "staff"].includes(m.role))
                .length || 0}{" "}
              messages)
            </label>
          </div>

          <div className="space-y-2">
            <label htmlFor="recipients" className="text-sm font-medium">
              To
            </label>
            <Textarea
              id="recipients"
              placeholder="email@example.com, another@example.com"
              value={recipients}
              onChange={(e) => setRecipients(e.target.value)}
              className="min-h-[60px]"
            />
            <p className="text-xs text-muted-foreground">Enter one or more email addresses separated by commas</p>
          </div>

          <div className="space-y-2">
            <label htmlFor="note" className="text-sm font-medium">
              Note (optional)
            </label>
            <Textarea
              id="note"
              placeholder="Add a note to include with the forwarded message..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="min-h-[80px]"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={isSending}>
            Cancel
          </Button>
          <Button onClick={handleForward} disabled={isSending || !recipients.trim()}>
            {isSending ? "Forwarding..." : "Forward Message"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
