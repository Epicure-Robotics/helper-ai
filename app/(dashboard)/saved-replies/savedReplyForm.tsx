import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { isEmptyContent } from "@/app/(dashboard)/[category]/conversation/messageActions";
import { ConfirmationDialog } from "@/components/confirmationDialog";
import { useSpeechRecognition } from "@/components/hooks/useSpeechRecognition";
import TipTapEditor, { type TipTapEditorRef } from "@/components/tiptap/editor";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { HtmlTemplateEditor } from "@/components/ui/htmlTemplateEditor";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/trpc/react";

type SavedReply = {
  slug: string;
  name: string;
  content: string;
  templateType?: "rich_text" | "html_template";
};

interface SavedReplyFormProps {
  savedReply?: SavedReply;
  onSuccess: () => void;
  onCancel: () => void;
  onDelete?: () => void;
}

export function SavedReplyForm({ savedReply, onSuccess, onCancel, onDelete }: SavedReplyFormProps) {
  const editorRef = useRef<TipTapEditorRef | null>(null);
  const [initialContentObject, setInitialContentObject] = useState({ content: savedReply?.content || "" });

  const form = useForm({
    resolver: zodResolver(
      z.object({
        name: z.string().min(1, "Title is required").max(100, "Title must be less than 100 characters"),
        content: z.string().min(1, "Content is required"),
        templateType: z.enum(["rich_text", "html_template"]),
      }),
    ),
    defaultValues: {
      name: savedReply?.name || "",
      content: savedReply?.content || "",
      templateType: savedReply?.templateType || "rich_text",
    },
  });

  const handleSegment = useCallback((segment: string) => {
    if (editorRef.current?.editor) {
      editorRef.current.editor.commands.insertContent(segment);
    }
  }, []);

  const handleError = useCallback((error: string) => {
    toast.error("Speech Recognition Error", { description: error });
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

  const createSavedReply = api.mailbox.savedReplies.create.useMutation({
    onSuccess: () => {
      onSuccess();
      form.reset();
      setInitialContentObject({ content: "" });
    },
    onError: (error) => {
      toast.error("Failed to create saved reply", { description: error.message });
    },
  });

  const updateSavedReply = api.mailbox.savedReplies.update.useMutation({
    onSuccess: () => {
      onSuccess();
    },
    onError: (error) => {
      toast.error("Failed to update saved reply", { description: error.message });
    },
  });

  const deleteSavedReply = api.mailbox.savedReplies.delete.useMutation({
    onSuccess: () => {
      toast.success("Saved reply deleted successfully");
      onDelete?.();
    },
    onError: (error) => {
      toast.error("Failed to delete saved reply", { description: error.message });
    },
  });

  const onSubmit = (data: { name: string; content: string; templateType: "rich_text" | "html_template" }) => {
    const finalData = {
      ...data,
    };

    if (savedReply) {
      updateSavedReply.mutate({ slug: savedReply.slug, ...finalData });
    } else {
      createSavedReply.mutate(finalData);
    }
  };

  const handleDelete = () => {
    if (savedReply) {
      deleteSavedReply.mutate({ slug: savedReply.slug });
    }
  };

  const handleEditorUpdate = (content: string, isEmpty: boolean) => {
    const isContentEmpty = isEmpty || isEmptyContent(content);
    form.setValue("content", isContentEmpty ? "" : content, { shouldValidate: true });
  };

  const templateType = form.watch("templateType");

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 overflow-x-auto">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Title</FormLabel>
              <FormControl>
                <Input placeholder="e.g., Welcome Message" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="templateType"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Template Type</FormLabel>
              <FormControl>
                <Tabs value={field.value} onValueChange={field.onChange}>
                  <TabsList className="grid w-full max-w-md grid-cols-2">
                    <TabsTrigger value="rich_text">Rich Text</TabsTrigger>
                    <TabsTrigger value="html_template">HTML Template</TabsTrigger>
                  </TabsList>
                </Tabs>
              </FormControl>
              <p className="text-sm text-muted-foreground">
                {field.value === "rich_text"
                  ? "Use the rich text editor for formatted text with basic styling."
                  : "Use HTML templates for full email layouts with variables like {name}."}
              </p>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="content"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Content</FormLabel>
              <FormControl>
                {templateType === "html_template" ? (
                  <HtmlTemplateEditor
                    value={field.value || ""}
                    onChange={field.onChange}
                    placeholder="Enter HTML template with variables like {name}, {email}, etc..."
                  />
                ) : (
                  <TipTapEditor
                    ref={editorRef}
                    className="min-h-48 max-h-96"
                    ariaLabel="Saved reply content editor"
                    placeholder="Enter your saved reply content here..."
                    defaultContent={initialContentObject}
                    editable={true}
                    onUpdate={handleEditorUpdate}
                    enableImageUpload={false}
                    enableFileUpload={false}
                    isRecordingSupported={isRecordingSupported}
                    isRecording={isRecording}
                    startRecording={startRecording}
                    stopRecording={stopRecording}
                  />
                )}
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex items-center">
          {savedReply && onDelete ? (
            <ConfirmationDialog
              message={`Are you sure you want to delete ${savedReply.name}? This action cannot be undone.`}
              onConfirm={handleDelete}
            >
              <Button type="button" variant="destructive_outlined" disabled={deleteSavedReply.isPending}>
                Delete
              </Button>
            </ConfirmationDialog>
          ) : null}

          <div className="ml-auto flex items-center space-x-2">
            <Button type="button" variant="outlined" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={createSavedReply.isPending || updateSavedReply.isPending}>
              {createSavedReply.isPending || updateSavedReply.isPending ? "Saving..." : savedReply ? "Update" : "Add"}
            </Button>
          </div>
        </div>
      </form>
    </Form>
  );
}
