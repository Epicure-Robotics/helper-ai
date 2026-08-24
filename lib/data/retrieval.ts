import { and, cosineDistance, desc, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { conversationMessages, faqs } from "@/db/schema";
import { conversations } from "@/db/schema/conversations";
import { websitePages, websites } from "@/db/schema/websites";
import { triggerEvent } from "@/jobs/trigger";
import { generateEmbedding } from "@/lib/ai";
import { knowledgeBankPrompt, PAST_CONVERSATIONS_PROMPT, websitePagesPrompt } from "@/lib/ai/prompts";
import { captureExceptionAndLog } from "@/lib/shared/sentry";
import { cleanUpTextForAI } from "../ai/core";

const SIMILARITY_THRESHOLD = 0.4;
/** Slightly lower threshold for chat/widget retrieval so short queries still match crawled pages. */
const CHAT_WEBSITE_SIMILARITY_THRESHOLD = 0.33;
const MAX_SIMILAR_CONVERSATIONS = 3;
const MAX_SIMILAR_WEBSITE_PAGES = 5;
/** Max FAQs injected into chat system prompt (semantic top-K); avoids huge prompts and slow TTFT. */
const MAX_SIMILAR_FAQS_IN_CHAT_PROMPT = 15;
/** Slightly looser than inbox-only retrieval so short widget messages still match FAQs. */
const CHAT_FAQ_SIMILARITY_THRESHOLD = 0.38;
const LOW_SIGNAL_QUERY_MAX_FAQS = 8;

const GREETING_PREFIX = /^(hi+|hello+|hey+|hola|thanks|thank you|ok+|okay|yo|sup|howdy)\b[\s,.!?-]*/i;

/**
 * True only when the message carries no question to search against. A leading greeting does not make it
 * low-signal: "hey, how much is a Zoe drink?" still deserves real retrieval, only the bare "hey" does not.
 */
const isLowSignalQuery = (query: string) => {
  const trimmed = query.trim();
  if (trimmed.length < 4) return true;
  return trimmed.replace(GREETING_PREFIX, "").trim().length < 10;
};

export const findSimilarConversations = async (
  queryInput: string | number[],
  limit: number = MAX_SIMILAR_CONVERSATIONS,
  excludeConversationSlug?: string,
  similarityThreshold: number = SIMILARITY_THRESHOLD,
) => {
  const queryEmbedding = Array.isArray(queryInput)
    ? queryInput
    : await generateEmbedding(queryInput, "query-find-past-conversations");
  const similarity = sql<number>`1 - (${cosineDistance(conversations.embedding, queryEmbedding)})`;

  let where = sql`${gt(similarity, similarityThreshold)} AND ${eq(conversations.isPrompt, false)}`;
  if (excludeConversationSlug) {
    where = sql`${where} AND ${conversations.slug} != ${excludeConversationSlug}`;
  }

  const similarConversations = await db.query.conversations.findMany({
    where: and(where, isNull(conversations.mergedIntoId), isNotNull(conversations.embedding)),
    extras: {
      similarity: similarity.as("similarity"),
    },
    orderBy: (_conversations, { desc }) => [desc(similarity)],
    limit,
  });

  if (similarConversations.length === 0) return null;

  return similarConversations;
};

export const getPastConversationsPrompt = async (query: string) => {
  const similarConversations = await findSimilarConversations(query);
  if (!similarConversations) return null;

  const pastConversations = await Promise.all(
    similarConversations.map(async (conversation) => {
      const messages = await db.query.conversationMessages.findMany({
        where: eq(conversationMessages.conversationId, conversation.id),
        orderBy: (messages, { asc }) => [asc(messages.id)],
      });

      return `--- Conversation Start ---\nDate: ${conversation.createdAt.toLocaleDateString()}\n${messages
        .map((message) => {
          const role = message.role === "user" ? "Customer" : "Agent";
          return `${role}:\n${cleanUpTextForAI(message.cleanedUpText || message.body)}`;
        })
        .join("\n")}\n--- Conversation End ---`;
    }),
  );

  let conversationPrompt = PAST_CONVERSATIONS_PROMPT.replace("{{PAST_CONVERSATIONS}}", pastConversations.join("\n\n"));
  conversationPrompt = conversationPrompt.replace("{{USER_QUERY}}", query);

  return conversationPrompt;
};

export const findEnabledKnowledgeBankEntries = async (mailboxId: number) =>
  await db.query.faqs.findMany({
    where: and(eq(faqs.enabled, true), or(eq(faqs.unused_mailboxId, mailboxId), eq(faqs.unused_mailboxId, 0))),
    columns: {
      id: true,
      content: true,
    },
    orderBy: (faqs, { asc }) => [asc(faqs.content)],
  });

export const findTopSimilarFaqsForChat = async (
  queryEmbedding: number[],
  mailboxId: number,
  limit: number = MAX_SIMILAR_FAQS_IN_CHAT_PROMPT,
  similarityThreshold: number = CHAT_FAQ_SIMILARITY_THRESHOLD,
) => {
  const similarity = sql<number>`1 - (${cosineDistance(faqs.embedding, queryEmbedding)})`;
  return await db
    .select({
      id: faqs.id,
      content: faqs.content,
      similarity: similarity.as("similarity"),
    })
    .from(faqs)
    .where(
      and(
        gt(similarity, similarityThreshold),
        eq(faqs.enabled, true),
        isNotNull(faqs.embedding),
        or(eq(faqs.unused_mailboxId, mailboxId), eq(faqs.unused_mailboxId, 0)),
      ),
    )
    .orderBy(desc(similarity))
    .limit(limit);
};

export const findSimilarWebsitePages = async (
  query: string | number[],
  mailboxId: number,
  limit: number = MAX_SIMILAR_WEBSITE_PAGES,
  similarityThreshold: number = SIMILARITY_THRESHOLD,
) => {
  const queryEmbedding = Array.isArray(query) ? query : await generateEmbedding(query, "embedding-query-similar-pages");
  const similarity = sql<number>`1 - (${cosineDistance(websitePages.embedding, queryEmbedding)})`;

  const similarPages = await db
    .select({
      url: websitePages.url,
      pageTitle: websitePages.pageTitle,
      markdown: websitePages.markdown,
      similarity: similarity.as("similarity"),
    })
    .from(websitePages)
    .innerJoin(
      websites,
      and(
        eq(websites.id, websitePages.websiteId),
        isNull(websites.deletedAt),
        or(eq(websites.unused_mailboxId, mailboxId), eq(websites.unused_mailboxId, 0)),
      ),
    )
    .where(and(gt(similarity, similarityThreshold), isNull(websitePages.deletedAt)))
    .orderBy(desc(similarity))
    .limit(limit);

  const pagesWithSimilarity = similarPages.map((page) => ({
    url: page.url,
    pageTitle: page.pageTitle,
    markdown: page.markdown,
    similarity: Number(page.similarity),
  }));

  return pagesWithSimilarity;
};

export type PromptRetrievalData = {
  knowledgeBank: string | null;
  knowledgeBankEntryIds: number[];
  metadata: string | null;
  websitePagesPrompt: string | null;
  websitePages: {
    url: string;
    pageTitle: string;
    markdown: string;
    similarity: number;
  }[];
};

/** Widget chat fallback: no embedding + vector search, just the first N enabled FAQs. */
const WIDGET_FAST_FAQ_LIMIT = 10;
/** Widget chat semantic retrieval: tighter caps than the inbox so TTFT and prompt size stay low. */
const WIDGET_MAX_WEBSITE_PAGES = 3;
const WIDGET_MAX_FAQS = 8;
const WIDGET_WEBSITE_PAGE_MAX_CHARS = 1800;
const WIDGET_KNOWLEDGE_BANK_MAX_CHARS = 12_000;
/** If semantic retrieval is slower than this, answer from the cheap fallback rather than stalling the stream. */
const WIDGET_RETRIEVAL_TIMEOUT_MS = 2500;

const fetchWidgetFallbackRetrievalData = async (mailboxId: number): Promise<PromptRetrievalData> => {
  const enabled = await findEnabledKnowledgeBankEntries(mailboxId);
  const capped = enabled.slice(0, WIDGET_FAST_FAQ_LIMIT);
  return {
    knowledgeBank: knowledgeBankPrompt(capped, WIDGET_KNOWLEDGE_BANK_MAX_CHARS),
    knowledgeBankEntryIds: capped.map((e) => e.id),
    metadata: null,
    websitePagesPrompt: null,
    websitePages: [],
  };
};

/**
 * Widget chat retrieval. Runs the same semantic search as the inbox (so answers are grounded in the FAQs and
 * crawled pages that actually match the question, and can be cited), but under a latency budget: if the
 * embedding + vector search does not finish in time, fall back to the cheap capped-FAQ prompt.
 */
export const fetchFastWidgetRetrievalData = async (mailboxId: number, query = ""): Promise<PromptRetrievalData> => {
  if (!query.trim() || isLowSignalQuery(query)) return fetchWidgetFallbackRetrievalData(mailboxId);

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const semantic = fetchPromptRetrievalData(query, null, mailboxId, {
      maxWebsitePages: WIDGET_MAX_WEBSITE_PAGES,
      maxFaqs: WIDGET_MAX_FAQS,
      websitePageMaxChars: WIDGET_WEBSITE_PAGE_MAX_CHARS,
      knowledgeBankMaxChars: WIDGET_KNOWLEDGE_BANK_MAX_CHARS,
    });
    // Swallow a late rejection so losing the race never produces an unhandled rejection.
    semantic.catch(() => {});
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), WIDGET_RETRIEVAL_TIMEOUT_MS);
    });
    const result = await Promise.race([semantic, timeout]);
    if (result) return result;
  } catch (error) {
    captureExceptionAndLog(error);
  } finally {
    if (timer) clearTimeout(timer);
  }

  return fetchWidgetFallbackRetrievalData(mailboxId);
};

export const fetchPromptRetrievalData = async (
  query: string,
  metadata: object | null,
  mailboxId: number,
  {
    maxWebsitePages = MAX_SIMILAR_WEBSITE_PAGES,
    maxFaqs = MAX_SIMILAR_FAQS_IN_CHAT_PROMPT,
    websitePageMaxChars,
    knowledgeBankMaxChars,
  }: {
    maxWebsitePages?: number;
    maxFaqs?: number;
    websitePageMaxChars?: number;
    knowledgeBankMaxChars?: number;
  } = {},
): Promise<PromptRetrievalData> => {
  const metadataText = metadata ? `User metadata:\n${JSON.stringify(metadata, null, 2)}` : null;

  if (isLowSignalQuery(query)) {
    const enabled = await findEnabledKnowledgeBankEntries(mailboxId);
    const capped = enabled.slice(0, Math.min(LOW_SIGNAL_QUERY_MAX_FAQS, maxFaqs));
    return {
      knowledgeBank: knowledgeBankPrompt(capped, knowledgeBankMaxChars),
      knowledgeBankEntryIds: capped.map((e) => e.id),
      metadata: metadataText,
      websitePagesPrompt: null,
      websitePages: [],
    };
  }

  let queryEmbedding: number[];
  try {
    // Compute the query embedding once and reuse it across all similarity searches.
    queryEmbedding = await generateEmbedding(query, "embedding-query-similar-pages");
  } catch (error) {
    captureExceptionAndLog(error);
    const knowledgeBankFallback = await findEnabledKnowledgeBankEntries(mailboxId);
    const capped = knowledgeBankFallback.slice(0, maxFaqs);
    return {
      knowledgeBank: knowledgeBankPrompt(capped, knowledgeBankMaxChars),
      knowledgeBankEntryIds: capped.map((e) => e.id),
      metadata: metadataText,
      websitePagesPrompt: null,
      websitePages: [],
    };
  }

  const [websitePages, similarFaqsRanked] = await Promise.all([
    findSimilarWebsitePages(queryEmbedding, mailboxId, maxWebsitePages, CHAT_WEBSITE_SIMILARITY_THRESHOLD),
    findTopSimilarFaqsForChat(queryEmbedding, mailboxId, maxFaqs),
  ]);

  let knowledgeEntries: { id: number; content: string }[];
  if (similarFaqsRanked.length > 0) {
    knowledgeEntries = similarFaqsRanked.map((f) => ({ id: f.id, content: f.content }));
  } else {
    const enabled = await findEnabledKnowledgeBankEntries(mailboxId);
    knowledgeEntries = enabled.slice(0, maxFaqs).map((e) => ({ id: e.id, content: e.content }));
  }

  // A gap is a query where neither website pages nor any FAQ entry was semantically
  // relevant. Checking FAQ similarity (not just list length) prevents false negatives
  // in mailboxes that already have FAQ entries unrelated to this particular query.
  if (query.trim().length > 10 && websitePages.length === 0 && similarFaqsRanked.length === 0) {
    triggerEvent("knowledge/gap.detected", { query }).catch(() => {
      // Non-critical: don't fail the main request if gap logging fails
    });
  }

  return {
    knowledgeBank: knowledgeBankPrompt(knowledgeEntries, knowledgeBankMaxChars),
    knowledgeBankEntryIds: knowledgeEntries.map((e) => e.id),
    metadata: metadataText,
    websitePagesPrompt: websitePages.length > 0 ? websitePagesPrompt(websitePages, websitePageMaxChars) : null,
    websitePages,
  };
};
