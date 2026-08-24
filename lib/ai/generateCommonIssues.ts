import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { conversationMessages } from "@/db/schema";
import type { mailboxes } from "@/db/schema/mailboxes";
import { runAIObjectQuery } from "@/lib/ai";
import { DRAFT_MODEL } from "@/lib/ai/core";
import { searchConversations } from "@/lib/data/conversation/search";

const commonIssuesGenerationSchema = z.object({
  issues: z.array(
    z.object({
      title: z.string(),
      description: z.string().optional(),
      reasoning: z.string(),
    }),
  ),
});

type CommonIssuesGeneration = z.infer<typeof commonIssuesGenerationSchema>;

/**
 * Per-field caps. Only the gist of each thread is needed to cluster 50 of them into 3-7 categories,
 * and newsletters/system mail in a real inbox run to tens of thousands of characters each. Without
 * these the prompt reached ~135k tokens and every call died against the 200k/min OpenAI token limit.
 */
const SUBJECT_CHARS = 200;
const MESSAGE_CHARS = 600;

const truncate = (text: string | null | undefined, max: number): string => {
  const clean = text?.trim();
  if (!clean) return "";
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
};

export const generateCommonIssuesSuggestions = async (
  mailbox: typeof mailboxes.$inferSelect,
): Promise<CommonIssuesGeneration> => {
  const { list } = await searchConversations(mailbox, {
    limit: 50,
    status: ["open", "waiting_on_customer", "closed", "check_back_later"],
    sort: "newest",
  });

  const { results: conversations } = await list;

  if (conversations.length === 0) {
    return { issues: [] };
  }

  const conversationIds = conversations.map((conv) => conv.id);

  const firstMessages = await db
    .selectDistinctOn([conversationMessages.conversationId], {
      conversationId: conversationMessages.conversationId,
      cleanedUpText: conversationMessages.cleanedUpText,
    })
    .from(conversationMessages)
    .where(and(inArray(conversationMessages.conversationId, conversationIds), eq(conversationMessages.role, "user")))
    .orderBy(conversationMessages.conversationId, asc(conversationMessages.createdAt));

  const firstMessageMap = new Map(
    firstMessages.map((msg) => [msg.conversationId, msg.cleanedUpText] as const).filter(([_, text]) => text),
  );

  const conversationSummaries = conversations
    .map((conv) => ({
      subject: truncate(conv.subject, SUBJECT_CHARS),
      firstMessage: truncate(firstMessageMap.get(conv.id), MESSAGE_CHARS),
      recentMessage: truncate(conv.recentMessageText, MESSAGE_CHARS),
      status: conv.status,
    }))
    .filter((conv) => conv.subject || conv.firstMessage || conv.recentMessage);

  if (conversationSummaries.length === 0) {
    return { issues: [] };
  }

  const systemPrompt = `
You are analyzing customer support conversations to identify recurring category patterns that belong together.

Based on the conversation data provided, identify 3-7 categories that would help organize and track recurring customer problems.

For each category you identify:
1. Create a clear, concise title (2-5 words)
2. Provide a brief description explaining what types of conversations belong in this category
3. Explain your reasoning for why this is a common pattern

Focus on:
- Recurring themes across multiple conversations
- Technical issues that appear frequently
- Common customer requests or complaints
- Billing, account, or service-related patterns
- Product feature questions or problems

Avoid:
- Overly specific issues that only apply to one conversation
- Categories that are too broad to be useful
- Duplicate or overlapping categories

Return only the most valuable and distinct categories.
Do not use em dashes (—) in your response.
`;

  const userPrompt = `
Analyze these recent customer support conversations to identify recurring category patterns:

${conversationSummaries
  .map(
    (conv, i) =>
      `Conversation ${i + 1}:
Subject: ${conv.subject || "No subject"}
First message: ${conv.firstMessage || "No first message"}
Recent message: ${conv.recentMessage || "No recent message"}
Status: ${conv.status}
`,
  )
  .join("\n")}

Based on these conversations, what are the strongest categories that would help organize similar future conversations?
`;

  const result = await runAIObjectQuery({
    model: DRAFT_MODEL,
    functionId: "generate-common-issues-suggestions",
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
    mailbox,
    queryType: "chat_completion",
    schema: commonIssuesGenerationSchema,
  });

  return result;
};
