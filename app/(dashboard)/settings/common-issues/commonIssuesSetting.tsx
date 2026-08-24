"use client";

import { Edit2, PlusCircle, Sparkles, Trash, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmationDialog } from "@/components/confirmationDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useMembers } from "@/components/useMembers";
import { ISSUE_COLORS } from "@/lib/issueColors";
import { cn } from "@/lib/utils";
import { api } from "@/trpc/react";
import SectionWrapper from "../sectionWrapper";
import { ConditionsEditor } from "./conditionsEditor";
import { GenerateIssuesDialog } from "./generateIssuesDialog";

type CommonIssueEditFormProps = {
  issueGroupId?: number;
  title: string;
  description: string;
  color?: string | null;
  assignees: string[];
  customPrompt?: string | null;
  standardAnswer?: string | null;
  autoResponseEnabled?: boolean;
  defaultSavedReplyId?: number | null;
  onSubmit: () => void;
  onCancel?: () => void;
  onTitleChange?: (title: string) => void;
  onDescriptionChange?: (description: string) => void;
  onColorChange?: (color: string) => void;
  onAssigneesChange?: (assignees: string[]) => void;
  onCustomPromptChange?: (prompt: string) => void;
  onStandardAnswerChange?: (answer: string) => void;
  onAutoResponseEnabledChange?: (enabled: boolean) => void;
  onDefaultSavedReplyIdChange?: (id: number | null) => void;
  isLoading: boolean;
};

const CommonIssueEditForm = ({
  issueGroupId,
  title,
  description,
  color,
  assignees,
  customPrompt,
  standardAnswer,
  autoResponseEnabled,
  defaultSavedReplyId,
  isLoading,
  onSubmit,
  onCancel,
  onTitleChange,
  onDescriptionChange,
  onColorChange,
  onAssigneesChange,
  onCustomPromptChange,
  onStandardAnswerChange,
  onAutoResponseEnabledChange,
  onDefaultSavedReplyIdChange,
}: CommonIssueEditFormProps) => {
  const { data: members } = useMembers();
  const { data: savedRepliesData } = api.mailbox.savedReplies.list.useQuery({ onlyActive: true });
  const [showAssigneeDropdown, setShowAssigneeDropdown] = useState(false);

  const availableMembers = members?.filter((m) => !assignees.includes(m.id)) || [];
  const selectedMembers = members?.filter((m) => assignees.includes(m.id)) || [];

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="border rounded-lg p-4 space-y-4"
    >
      <div>
        <Label>Title</Label>
        <Input
          value={title}
          onChange={(e) => onTitleChange?.(e.target.value)}
          placeholder="e.g., Login"
          className="mt-2"
        />
      </div>
      <div>
        <Label>Description (optional)</Label>
        <Textarea
          value={description}
          onChange={(e) => onDescriptionChange?.(e.target.value)}
          placeholder="Brief description of this category..."
          className="mt-2"
          rows={3}
        />
      </div>

      <div className="flex items-center space-x-2 border rounded-lg p-3 bg-muted/20">
        <Switch
          id="auto-response"
          checked={autoResponseEnabled ?? false}
          onCheckedChange={(checked) => onAutoResponseEnabledChange?.(checked)}
        />
        <div className="space-y-0.5">
          <Label htmlFor="auto-response" className="text-sm font-medium">
            Enable AI Auto-Response
          </Label>
          <p className="text-xs text-muted-foreground">
            Automatically reply to conversations categorized into this category using AI.
          </p>
        </div>
      </div>

      {(autoResponseEnabled ?? false) && (
        <div className="ml-8 border-l-2 pl-4 space-y-2 animate-in fade-in slide-in-from-top-2">
          <Label className="flex justify-between">
            <span>Standard answer (Optional)</span>
          </Label>
          <Textarea
            value={standardAnswer || ""}
            onChange={(e) => onStandardAnswerChange?.(e.target.value)}
            placeholder="e.g. Lead time is about 3 months from order. Not onboarding new franchises until Q1."
            className="mt-2 text-sm"
            rows={4}
          />
          <p className="text-xs text-muted-foreground">
            Your current position for this category. When filled in, replies are written from this text only — the AI
            rephrases it to fit each email and will not state anything you haven&apos;t said here. Leave empty to let
            the AI answer from the knowledge base.
          </p>

          <Label className="mt-4 flex justify-between">
            <span>Custom AI Prompt (Optional)</span>
          </Label>
          <Textarea
            value={customPrompt || ""}
            onChange={(e) => onCustomPromptChange?.(e.target.value)}
            placeholder="e.g. Always apologize first, then ask for their order number. Keep response under 50 words."
            className="mt-2 font-mono text-sm"
            rows={4}
          />
          <p className="text-xs text-muted-foreground">
            Provide specific instructions for how the AI should handle conversations in this category.
          </p>

          <Label className="mt-4">Default Template (Optional)</Label>
          <Select
            value={defaultSavedReplyId?.toString() || "none"}
            onValueChange={(value) => onDefaultSavedReplyIdChange?.(value === "none" ? null : parseInt(value))}
          >
            <SelectTrigger className="mt-2">
              <SelectValue placeholder="Select a template" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No template</SelectItem>
              {savedRepliesData?.map((reply) => (
                <SelectItem key={reply.id} value={reply.id.toString()}>
                  {reply.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">
            AI will use this template and fill in variables automatically.
          </p>
        </div>
      )}

      <div>
        <Label>Color</Label>
        <div className="flex flex-wrap gap-2 mt-2">
          {ISSUE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={cn(
                "size-8 rounded-full border-2 transition-all",
                color === c ? "border-foreground scale-110" : "border-transparent hover:scale-105",
              )}
              style={{ backgroundColor: c }}
              onClick={() => onColorChange?.(c)}
            />
          ))}
        </div>
      </div>
      <div>
        <Label>Auto-assign to (optional)</Label>
        <div className="mt-2 space-y-2">
          {selectedMembers.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selectedMembers.map((member) => (
                <div
                  key={member.id}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-secondary text-secondary-foreground rounded-md text-sm"
                >
                  <span>{member.displayName}</span>
                  <button
                    type="button"
                    onClick={() => onAssigneesChange?.(assignees.filter((id) => id !== member.id))}
                    className="hover:bg-secondary-foreground/20 rounded-sm p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {availableMembers.length > 0 && (
            <div className="relative">
              <Button
                type="button"
                variant="outlined"
                size="sm"
                onClick={() => setShowAssigneeDropdown(!showAssigneeDropdown)}
              >
                <PlusCircle className="h-4 w-4 mr-2" />
                Add team member
              </Button>
              {showAssigneeDropdown && (
                <div className="absolute z-10 mt-1 w-64 bg-popover border rounded-md shadow-lg max-h-60 overflow-auto">
                  {availableMembers.map((member) => (
                    <button
                      key={member.id}
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm hover:bg-accent transition-colors"
                      onClick={() => {
                        onAssigneesChange?.([...assignees, member.id]);
                        setShowAssigneeDropdown(false);
                      }}
                    >
                      {member.displayName}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Conversations assigned to this category will be automatically assigned to these team members in rotation.
          </p>
        </div>
      </div>

      {/* Conditions Editor - only shown when editing existing issue */}
      {issueGroupId && <SubcategoryStatsPanel issueGroupId={issueGroupId} />}
      {issueGroupId && <ConditionsEditor issueGroupId={issueGroupId} />}

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="subtle" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={isLoading || !title.trim()}>
          {isLoading ? "Saving..." : "Save"}
        </Button>
      </div>
    </form>
  );
};

const SubcategoryStatsPanel = ({ issueGroupId }: { issueGroupId: number }) => {
  const { data, isLoading } = api.mailbox.issueGroups.subgroupStats.useQuery({
    issueGroupId,
    days: 30,
    topN: 6,
  });

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div>
        <div className="text-sm font-medium">Subcategory stats (last 30 days)</div>
        <div className="text-xs text-muted-foreground">Auto-generated internal breakdown for this category</div>
      </div>
      {isLoading ? (
        <div className="text-xs text-muted-foreground">Loading subcategory stats...</div>
      ) : !data?.topSubgroups.length ? (
        <div className="text-xs text-muted-foreground">No subcategories yet.</div>
      ) : (
        <div className="space-y-1.5">
          {data.topSubgroups.map((subgroup) => (
            <div key={subgroup.id} className="flex items-center justify-between text-xs">
              <span className="truncate pr-2">{subgroup.title}</span>
              <span className="text-muted-foreground shrink-0">
                {subgroup.periodCount} in 30d ({Math.round(subgroup.sharePercent)}% total)
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const CommonIssuesSetting = () => {
  const [newIssueTitle, setNewIssueTitle] = useState("");
  const [newIssueDescription, setNewIssueDescription] = useState("");
  const [newIssueColor, setNewIssueColor] = useState<string | null>(null);
  const [newIssueAssignees, setNewIssueAssignees] = useState<string[]>([]);
  const [newIssueCustomPrompt, setNewIssueCustomPrompt] = useState<string | null>(null);
  const [newIssueStandardAnswer, setNewIssueStandardAnswer] = useState<string | null>(null);
  const [newIssueAutoResponseEnabled, setNewIssueAutoResponseEnabled] = useState(false);
  const [newIssueDefaultSavedReplyId, setNewIssueDefaultSavedReplyId] = useState<number | null>(null);
  const [showNewIssueForm, setShowNewIssueForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingIssue, setEditingIssue] = useState<{
    id: number;
    title: string;
    description: string;
    color: string | null;
    assignees: string[];
    customPrompt: string | null;
    standardAnswer: string | null;
    autoResponseEnabled: boolean;
    defaultSavedReplyId: number | null;
  } | null>(null);

  const utils = api.useUtils();

  const { data, isLoading } = api.mailbox.issueGroups.listAll.useQuery();
  const issueGroups = data?.groups ?? [];

  const filteredIssueGroups = issueGroups.filter(
    (group) =>
      group.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      group.description?.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const createMutation = api.mailbox.issueGroups.create.useMutation({
    onSuccess: () => {
      utils.mailbox.issueGroups.listAll.invalidate();
      setShowNewIssueForm(false);
      setNewIssueTitle("");
      setNewIssueDescription("");
      setNewIssueColor(null);
      setNewIssueColor(null);
      setNewIssueAssignees([]);
      setNewIssueCustomPrompt(null);
      setNewIssueAutoResponseEnabled(false);
      setNewIssueDefaultSavedReplyId(null);
      toast.success("Category created");
    },
    onError: (error) => {
      toast.error("Error creating category", { description: error.message });
    },
  });

  const updateAssigneesMutation = api.mailbox.issueGroups.updateAssignees.useMutation({
    onSuccess: () => {
      utils.mailbox.issueGroups.listAll.invalidate();
      toast.success("Assignees updated");
    },
    onError: (error) => {
      toast.error("Error updating assignees", { description: error.message });
    },
  });

  const deleteMutation = api.mailbox.issueGroups.delete.useMutation({
    onSuccess: (data) => {
      toast.success(
        `Category deleted${data.unassignedConversations ? ` (${data.unassignedConversations} conversations unassigned)` : ""}`,
      );
      utils.mailbox.issueGroups.listAll.invalidate();
    },
    onError: (error) => {
      toast.error("Error deleting category", { description: error.message });
    },
  });

  const updateMutation = api.mailbox.issueGroups.update.useMutation({
    onSuccess: () => {
      utils.mailbox.issueGroups.listAll.invalidate();
      setEditingIssue(null);
      toast.success("Category updated");
    },
    onError: (error) => {
      toast.error("Error updating category", { description: error.message });
    },
  });

  const [showGenerateDialog, setShowGenerateDialog] = useState(false);

  const bulkCreateMutation = api.mailbox.issueGroups.bulkCreate.useMutation({
    onSuccess: (data) => {
      utils.mailbox.issueGroups.listAll.invalidate();
      toast.success(`Created ${data.createdIssues} categories from your conversations`);
      setShowGenerateDialog(false);
    },
    onError: (error) => {
      toast.error("Error creating categories", { description: error.message });
    },
  });

  const handleGenerateIssues = () => {
    setShowGenerateDialog(true);
  };

  const handleApproveSuggestions = async (approvedSuggestions: { title: string; description?: string }[]) => {
    await bulkCreateMutation.mutateAsync({ items: approvedSuggestions });
  };

  const handleCreateIssue = async () => {
    if (!newIssueTitle.trim()) return;
    const newGroup = await createMutation.mutateAsync({
      title: newIssueTitle.trim(),
      description: newIssueDescription.trim() || undefined,
      customPrompt: newIssueCustomPrompt,
      standardAnswer: newIssueStandardAnswer,
      autoResponseEnabled: newIssueAutoResponseEnabled,
      defaultSavedReplyId: newIssueDefaultSavedReplyId,
    });
    if (newIssueAssignees.length > 0) {
      await updateAssigneesMutation.mutateAsync({
        id: newGroup.id,
        assignees: newIssueAssignees,
      });
    }
  };

  const handleDeleteIssue = async (id: number) => {
    await deleteMutation.mutateAsync({
      id,
    });
  };

  const handleUpdateIssue = async () => {
    if (!editingIssue?.title.trim()) return;
    await updateMutation.mutateAsync({
      id: editingIssue.id,
      title: editingIssue.title.trim(),
      description: editingIssue.description.trim() || undefined,
      color: editingIssue.color || undefined,
      customPrompt: editingIssue.customPrompt || null,
      standardAnswer: editingIssue.standardAnswer || null,
      autoResponseEnabled: editingIssue.autoResponseEnabled,
      defaultSavedReplyId: editingIssue.defaultSavedReplyId,
    });
    await updateAssigneesMutation.mutateAsync({
      id: editingIssue.id,
      assignees: editingIssue.assignees,
    });
  };

  return (
    <SectionWrapper
      title="Categories"
      description="Create categories to organize and track recurring customer problems. These will help you quickly categorize and resolve similar conversations."
    >
      <Input
        type="text"
        placeholder="Search categories..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="mb-4"
      />

      <div className="mb-4 divide-y divide-border">
        {isLoading ? (
          <>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-4">
                <div className="grow space-y-2">
                  <div className="h-4 w-32 rounded bg-secondary animate-skeleton" />
                  <div className="h-3 w-48 rounded bg-secondary animate-skeleton" />
                </div>
                <div className="h-6 w-16 rounded bg-secondary animate-skeleton" />
              </div>
            ))}
          </>
        ) : filteredIssueGroups.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground space-y-4">
            <div>{searchQuery ? "No categories found matching your search." : "No categories created yet."}</div>
            {!searchQuery && (
              <Button variant="outlined" onClick={handleGenerateIssues} className="mx-auto">
                <Sparkles className="mr-2 h-4 w-4" />
                Generate categories
              </Button>
            )}
          </div>
        ) : (
          <>
            {filteredIssueGroups.map((group) => (
              <div key={group.id} className="py-4" data-testid="common-issue-item">
                {editingIssue?.id === group.id ? (
                  <CommonIssueEditForm
                    issueGroupId={editingIssue.id}
                    title={editingIssue.title}
                    description={editingIssue.description}
                    color={editingIssue.color}
                    assignees={editingIssue.assignees}
                    customPrompt={editingIssue.customPrompt}
                    standardAnswer={editingIssue.standardAnswer}
                    autoResponseEnabled={editingIssue.autoResponseEnabled}
                    defaultSavedReplyId={editingIssue.defaultSavedReplyId}
                    onTitleChange={(title) => setEditingIssue({ ...editingIssue, title })}
                    onDescriptionChange={(description) => setEditingIssue({ ...editingIssue, description })}
                    onColorChange={(color) => setEditingIssue({ ...editingIssue, color })}
                    onAssigneesChange={(assignees) => setEditingIssue({ ...editingIssue, assignees })}
                    onCustomPromptChange={(customPrompt) => setEditingIssue({ ...editingIssue, customPrompt })}
                    onStandardAnswerChange={(standardAnswer) => setEditingIssue({ ...editingIssue, standardAnswer })}
                    onAutoResponseEnabledChange={(autoResponseEnabled) =>
                      setEditingIssue({ ...editingIssue, autoResponseEnabled })
                    }
                    onDefaultSavedReplyIdChange={(defaultSavedReplyId) =>
                      setEditingIssue({ ...editingIssue, defaultSavedReplyId })
                    }
                    onSubmit={handleUpdateIssue}
                    onCancel={() => setEditingIssue(null)}
                    isLoading={updateMutation.isPending || updateAssigneesMutation.isPending}
                  />
                ) : (
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div
                          className="size-2 rounded-full shrink-0"
                          style={{ backgroundColor: group.color || "gray" }}
                        />
                        <div className="font-medium text-sm">{group.title}</div>
                      </div>
                      {group.description && (
                        <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{group.description}</div>
                      )}
                      <div className="text-xs text-muted-foreground mt-2">
                        {group.conversationCount} conversation{group.conversationCount !== 1 ? "s" : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        iconOnly
                        onClick={() =>
                          setEditingIssue({
                            id: group.id,
                            title: group.title,
                            description: group.description || "",
                            color: group.color || null,
                            assignees: group.assignees!,
                            customPrompt: group.customPrompt || null,
                            standardAnswer: group.standardAnswer || null,
                            autoResponseEnabled: group.autoResponseEnabled === 1,
                            defaultSavedReplyId: group.defaultSavedReplyId || null,
                          })
                        }
                      >
                        <Edit2 className="h-4 w-4" />
                        <span className="sr-only">Edit</span>
                      </Button>
                      <ConfirmationDialog
                        message="Are you sure you want to delete this category? All conversations will be unassigned from this category."
                        onConfirm={() => handleDeleteIssue(group.id)}
                        confirmLabel="Yes, delete"
                      >
                        <Button variant="ghost" size="sm" iconOnly>
                          <Trash className="h-4 w-4" />
                          <span className="sr-only">Delete</span>
                        </Button>
                      </ConfirmationDialog>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>

      {showNewIssueForm ? (
        <div className="mb-4">
          <CommonIssueEditForm
            title={newIssueTitle}
            description={newIssueDescription}
            color={newIssueColor}
            assignees={newIssueAssignees}
            customPrompt={newIssueCustomPrompt}
            standardAnswer={newIssueStandardAnswer}
            autoResponseEnabled={newIssueAutoResponseEnabled}
            defaultSavedReplyId={newIssueDefaultSavedReplyId}
            onTitleChange={setNewIssueTitle}
            onDescriptionChange={setNewIssueDescription}
            onColorChange={setNewIssueColor}
            onAssigneesChange={setNewIssueAssignees}
            onCustomPromptChange={setNewIssueCustomPrompt}
            onStandardAnswerChange={setNewIssueStandardAnswer}
            onAutoResponseEnabledChange={setNewIssueAutoResponseEnabled}
            onDefaultSavedReplyIdChange={setNewIssueDefaultSavedReplyId}
            onSubmit={handleCreateIssue}
            onCancel={() => {
              setShowNewIssueForm(false);
              setNewIssueTitle("");
              setNewIssueDescription("");
              setNewIssueColor(null);
              setNewIssueAssignees([]);
              setNewIssueCustomPrompt(null);
              setNewIssueAutoResponseEnabled(false);
              setNewIssueDefaultSavedReplyId(null);
            }}
            isLoading={createMutation.isPending || updateAssigneesMutation.isPending}
          />
        </div>
      ) : (
        <Button
          variant="subtle"
          onClick={(e) => {
            e.preventDefault();
            setNewIssueTitle("");
            setNewIssueDescription("");
            setNewIssueColor(null);
            setNewIssueColor(null);
            setNewIssueAssignees([]);
            setNewIssueCustomPrompt(null);
            setNewIssueAutoResponseEnabled(false);
            setShowNewIssueForm(true);
          }}
        >
          <PlusCircle className="mr-2 h-4 w-4" />
          Add Category
        </Button>
      )}

      <GenerateIssuesDialog
        isOpen={showGenerateDialog}
        onClose={() => setShowGenerateDialog(false)}
        onApprove={handleApproveSuggestions}
        isCreating={bulkCreateMutation.isPending}
      />
    </SectionWrapper>
  );
};

export default CommonIssuesSetting;
