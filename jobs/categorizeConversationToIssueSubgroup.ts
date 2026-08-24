import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { conversationMessages } from "@/db/schema/conversationMessages";
import { conversations } from "@/db/schema/conversations";
import { issueSubgroups } from "@/db/schema/issueSubgroups";
import { generateEmbedding, runAIObjectQuery } from "@/lib/ai";
import { MINI_MODEL } from "@/lib/ai/core";
import { cosineSimilarity, issueSubgroupEmbeddingText, normalizeIssueSubgroupTitle } from "@/lib/ai/issueSubgroups";
import { getMailbox } from "@/lib/data/mailbox";
import { env } from "@/lib/env";
import { assertDefinedOrRaiseNonRetriableError } from "./utils";

const EXACT_MERGE_SIMILARITY = 0.9;
const MAYBE_MERGE_SIMILARITY = 0.82;

const getConversationContent = (conversationData: {
  messages?: {
    role: string;
    cleanedUpText?: string | null;
  }[];
  subject?: string | null;
}): string => {
  if (!conversationData?.messages || conversationData.messages.length === 0) {
    return conversationData.subject || "";
  }

  const userMessages = conversationData.messages
    .filter((msg) => msg.role === "user")
    .map((msg) => msg.cleanedUpText || "")
    .filter(Boolean);

  return [conversationData.subject, ...userMessages].filter(Boolean).join(" ");
};

const shouldMergeWithCandidate = async ({
  mailbox,
  proposed,
  candidate,
}: {
  mailbox: Awaited<ReturnType<typeof getMailbox>>;
  proposed: { title: string; description?: string | null };
  candidate: { title: string; description?: string | null };
}) => {
  if (!mailbox) return false;

  const result = await runAIObjectQuery({
    mailbox,
    model: MINI_MODEL,
    queryType: "auto_assign_conversation",
    schema: z.object({
      shouldMerge: z.boolean(),
      reasoning: z.string(),
    }),
    system: `You decide whether two support issue subcategories are effectively the same.
Return shouldMerge=true only when both labels represent the same support problem cluster.`,
    messages: [
      {
        role: "user",
        content: `Compare these subcategories and decide if they should be merged.

Proposed:
- Title: ${proposed.title}
- Description: ${proposed.description || "None"}

Existing:
- Title: ${candidate.title}
- Description: ${candidate.description || "None"}`,
      },
    ],
    temperature: 0,
    functionId: "issue-subgroup-merge-decision",
  });

  return result.shouldMerge;
};

const createOrReuseSubgroup = async ({
  issueGroupId,
  title,
  description,
  siblings,
  mailbox,
}: {
  issueGroupId: number;
  title: string;
  description?: string | null;
  siblings: {
    id: number;
    title: string;
    description: string | null;
    normalizedTitle: string;
    embedding: number[] | null;
  }[];
  mailbox: Awaited<ReturnType<typeof getMailbox>>;
}) => {
  const normalizedTitle = normalizeIssueSubgroupTitle(title);
  const existingByTitle = siblings.find((sibling) => sibling.normalizedTitle === normalizedTitle);
  if (existingByTitle) return existingByTitle.id;

  const embedding = await generateEmbedding(
    issueSubgroupEmbeddingText(title, description),
    "issue-subgroup-embedding",
    {
      skipCache: true,
    },
  );

  const scoredSiblings = siblings
    .filter((sibling) => sibling.embedding)
    .map((sibling) => ({
      sibling,
      similarity: cosineSimilarity(embedding, sibling.embedding!),
    }))
    .sort((a, b) => b.similarity - a.similarity);

  const bestMatch = scoredSiblings[0];
  if (bestMatch && bestMatch.similarity >= EXACT_MERGE_SIMILARITY) {
    return bestMatch.sibling.id;
  }

  if (bestMatch && bestMatch.similarity >= MAYBE_MERGE_SIMILARITY) {
    const shouldMerge = await shouldMergeWithCandidate({
      mailbox,
      proposed: { title, description },
      candidate: {
        title: bestMatch.sibling.title,
        description: bestMatch.sibling.description,
      },
    });

    if (shouldMerge) return bestMatch.sibling.id;
  }

  const inserted = await db
    .insert(issueSubgroups)
    .values({
      issueGroupId,
      title,
      normalizedTitle,
      description,
      embedding,
      createdBy: "ai",
      isArchived: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing({
      target: [issueSubgroups.issueGroupId, issueSubgroups.normalizedTitle],
    })
    .returning({ id: issueSubgroups.id });

  if (inserted[0]?.id) return inserted[0].id;

  const fallback = await db.query.issueSubgroups.findFirst({
    where: and(eq(issueSubgroups.issueGroupId, issueGroupId), eq(issueSubgroups.normalizedTitle, normalizedTitle)),
    columns: { id: true },
  });

  if (fallback?.id) return fallback.id;
  throw new Error("Failed to create or find issue subgroup");
};

export const categorizeConversationToIssueSubgroup = async ({
  conversationId,
  messageId,
}: {
  conversationId: number;
  messageId?: number;
}) => {
  if (!env.SUBCATEGORY_CLASSIFICATION_ENABLED) {
    return { message: "Subcategory classification is disabled" };
  }

  if (!messageId) {
    return { message: "Skipped - messageId required for subcategory classification" };
  }

  const triggeringMessage = await db.query.conversationMessages.findFirst({
    where: eq(conversationMessages.id, messageId),
    columns: { role: true },
  });

  if (!triggeringMessage || triggeringMessage.role !== "user") {
    return { message: "Skipped - only user messages trigger subcategory classification", conversationId, messageId };
  }

  const conversation = assertDefinedOrRaiseNonRetriableError(
    await db.query.conversations.findFirst({
      where: eq(conversations.id, conversationId),
      columns: {
        id: true,
        subject: true,
        issueGroupId: true,
        issueSubgroupId: true,
      },
      with: {
        messages: {
          columns: {
            role: true,
            cleanedUpText: true,
          },
        },
      },
    }),
  );

  if (!conversation.issueGroupId) {
    return { message: "Skipped - conversation has no issue group", conversationId };
  }

  const mailbox = await getMailbox();
  if (!mailbox) {
    return { message: "Skipped - mailbox not found", conversationId };
  }

  const content = getConversationContent(conversation);
  if (!content.trim()) {
    return { message: "Skipped - no conversation content", conversationId };
  }

  const subgroups = await db.query.issueSubgroups.findMany({
    where: and(eq(issueSubgroups.issueGroupId, conversation.issueGroupId), eq(issueSubgroups.isArchived, false)),
    columns: {
      id: true,
      title: true,
      description: true,
      normalizedTitle: true,
      embedding: true,
    },
  });

  const aiResult = await runAIObjectQuery({
    mailbox,
    model: MINI_MODEL,
    queryType: "auto_assign_conversation",
    schema: z.object({
      matchedSubgroupId: z.number().nullable(),
      proposedSubgroupTitle: z.string().nullable(),
      proposedSubgroupDescription: z.string().nullable().optional(),
      reasoning: z.string(),
      confidenceScore: z.number().min(0).max(1).optional(),
    }),
    system: `You categorize support conversations into a single subcategory under an already selected parent issue group.

Rules:
1. If an existing subcategory clearly matches, return matchedSubgroupId.
2. If none match, propose a concise new subcategory title.
3. Never return both matchedSubgroupId and proposedSubgroupTitle.
4. Prefer stable naming (2-5 words), avoid punctuation-heavy labels.`,
    messages: [
      {
        role: "user",
        content: `Conversation:
${content}

Current parent issue group ID: ${conversation.issueGroupId}

Existing subcategories:
${subgroups.length > 0 ? subgroups.map((s) => `ID: ${s.id} | ${s.title} | ${s.description || "No description"}`).join("\n") : "None"}

Return exactly one classification decision.`,
      },
    ],
    temperature: 0.1,
    functionId: "categorize-conversation-to-issue-subgroup",
  });

  let chosenSubgroupId: number | null = null;

  if (aiResult.matchedSubgroupId && subgroups.some((subgroup) => subgroup.id === aiResult.matchedSubgroupId)) {
    chosenSubgroupId = aiResult.matchedSubgroupId;
  } else if (aiResult.proposedSubgroupTitle?.trim()) {
    chosenSubgroupId = await createOrReuseSubgroup({
      issueGroupId: conversation.issueGroupId,
      title: aiResult.proposedSubgroupTitle.trim(),
      description: aiResult.proposedSubgroupDescription ?? null,
      siblings: subgroups,
      mailbox,
    });
  }

  if (!chosenSubgroupId) {
    return {
      message: "Skipped - no subcategory match or proposal returned",
      conversationId,
      issueGroupId: conversation.issueGroupId,
      reasoning: aiResult.reasoning,
      confidenceScore: aiResult.confidenceScore,
    };
  }

  await db
    .update(conversations)
    .set({
      issueSubgroupId: chosenSubgroupId,
    })
    .where(eq(conversations.id, conversationId));

  return {
    message: "Conversation categorized to issue subgroup",
    conversationId,
    issueGroupId: conversation.issueGroupId,
    issueSubgroupId: chosenSubgroupId,
    reasoning: aiResult.reasoning,
    confidenceScore: aiResult.confidenceScore,
  };
};
