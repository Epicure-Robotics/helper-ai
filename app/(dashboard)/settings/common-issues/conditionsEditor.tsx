"use client";

import { Loader2, Play, PlusCircle, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/trpc/react";

type Condition = {
  id: number;
  condition: string;
  savedReplyId: number;
  savedReplyName: string | null;
  isActive: boolean;
};

type ConditionsEditorProps = {
  issueGroupId: number;
};

export const ConditionsEditor = ({ issueGroupId }: ConditionsEditorProps) => {
  const [newCondition, setNewCondition] = useState("");
  const [selectedSavedReplyId, setSelectedSavedReplyId] = useState<number | null>(null);
  const [testEmail, setTestEmail] = useState("");
  const [testCondition, setTestCondition] = useState("");
  const [showTestPanel, setShowTestPanel] = useState(false);

  const utils = api.useUtils();

  // Fetch conditions for this category (issue group)
  const { data: conditionsData, isLoading: conditionsLoading } = api.mailbox.issueGroups.listConditions.useQuery({
    issueGroupId,
  });

  // Fetch saved replies for dropdown
  const { data: savedRepliesData } = api.mailbox.savedReplies.list.useQuery({
    onlyActive: true,
  });

  const savedReplies = savedRepliesData ?? [];
  const conditions = conditionsData?.conditions ?? [];

  // Mutations
  const addConditionMutation = api.mailbox.issueGroups.addCondition.useMutation({
    onSuccess: () => {
      utils.mailbox.issueGroups.listConditions.invalidate({ issueGroupId });
      setNewCondition("");
      setSelectedSavedReplyId(null);
      toast.success("Condition added");
    },
    onError: (error) => {
      toast.error("Failed to add condition", { description: error.message });
    },
  });

  const deleteConditionMutation = api.mailbox.issueGroups.deleteCondition.useMutation({
    onSuccess: () => {
      utils.mailbox.issueGroups.listConditions.invalidate({ issueGroupId });
      toast.success("Condition deleted");
    },
    onError: (error) => {
      toast.error("Failed to delete condition", { description: error.message });
    },
  });

  const updateConditionMutation = api.mailbox.issueGroups.updateCondition.useMutation({
    onSuccess: () => {
      utils.mailbox.issueGroups.listConditions.invalidate({ issueGroupId });
      toast.success("Condition updated");
    },
    onError: (error) => {
      toast.error("Failed to update condition", { description: error.message });
    },
  });

  const testConditionMutation = api.mailbox.issueGroups.testCondition.useMutation({
    onSuccess: (result) => {
      if (result.conditionMet) {
        toast.success("Condition MET ✓", { description: result.reasoning });
      } else {
        toast.info("Condition NOT met", { description: result.reasoning });
      }
    },
    onError: (error) => {
      toast.error("Test failed", { description: error.message });
    },
  });

  const handleAddCondition = () => {
    if (!newCondition.trim() || !selectedSavedReplyId) {
      toast.error("Please enter a condition and select a saved reply");
      return;
    }

    addConditionMutation.mutate({
      issueGroupId,
      condition: newCondition.trim(),
      savedReplyId: selectedSavedReplyId,
    });
  };

  const handleTestCondition = () => {
    if (!testCondition.trim() || !testEmail.trim()) {
      toast.error("Please enter both an email and condition to test");
      return;
    }

    testConditionMutation.mutate({
      condition: testCondition.trim(),
      testEmail: testEmail.trim(),
    });
  };

  if (conditionsLoading) {
    return (
      <div className="py-4 text-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mx-auto" />
      </div>
    );
  }

  return (
    <div className="space-y-4 border-t pt-4 mt-4">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Conditions (Auto-reply templates)</Label>
        <Button type="button" variant="ghost" size="sm" onClick={() => setShowTestPanel(!showTestPanel)}>
          <Play className="h-3 w-3 mr-1" />
          Test
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        When a condition is met for a new conversation, the selected saved reply will be sent automatically.
      </p>

      {/* Test Panel */}
      {showTestPanel && (
        <div className="bg-muted/50 rounded-lg p-3 space-y-3">
          <Label className="text-xs font-medium">Test Condition</Label>
          <Input
            type="email"
            placeholder="Customer email to test..."
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            className="text-sm"
          />
          <Textarea
            placeholder="Condition to test (e.g. 'Customer is a VIP')"
            value={testCondition}
            onChange={(e) => setTestCondition(e.target.value)}
            rows={2}
            className="text-sm"
          />
          <Button type="button" size="sm" onClick={handleTestCondition} disabled={testConditionMutation.isPending}>
            {testConditionMutation.isPending ? (
              <>
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                Testing...
              </>
            ) : (
              <>
                <Play className="h-3 w-3 mr-1" />
                Run Test
              </>
            )}
          </Button>
        </div>
      )}

      {/* Existing Conditions */}
      {conditions.length > 0 && (
        <div className="space-y-2">
          {conditions.map((condition: Condition) => (
            <div key={condition.id} className="flex items-start gap-2 p-2 bg-secondary/50 rounded-lg text-sm">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-xs text-muted-foreground">When: {condition.condition}</div>
                <div className="text-xs">
                  Send: <span className="font-medium">{condition.savedReplyName || "Unknown"}</span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  iconOnly
                  onClick={() => {
                    updateConditionMutation.mutate({
                      id: condition.id,
                      isActive: !condition.isActive,
                    });
                  }}
                  className={condition.isActive ? "text-green-600" : "text-muted-foreground"}
                >
                  <span className="text-xs">{condition.isActive ? "ON" : "OFF"}</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  iconOnly
                  onClick={() => deleteConditionMutation.mutate({ id: condition.id })}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add New Condition */}
      <div className="space-y-2 p-3 border rounded-lg">
        <Textarea
          placeholder="Condition (e.g., 'User is on the Pro plan')"
          value={newCondition}
          onChange={(e) => setNewCondition(e.target.value)}
          rows={2}
          className="text-sm"
        />

        <select
          value={selectedSavedReplyId || ""}
          onChange={(e) => setSelectedSavedReplyId(e.target.value ? Number(e.target.value) : null)}
          className="w-full px-3 py-2 text-sm border rounded-md bg-background"
        >
          <option value="">Select saved reply to send...</option>
          {savedReplies.map((reply) => (
            <option key={reply.id} value={reply.id}>
              {reply.name}
            </option>
          ))}
        </select>

        <Button
          type="button"
          variant="outlined"
          size="sm"
          onClick={handleAddCondition}
          disabled={addConditionMutation.isPending || !newCondition.trim() || !selectedSavedReplyId}
        >
          {addConditionMutation.isPending ? (
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          ) : (
            <PlusCircle className="h-3 w-3 mr-1" />
          )}
          Add Condition
        </Button>
      </div>
    </div>
  );
};
