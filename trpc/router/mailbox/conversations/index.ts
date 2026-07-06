import { TRPCError, TRPCRouterRecord } from "@trpc/server";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { takeUniqueOrThrow } from "@/components/utils/arrays";
import { assertDefined } from "@/components/utils/assert";
import { db } from "@/db/client";
import { conversationFollowers, conversationMessages, conversations, files } from "@/db/schema";
import { authUsers } from "@/db/supabaseSchema/auth";
import { triggerEvent } from "@/jobs/trigger";
import { generateDraftResponse } from "@/lib/ai/chat";
import { createConversationEmbedding, PromptTooLongError } from "@/lib/ai/conversationEmbedding";
import { serializeConversation, serializeConversationWithMessages, updateConversation } from "@/lib/data/conversation";
import { countSearchResults, searchConversations } from "@/lib/data/conversation/search";
import { searchSchema } from "@/lib/data/conversation/searchSchema";
import {
  createReply,
  deleteStaffDraft,
  getLastAiGeneratedDraft,
  getStaffDraft,
  saveStaffDraft,
  serializeResponseAiDraft,
} from "@/lib/data/conversationMessage";
import { getGmailSupportEmail } from "@/lib/data/gmailSupportEmail";
import { findSimilarConversations } from "@/lib/data/retrieval";
import { isSmtpConfigured } from "@/lib/emails/sendEmail";
import { mailboxProcedure } from "../procedure";
import { filesRouter } from "./files";
import { messagesRouter } from "./messages";
import { notesRouter } from "./notes";
import { conversationProcedure } from "./procedure";
import { toolsRouter } from "./tools";

export const conversationsRouter = {
  list: mailboxProcedure.input(searchSchema).query(async ({ input, ctx }) => {
    const [{ list }, platformCustomer, gmailSupportEmail] = await Promise.all([
      searchConversations(ctx.mailbox, input, ctx.user.id),
      db.query.platformCustomers.findFirst({ columns: { id: true } }),
      getGmailSupportEmail(ctx.mailbox),
    ]);

    const { results, nextCursor } = await list;
    const supportsHighestValueSort = !!platformCustomer && (!input.status || input.status.includes("open"));

    return {
      conversations: results,
      defaultSort: "oldest" as const,
      supportsHighestValueSort,
      onboardingState: {
        hasSmtp: isSmtpConfigured(),
        hasWidgetHost: !!ctx.mailbox.chatIntegrationUsed,
        hasGmailSupportEmail: !!gmailSupportEmail,
      },
      assignedToIds: input.assignee ?? null,
      nextCursor,
    };
  }),

  count: mailboxProcedure.input(searchSchema).query(async ({ input, ctx }) => {
    const { where } = await searchConversations(ctx.mailbox, input, ctx.user.id);
    const total = await countSearchResults(where);
    return { total };
  }),

  listWithPreview: mailboxProcedure.input(searchSchema).query(async ({ input, ctx }) => {
    const { list } = await searchConversations(ctx.mailbox, input, ctx.user.id);
    const { results, nextCursor } = await list;

    const messages = await db
      .select({
        role: conversationMessages.role,
        cleanedUpText: conversationMessages.cleanedUpText,
        conversationId: conversationMessages.conversationId,
        createdAt: conversationMessages.createdAt,
      })
      .from(conversationMessages)
      .where(
        inArray(
          conversationMessages.conversationId,
          results.map((c) => c.id),
        ),
      )
      .orderBy(desc(conversationMessages.createdAt));

    return {
      conversations: results.map((conversation) => {
        const lastUserMessage = messages.find((m) => m.role === "user" && m.conversationId === conversation.id);
        const lastStaffMessage = messages.find((m) => m.role === "staff" && m.conversationId === conversation.id);

        return {
          ...conversation,
          userMessageText: lastUserMessage?.cleanedUpText ?? null,
          staffMessageText:
            lastStaffMessage && lastUserMessage && lastStaffMessage.createdAt > lastUserMessage.createdAt
              ? lastStaffMessage.cleanedUpText
              : null,
        };
      }),
      nextCursor,
    };
  }),

  bySlug: mailboxProcedure.input(z.object({ slugs: z.array(z.string()) })).query(async ({ input, ctx }) => {
    const list = await db.query.conversations.findMany({
      where: and(inArray(conversations.slug, input.slugs)),
    });
    return await Promise.all(list.map((c) => serializeConversationWithMessages(ctx.mailbox, c)));
  }),
  get: conversationProcedure.query(async ({ ctx }) => {
    const conversation = ctx.conversation;
    const draft = await getLastAiGeneratedDraft(conversation.id);

    return {
      ...(await serializeConversationWithMessages(ctx.mailbox, ctx.conversation)),
      draft: draft ? serializeResponseAiDraft(draft, ctx.mailbox) : null,
    };
  }),
  create: mailboxProcedure
    .input(
      z.object({
        conversation: z.object({
          to_email_address: z.string().email(),
          subject: z.string(),
          cc: z.array(z.string().email()),
          bcc: z.array(z.string().email()),
          message: z.string().optional(),
          file_slugs: z.array(z.string()),
          conversation_slug: z.string(),
        }),
      }),
    )
    .mutation(async ({ input: { conversation }, ctx }) => {
      const { id: conversationId } = await db
        .insert(conversations)
        .values({
          slug: conversation.conversation_slug,
          subject: conversation.subject,
          emailFrom: conversation.to_email_address,
          conversationProvider: "gmail",
        })
        .returning({ id: conversations.id })
        .then(takeUniqueOrThrow);

      await createReply({
        conversationId,
        user: ctx.user,
        message: conversation.message?.trim() || null,
        fileSlugs: conversation.file_slugs,
        cc: conversation.cc,
        bcc: conversation.bcc,
      });
    }),
  update: conversationProcedure
    .input(
      z.object({
        status: z.enum(["open", "waiting_on_customer", "closed", "spam", "check_back_later", "ignored"]).optional(),
        assignedToId: z.string().nullable().optional(),
        message: z.string().nullable().optional(),
        assignedToAI: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.assignedToId) {
        const assignee = await db.query.authUsers.findFirst({
          where: eq(authUsers.id, input.assignedToId),
        });
        if (!assignee) throw new TRPCError({ code: "BAD_REQUEST" });
      }

      await updateConversation(ctx.conversation.id, {
        set: {
          ...(input.status !== undefined ? { status: input.status } : {}),
          assignedToId: input.assignedToId,
          assignedToAI: input.assignedToAI,
        },
        byUserId: ctx.user.id,
        message: input.message ?? null,
      });
    }),
  bulkUpdate: mailboxProcedure
    .input(
      z.object({
        conversationFilter: z.union([z.array(z.number()), searchSchema]),
        status: z.enum(["open", "waiting_on_customer", "closed", "spam", "check_back_later", "ignored"]).optional(),
        assignedToId: z.string().nullable().optional(),
        assignedToAI: z.boolean().optional(),
        message: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { conversationFilter, status, assignedToId, message, assignedToAI } = input;

      if (Array.isArray(conversationFilter) && conversationFilter.length <= 25) {
        for (const conversationId of conversationFilter) {
          await updateConversation(conversationId, {
            set: { status, assignedToId, assignedToAI },
            byUserId: ctx.user.id,
            message,
          });
        }
        return { updatedImmediately: true };
      }

      await triggerEvent("conversations/bulk-update", {
        userId: ctx.user.id,
        conversationFilter: input.conversationFilter,
        status: input.status,
        assignedToId: input.assignedToId,
        assignedToAI: input.assignedToAI,
        message: input.message,
      });
      return { updatedImmediately: false };
    }),
  generateDraft: conversationProcedure
    .input(
      z.object({
        customPrompt: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      console.log(
        `[API] generateDraft called by user ${ctx.user.id} for conversation ${ctx.conversation.slug}${input.customPrompt ? " with custom prompt" : ""}`,
      );
      const newDraft = await generateDraftResponse(ctx.conversation.id, ctx.mailbox, undefined, input.customPrompt);
      console.log(`[API] generateDraft completed for conversation ${ctx.conversation.slug}, draft ID: ${newDraft.id}`);
      return serializeResponseAiDraft(newDraft, ctx.mailbox);
    }),

  saveDraft: conversationProcedure
    .input(
      z.object({
        message: z.string(),
        to: z.string().nullable().optional(),
        cc: z.array(z.string()).nullable().optional(),
        bcc: z.array(z.string()).nullable().optional(),
        version: z.number().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const draft = await saveStaffDraft(
          ctx.conversation.id,
          ctx.user.id,
          input.message,
          input.to ?? null,
          input.cc ?? null,
          input.bcc ?? null,
          input.version ?? null,
        );

        return {
          id: draft.id,
          body: draft.body,
          emailTo: draft.emailTo,
          emailCc: draft.emailCc,
          emailBcc: draft.emailBcc,
          draftAuthorId: draft.draftAuthorId,
          draftEditedAt: draft.draftEditedAt,
          draftVersion: draft.draftVersion,
        };
      } catch (error) {
        if (error instanceof Error && error.message === "DRAFT_CONFLICT") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Draft has been modified by another user",
          });
        }
        throw error;
      }
    }),

  getDraft: conversationProcedure.query(async ({ ctx }) => {
    const draft = await getStaffDraft(ctx.conversation.id);
    if (!draft) {
      return null;
    }

    return {
      id: draft.id,
      body: draft.body,
      emailTo: draft.emailTo,
      emailCc: draft.emailCc,
      emailBcc: draft.emailBcc,
      draftAuthorId: draft.draftAuthorId,
      draftEditedAt: draft.draftEditedAt,
      draftVersion: draft.draftVersion,
    };
  }),

  deleteDraft: conversationProcedure.mutation(async ({ ctx }) => {
    await deleteStaffDraft(ctx.conversation.id);
    return { success: true };
  }),

  undo: conversationProcedure.input(z.object({ emailId: z.number() })).mutation(async ({ ctx, input }) => {
    const email = await db.query.conversationMessages.findFirst({
      where: and(
        eq(conversationMessages.id, input.emailId),
        eq(conversationMessages.conversationId, ctx.conversation.id),
        isNull(conversationMessages.deletedAt),
        eq(conversationMessages.status, "queueing"),
      ),
    });
    if (!email) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Email not found",
      });
    }

    await db.transaction(async (tx) => {
      await Promise.all([
        tx.update(conversationMessages).set({ deletedAt: new Date() }).where(eq(conversationMessages.id, email.id)),
        tx.update(conversations).set({ status: "open" }).where(eq(conversations.id, ctx.conversation.id)),
        tx.update(files).set({ messageId: null }).where(eq(files.messageId, email.id)),
      ]);
    });
  }),

  messages: messagesRouter,
  files: filesRouter,
  tools: toolsRouter,
  notes: notesRouter,

  findSimilar: conversationProcedure.query(async ({ ctx }) => {
    let conversation = ctx.conversation;
    if (!conversation.embeddingText) {
      try {
        conversation = await createConversationEmbedding(conversation.id);
      } catch (e) {
        if (e instanceof PromptTooLongError) return null;
        throw e;
      }
    }

    const similarConversations = await findSimilarConversations(
      assertDefined(conversation.embeddingText),
      5,
      conversation.slug,
    );

    return {
      conversations: await Promise.all(
        similarConversations?.map((c) => serializeConversation(ctx.mailbox, c, null)) ?? [],
      ),
      similarityMap: similarConversations?.reduce(
        (acc, c) => {
          acc[c.slug] = c.similarity;
          return acc;
        },
        {} as Record<string, number>,
      ),
    };
  }),

  follow: conversationProcedure.mutation(async ({ ctx }) => {
    return await db.transaction(async (tx) => {
      await tx
        .insert(conversationFollowers)
        .values({
          conversationId: ctx.conversation.id,
          userId: ctx.user.id,
        })
        .onConflictDoNothing();

      return { success: true, following: true };
    });
  }),

  unfollow: conversationProcedure.mutation(async ({ ctx }) => {
    return await db.transaction(async (tx) => {
      await tx
        .delete(conversationFollowers)
        .where(
          and(
            eq(conversationFollowers.conversationId, ctx.conversation.id),
            eq(conversationFollowers.userId, ctx.user.id),
          ),
        );

      return { success: true, following: false };
    });
  }),

  isFollowing: conversationProcedure.query(async ({ ctx }) => {
    const follower = await db.query.conversationFollowers.findFirst({
      columns: { id: true },
      where: and(
        eq(conversationFollowers.conversationId, ctx.conversation.id),
        eq(conversationFollowers.userId, ctx.user.id),
      ),
    });

    return { following: !!follower };
  }),

  markAsRead: conversationProcedure.mutation(async ({ ctx }) => {
    // Only update lastReadByAssigneeAt if current user is the assignee
    if (ctx.conversation.assignedToId === ctx.user.id) {
      await db
        .update(conversations)
        .set({
          lastReadByAssigneeAt: new Date(),
        })
        .where(eq(conversations.id, ctx.conversation.id));
      return { success: true, updated: true };
    }

    // Silent success - user viewed conversation but wasn't assignee
    return { success: true, updated: false };
  }),

  bulkForward: mailboxProcedure
    .input(
      z.object({
        conversationSlugs: z.array(z.string()).min(1).max(50),
        to: z.array(z.string().email()).min(1),
        note: z.string().optional(),
        includeFullThread: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await triggerEvent("conversations/bulk-forward", {
        userId: ctx.user.id,
        conversationSlugs: input.conversationSlugs,
        to: input.to,
        note: input.note,
        includeFullThread: input.includeFullThread,
      });

      return { success: true, count: input.conversationSlugs.length };
    }),
} satisfies TRPCRouterRecord;
