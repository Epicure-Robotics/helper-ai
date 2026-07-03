import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { conversationMessages, conversations, mailboxes } from "@/db/schema";
import { triggerEvent } from "@/jobs/trigger";
import { getMailboxInfo } from "@/lib/data/mailbox";
import { findSimilarConversations } from "@/lib/data/retrieval";
import { conversationsRouter } from "./conversations/index";
import { customersRouter } from "./customers";
import { faqsRouter } from "./faqs";
import { issueGroupsRouter } from "./issueGroups";
import { knowledgeGapsRouter } from "./knowledgeGaps";
import { membersRouter } from "./members";
import { mailboxProcedure } from "./procedure";
import { savedRepliesRouter } from "./savedReplies";
import { toolsRouter } from "./tools";
import { websitesRouter } from "./websites";

export { mailboxProcedure };

export const mailboxRouter = {
  openCount: mailboxProcedure.query(async ({ ctx }) => {
    const [counts] = await db
      .select({
        openAll: count(sql`CASE WHEN ${conversations.status} = 'open' THEN 1 END`),
        openMine: count(
          sql`CASE WHEN ${conversations.status} = 'open' AND ${conversations.assignedToId} = ${ctx.user.id} THEN 1 END`,
        ),
        openAssigned: count(
          sql`CASE WHEN ${conversations.status} = 'open' AND ${conversations.assignedToId} IS NOT NULL THEN 1 END`,
        ),
        openClassified: count(
          sql`CASE WHEN ${conversations.status} = 'open' AND ${conversations.issueGroupId} IS NOT NULL THEN 1 END`,
        ),
        openUnclassified: count(
          sql`CASE WHEN ${conversations.status} = 'open' AND ${conversations.issueGroupId} IS NULL THEN 1 END`,
        ),
        openUnread: count(
          sql`CASE WHEN ${conversations.status} = 'open' AND ${conversations.assignedToId} IS NOT NULL AND EXISTS (
            SELECT 1 FROM ${conversationMessages} 
            WHERE ${conversationMessages.conversationId} = ${conversations.id} 
            AND ${conversationMessages.role} = 'user' 
            AND ${conversationMessages.deletedAt} IS NULL 
            AND ${conversationMessages.createdAt} > COALESCE(${conversations.lastReadByAssigneeAt}, ${conversations.createdAt})
          ) THEN 1 END`,
        ),

        waitingAll: count(sql`CASE WHEN ${conversations.status} = 'waiting_on_customer' THEN 1 END`),
        waitingMine: count(
          sql`CASE WHEN ${conversations.status} = 'waiting_on_customer' AND ${conversations.assignedToId} = ${ctx.user.id} THEN 1 END`,
        ),
        waitingAssigned: count(
          sql`CASE WHEN ${conversations.status} = 'waiting_on_customer' AND ${conversations.assignedToId} IS NOT NULL THEN 1 END`,
        ),

        closedAll: count(sql`CASE WHEN ${conversations.status} = 'closed' THEN 1 END`),
        closedMine: count(
          sql`CASE WHEN ${conversations.status} = 'closed' AND ${conversations.assignedToId} = ${ctx.user.id} THEN 1 END`,
        ),
        closedAssigned: count(
          sql`CASE WHEN ${conversations.status} = 'closed' AND ${conversations.assignedToId} IS NOT NULL THEN 1 END`,
        ),

        spamAll: count(sql`CASE WHEN ${conversations.status} = 'spam' THEN 1 END`),
        spamMine: count(
          sql`CASE WHEN ${conversations.status} = 'spam' AND ${conversations.assignedToId} = ${ctx.user.id} THEN 1 END`,
        ),
        spamAssigned: count(
          sql`CASE WHEN ${conversations.status} = 'spam' AND ${conversations.assignedToId} IS NOT NULL THEN 1 END`,
        ),
        checkBackLaterAll: count(sql`CASE WHEN ${conversations.status} = 'check_back_later' THEN 1 END`),
        checkBackLaterMine: count(
          sql`CASE WHEN ${conversations.status} = 'check_back_later' AND ${conversations.assignedToId} = ${ctx.user.id} THEN 1 END`,
        ),
        checkBackLaterAssigned: count(
          sql`CASE WHEN ${conversations.status} = 'check_back_later' AND ${conversations.assignedToId} IS NOT NULL THEN 1 END`,
        ),
        ignoredAll: count(sql`CASE WHEN ${conversations.status} = 'ignored' THEN 1 END`),
        ignoredMine: count(
          sql`CASE WHEN ${conversations.status} = 'ignored' AND ${conversations.assignedToId} = ${ctx.user.id} THEN 1 END`,
        ),
        ignoredAssigned: count(
          sql`CASE WHEN ${conversations.status} = 'ignored' AND ${conversations.assignedToId} IS NOT NULL THEN 1 END`,
        ),
      })
      .from(conversations)
      .where(isNull(conversations.mergedIntoId));

    if (!counts) {
      throw new Error("Failed to fetch conversation counts");
    }

    const getCategoryCounts = (prefix: "open" | "waiting" | "closed" | "spam" | "checkBackLater" | "ignored") => {
      const all = Number(counts[`${prefix}All` as keyof typeof counts] || 0);
      const mine = Number(counts[`${prefix}Mine` as keyof typeof counts] || 0);
      const assigned = Number(counts[`${prefix}Assigned` as keyof typeof counts] || 0);
      return {
        all,
        mine,
        assigned,
        unassigned: all - assigned,
      };
    };

    return {
      all: Number(counts.openAll || 0),
      mine: Number(counts.openMine || 0),
      assigned: Number(counts.openAssigned || 0),

      open: getCategoryCounts("open"),
      openClassified: Number(counts.openClassified || 0),
      openUnclassified: Number(counts.openUnclassified || 0),
      openUnread: Number(counts.openUnread || 0),
      waiting_on_customer: getCategoryCounts("waiting"),
      closed: getCategoryCounts("closed"),
      spam: getCategoryCounts("spam"),
      check_back_later: getCategoryCounts("checkBackLater"),
      ignored: getCategoryCounts("ignored"),
    };
  }),
  get: mailboxProcedure.query(({ ctx }) => getMailboxInfo(ctx.mailbox)),
  update: mailboxProcedure
    .input(
      z.object({
        githubRepoOwner: z.string().optional(),
        githubRepoName: z.string().optional(),
        widgetDisplayMode: z.enum(["off", "always", "revenue_based"]).optional(),
        widgetDisplayMinValue: z.number().nullable().optional(),
        widgetHost: z.string().nullable().optional(),
        customerInfoUrl: z.string().nullable().optional(),
        vipThreshold: z.number().nullable().optional(),
        vipExpectedResponseHours: z.number().nullable().optional(),
        autoCloseEnabled: z.boolean().optional(),
        autoCloseDaysOfInactivity: z.number().optional(),
        closedThreadEmailEnabled: z.boolean().optional(),
        weekendAutoReplyEnabled: z.boolean().optional(),
        weekendAutoReplyMessage: z.string().nullable().optional(),
        holidayAutoReplyEnabled: z.boolean().optional(),
        holidayAutoReplyMessage: z.string().nullable().optional(),
        name: z.string().optional(),
        preferences: z
          .object({
            autoRespondEmailToChat: z.enum(["draft", "reply"]).nullable().optional(),
            disableTicketResponseTimeAlerts: z.boolean().optional(),
            archiveGmailOnReply: z.boolean().optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const preferences = { ...ctx.mailbox.preferences, ...(input.preferences ?? {}) };
      await db
        .update(mailboxes)
        .set({ ...input, preferences })
        .where(eq(mailboxes.id, ctx.mailbox.id));
    }),

  conversations: conversationsRouter,
  faqs: faqsRouter,
  knowledgeGaps: knowledgeGapsRouter,
  members: membersRouter,
  tools: toolsRouter,
  customers: customersRouter,
  websites: websitesRouter,
  savedReplies: savedRepliesRouter,
  issueGroups: issueGroupsRouter,

  autoClose: mailboxProcedure.mutation(async ({ ctx }) => {
    if (!ctx.mailbox.autoCloseEnabled) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Auto-close is not enabled for this mailbox",
      });
    }

    await triggerEvent("conversations/auto-close.check", {});

    return {
      success: true,
      message: "Auto-close job triggered successfully",
    };
  }),

  searchConversationsWithAI: mailboxProcedure
    .input(
      z.object({
        query: z.string().min(1).max(500),
      }),
    )
    .mutation(async ({ input }) => {
      const { query } = input;

      // Use AI embedding-based semantic search
      const similarConversations = await findSimilarConversations(
        query,
        20, // limit
        undefined, // no excludeConversationSlug
        0.3, // lower threshold for broader search results
      );

      if (!similarConversations || similarConversations.length === 0) {
        return {
          results: [],
          interpretation: `AI searched for conversations semantically related to "${query}" but found no close matches. Try different keywords or be more specific.`,
        };
      }

      // Get the first message snippet for each conversation
      const conversationIds = similarConversations.map((c) => c.id);
      const messageSnippets = await db
        .select({
          conversationId: conversationMessages.conversationId,
          snippet: conversationMessages.cleanedUpText,
        })
        .from(conversationMessages)
        .where(
          and(
            inArray(conversationMessages.conversationId, conversationIds),
            isNull(conversationMessages.deletedAt),
            inArray(conversationMessages.role, ["user", "staff"]),
          ),
        )
        .orderBy(conversationMessages.createdAt)
        .limit(conversationIds.length);

      const snippetMap = new Map(messageSnippets.map((m) => [m.conversationId, m.snippet]));

      // Format results with similarity scores
      const formattedResults = similarConversations.map((conversation) => {
        const snippet =
          snippetMap.get(conversation.id)?.substring(0, 200) ||
          conversation.embeddingText?.substring(0, 200) ||
          conversation.subject?.substring(0, 200) ||
          "";

        return {
          id: conversation.id,
          slug: conversation.slug || "",
          subject: conversation.subject || "No Subject",
          customerEmail: conversation.emailFrom || "",
          customerName: conversation.emailFromName || null,
          snippet,
          createdAt: conversation.createdAt,
          status: conversation.status || "open",
          matchedIn: "message" as const,
          similarity: Number((conversation as any).similarity || 0),
        };
      });

      const avgSimilarity = formattedResults.reduce((sum, r) => sum + r.similarity, 0) / formattedResults.length;
      const similarityPercent = Math.round(avgSimilarity * 100);

      return {
        results: formattedResults,
        interpretation: `AI found ${formattedResults.length} conversation${formattedResults.length === 1 ? "" : "s"} semantically related to "${query}" (avg ${similarityPercent}% match using embeddings)`,
      };
    }),
} satisfies TRPCRouterRecord;
