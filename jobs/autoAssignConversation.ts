import { and, eq, isNotNull, isNull, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { conversations } from "@/db/schema/conversations";
import { issueGroups } from "@/db/schema/issueGroups";
import { cacheFor } from "@/lib/cache";
import { Conversation, updateConversation } from "@/lib/data/conversation";
import {
  getUsersWithMailboxAccess,
  memberMatchesInboundTarget,
  UserPresence,
  type UserWithMailboxAccessData,
} from "@/lib/data/user";
import { routingTargetFromTriage, type InboundTriage } from "@/lib/leads/inboundTriage";
import { captureExceptionAndLog } from "@/lib/shared/sentry";
import { triggerEvent } from "./trigger";
import { assertDefinedOrRaiseNonRetriableError } from "./utils";

const CACHE_ROUND_ROBIN_KEY_PREFIX = "auto-assign-message-queue";
const CACHE_ROUTING_ROUND_ROBIN_PREFIX = "auto-assign-routing-v1";

const pickMemberByInboundTriage = async (
  conversation: { inboundTriage?: InboundTriage | null },
  assignableMembers: UserWithMailboxAccessData[],
): Promise<{ member: UserWithMailboxAccessData | null; source: string }> => {
  const triage = conversation.inboundTriage;
  if (!triage) {
    return { member: null, source: "no_inbound_triage" };
  }

  const target = routingTargetFromTriage(triage);
  const candidates = assignableMembers.filter((m) => memberMatchesInboundTarget(m, target));

  if (candidates.length === 0) {
    /**
     * Nobody holds this routing role, so the lead is about to fall through to round-robin and be
     * assigned like ordinary mail. That is worth knowing about for a high-priority lead — it means
     * the priority map is configured but not staffed (Settings → Team).
     */
    const message = `No team member holds routing role "${target}" — falling back to round-robin. Assign it in Settings → Team.`;
    if (triage.importance === "high") {
      captureExceptionAndLog(new Error(`[Auto-Assign] ${message}`), {
        extra: { target, importance: triage.importance, leadCategoryKey: triage.leadCategoryKey ?? null },
      });
    } else {
      console.warn(`[Auto-Assign] ${message}`);
    }
    return { member: null, source: `no_routing_${target}` };
  }

  if (candidates.length === 1) {
    return { member: candidates[0]!, source: `inbound_triage_${target}` };
  }

  const cache = cacheFor<number>(`${CACHE_ROUTING_ROUND_ROBIN_PREFIX}:${target}`);
  const last = (await cache.get()) ?? 0;
  const next = (last + 1) % candidates.length;
  await cache.set(next);
  return { member: candidates[next]!, source: `inbound_triage_${target}` };
};

const getAssignableMembers = (teamMembers: UserWithMailboxAccessData[]): UserWithMailboxAccessData[] => {
  return teamMembers.filter((member) => member.role === UserPresence.ACTIVE);
};

/** Prefer members with at least one category (or admins); if none, rotate all active. */
const roundRobinPool = (assignableMembers: UserWithMailboxAccessData[]): UserWithMailboxAccessData[] => {
  const prefer = assignableMembers.filter((m) => m.permissions === "admin" || m.routingRoles.length > 0);
  return prefer.length > 0 ? prefer : assignableMembers;
};

const getRoundRobinMember = async (
  assignableMembers: UserWithMailboxAccessData[],
): Promise<UserWithMailboxAccessData | null> => {
  const pool = roundRobinPool(assignableMembers);
  if (pool.length === 0) return null;

  const cache = cacheFor<number>(CACHE_ROUND_ROBIN_KEY_PREFIX);

  const lastAssignedIndex = (await cache.get()) ?? 0;
  const nextIndex = (lastAssignedIndex + 1) % pool.length;

  await cache.set(nextIndex);

  return pool[nextIndex] ?? null;
};

const getNextAssigneeFromIssueGroup = async (
  issueGroupId: number,
  assignableMembers: UserWithMailboxAccessData[],
): Promise<{ member: UserWithMailboxAccessData | null; source: string }> => {
  const issueGroup = await db.query.issueGroups.findFirst({
    where: eq(issueGroups.id, issueGroupId),
  });

  if (!issueGroup?.assignees || issueGroup.assignees.length === 0) {
    console.log(
      `[Auto-Assign] Issue group ${issueGroupId} has no assignees configured (assignees: ${issueGroup?.assignees})`,
    );
    return { member: null, source: "no_issue_group_assignees" };
  }

  console.log(
    `[Auto-Assign] Issue group ${issueGroupId} has ${issueGroup.assignees.length} configured assignees: ${issueGroup.assignees.join(", ")}`,
  );

  const availableAssignees = assignableMembers.filter((member) => issueGroup.assignees?.includes(member.id));

  console.log(
    `[Auto-Assign] Found ${availableAssignees.length} active assignees in issue group: ${availableAssignees.map((m) => `${m.displayName} (${m.id})`).join(", ")}`,
  );

  if (availableAssignees.length === 0) {
    return { member: null, source: "no_active_assignees_in_issue_group" };
  }

  const currentIndex = issueGroup.lastAssignedIndex ?? 0;
  const nextIndex = (currentIndex + 1) % availableAssignees.length;

  console.log(
    `[Auto-Assign] Round-robin: currentIndex=${currentIndex}, nextIndex=${nextIndex}, total=${availableAssignees.length}`,
  );

  await db.update(issueGroups).set({ lastAssignedIndex: nextIndex }).where(eq(issueGroups.id, issueGroupId));

  const selectedMember = availableAssignees[nextIndex];
  return {
    member: selectedMember ?? null,
    source: `issue_group_round_robin`,
  };
};

const getPreviousEmailConversationAssignee = async (
  conversation: Conversation & {
    messages?: {
      role: string;
      cleanedUpText?: string | null;
    }[];
  },
  assignableMembers: UserWithMailboxAccessData[],
) => {
  if (conversation.source !== "email" || !conversation.emailFrom) {
    return null;
  }

  if ((conversation.messages?.length ?? 0) > 1) {
    return null;
  }

  const previousConversation = await db.query.conversations.findFirst({
    where: and(
      eq(conversations.source, "email"),
      eq(conversations.emailFrom, conversation.emailFrom),
      isNotNull(conversations.assignedToId),
      isNull(conversations.mergedIntoId),
      ne(conversations.id, conversation.id),
    ),
    columns: {
      id: true,
      assignedToId: true,
    },
    orderBy: (table, { desc }) => [desc(table.createdAt)],
  });

  if (!previousConversation?.assignedToId) {
    return null;
  }

  const assignee = assignableMembers.find((member) => member.id === previousConversation.assignedToId);
  if (!assignee) {
    return null;
  }

  return {
    member: assignee,
    previousConversationId: previousConversation.id,
  };
};

export const autoAssignConversation = async ({ conversationId }: { conversationId: number }) => {
  console.log(`[Auto-Assign] 🎯 Starting auto-assign for conversation ${conversationId}`);

  const conversation = await db.query.conversations.findFirst({
    where: eq(conversations.id, conversationId),
    with: {
      messages: {
        columns: {
          role: true,
          cleanedUpText: true,
        },
      },
    },
  });

  // A conversation can be deleted between this job being queued and it running. That is an ordinary
  // race, not a failure, so skip like `generateBackgroundDraft` does instead of recording an error.
  if (!conversation) {
    console.log(`[Auto-Assign] Conversation ${conversationId} no longer exists, skipping`);
    return { message: "Skipped: conversation no longer exists" };
  }

  console.log(
    `[Auto-Assign] Conversation details - ID: ${conversation.id}, IssueGroupId: ${conversation.issueGroupId ?? "none"}, Subject: ${conversation.subject}`,
  );

  const teamMembers = assertDefinedOrRaiseNonRetriableError(await getUsersWithMailboxAccess());
  const assignableMembers = getAssignableMembers(teamMembers);

  console.log(`[Auto-Assign] Active (non-away) members: ${assignableMembers.length} / ${teamMembers.length} total`);

  if (assignableMembers.length === 0) {
    console.log("[Auto-Assign] ❌ No active team members available");
    return { message: "Skipped: no active team members available for assignment" };
  }

  let nextTeamMember: UserWithMailboxAccessData | null = null;
  let assignmentSource = "unknown";

  const triagePick = await pickMemberByInboundTriage(conversation, assignableMembers);
  if (triagePick.member) {
    nextTeamMember = triagePick.member;
    assignmentSource = triagePick.source;
    console.log(`[Auto-Assign] ✓ Routed via inbound triage → ${nextTeamMember.displayName} (${assignmentSource})`);
  }

  if (!nextTeamMember && conversation.issueGroupId) {
    console.log(
      `[Auto-Assign] 📋 Conversation has issue group ID: ${conversation.issueGroupId}, checking assignees...`,
    );
    const { member, source } = await getNextAssigneeFromIssueGroup(conversation.issueGroupId, assignableMembers);
    if (member) {
      nextTeamMember = member;
      assignmentSource = source;

      console.log(
        `[Auto-Assign] ✓ Found assignee from issue group: ${member.displayName} (${member.id}) via ${source}`,
      );
    } else {
      console.log(`[Auto-Assign] ⚠️ Issue group has no available assignees (source: ${source}), falling back...`);
    }
  } else if (!nextTeamMember) {
    console.log("[Auto-Assign] No issue group assigned, will use previous-email or round-robin");
  }

  if (!nextTeamMember) {
    console.log("[Auto-Assign] 🔍 Attempting previous-email match or round-robin...");
    const previousEmailAssignee = await getPreviousEmailConversationAssignee(conversation, assignableMembers);
    if (previousEmailAssignee) {
      nextTeamMember = previousEmailAssignee.member;
      assignmentSource = "previous_email_assignee";
      console.log(
        `[Auto-Assign] ✓ Reusing assignee ${nextTeamMember.displayName} (${nextTeamMember.id}) from previous conversation ${previousEmailAssignee.previousConversationId}`,
      );
    } else {
      nextTeamMember = await getRoundRobinMember(assignableMembers);
      assignmentSource = "round_robin";
    }

    console.log(
      `[Auto-Assign] ${nextTeamMember ? "✓" : "❌"} Result from ${assignmentSource}: ${nextTeamMember ? `${nextTeamMember.displayName} (${nextTeamMember.id})` : "no match"}`,
    );
  }

  if (!nextTeamMember) {
    console.log("[Auto-Assign] ❌ Failed to find any suitable team member");
    return {
      message: "Skipped: could not find suitable team member for assignment",
      details: "No eligible members in rotation",
    };
  }

  console.log(
    `[Auto-Assign] 🎉 Assigning conversation ${conversation.id} to ${nextTeamMember.displayName} (${nextTeamMember.id}) via ${assignmentSource}`,
  );

  await updateConversation(conversation.id, {
    set: { assignedToId: nextTeamMember.id },
    message:
      assignmentSource === "issue_group_round_robin"
        ? `Assigned from issue group (round-robin)`
        : assignmentSource === "previous_email_assignee"
          ? "Assigned to same staff member as previous email conversation"
          : assignmentSource.startsWith("inbound_triage_")
            ? `Inbound triage routing (${assignmentSource})`
            : "Team member assigned by round robin",
  });

  console.log(`[Auto-Assign] ✓ Successfully assigned conversation ${conversation.id}`);

  await triggerEvent("conversations/template-response.check", {
    conversationId: conversation.id,
  });

  return {
    message: `Assigned conversation ${conversation.id} to ${nextTeamMember.displayName} (${nextTeamMember.id})`,
    assigneeRole: nextTeamMember.role,
    assigneeId: nextTeamMember.id,
    assignmentSource,
  };
};
