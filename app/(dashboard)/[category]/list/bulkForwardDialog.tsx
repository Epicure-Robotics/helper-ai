import { Forward } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import { parseEmailList } from "@/components/utils/email";
import { api } from "@/trpc/react";

export const BulkForwardDialog = ({
  conversationSlugs,
  children,
  onSuccess,
}: {
  conversationSlugs: string[];
  children?: React.ReactNode;
  onSuccess?: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const [recipients, setRecipients] = useState("");
  const [note, setNote] = useState("");
  const [includeFullThread, setIncludeFullThread] = useState(true);
  const [isSending, setIsSending] = useState(false);

  const forwardMutation = api.mailbox.conversations.bulkForward.useMutation({
    onSuccess: ({ count }) => {
      toast.success(`Forwarding ${count} conversation${count === 1 ? "" : "s"}`, {
        description: "This may take a few moments. You'll receive a notification when complete.",
      });
      setOpen(false);
      setRecipients("");
      setNote("");
      setIncludeFullThread(true);
      onSuccess?.();
    },
    onError: (error) => {
      toast.error("Failed to forward conversations", { description: error.message });
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

    // Confirm bulk action
    const count = conversationSlugs.length;
    const confirmed = window.confirm(
      `Are you sure you want to forward ${count} conversation${count === 1 ? "" : "s"} to ${emailList.data.join(", ")}?`,
    );

    if (!confirmed) return;

    setIsSending(true);
    try {
      await forwardMutation.mutateAsync({
        conversationSlugs,
        to: emailList.data,
        note: note.trim() || undefined,
        includeFullThread,
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children || (
          <Button variant="link" className="h-auto p-0">
            <Forward className="h-3 w-3 mr-1" />
            Forward
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            Forward {conversationSlugs.length} Conversation{conversationSlugs.length === 1 ? "" : "s"}
          </DialogTitle>
          <DialogDescription>
            Send {conversationSlugs.length === 1 ? "this conversation" : "these conversations"} to external email
            addresses.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="bulkIncludeFullThread"
              checked={includeFullThread}
              onCheckedChange={(checked) => setIncludeFullThread(checked === true)}
            />
            <label htmlFor="bulkIncludeFullThread" className="text-sm font-medium cursor-pointer">
              Forward entire conversation threads (all messages)
            </label>
          </div>

          <div className="space-y-2">
            <label htmlFor="bulkRecipients" className="text-sm font-medium">
              To
            </label>
            <Textarea
              id="bulkRecipients"
              placeholder="email@example.com, another@example.com"
              value={recipients}
              onChange={(e) => setRecipients(e.target.value)}
              className="min-h-[60px]"
            />
            <p className="text-xs text-muted-foreground">Enter one or more email addresses separated by commas</p>
          </div>

          <div className="space-y-2">
            <label htmlFor="bulkNote" className="text-sm font-medium">
              Note (optional)
            </label>
            <Textarea
              id="bulkNote"
              placeholder="Add a note to include with the forwarded conversations..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="min-h-[80px]"
            />
          </div>

          <div className="rounded-lg border bg-muted/50 p-3">
            <p className="text-xs text-muted-foreground">
              {conversationSlugs.length} conversation{conversationSlugs.length === 1 ? "" : "s"} will be forwarded via
              Gmail.
              {includeFullThread
                ? " Full threads will be included."
                : " Only the first message from each conversation will be forwarded."}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={isSending}>
            Cancel
          </Button>
          <Button onClick={handleForward} disabled={isSending || !recipients.trim()}>
            {isSending ? "Forwarding..." : `Forward ${conversationSlugs.length}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
