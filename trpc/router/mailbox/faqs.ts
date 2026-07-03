import { TRPCError, TRPCRouterRecord } from "@trpc/server";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { takeUniqueOrThrow } from "@/components/utils/arrays";
import { db } from "@/db/client";
import { conversationMessages, faqs, savedReplies } from "@/db/schema";
import { triggerEvent } from "@/jobs/trigger";
import { generateKnowledgeBankSuggestion } from "@/lib/ai/knowledgeBankSuggestions";
import { approveSuggestedEdit, rejectSuggestedEdit } from "@/lib/data/knowledge";
import { resetMailboxPromptUpdatedAt } from "@/lib/data/mailbox";
import { mailboxProcedure } from "./procedure";

export const faqsRouter = {
  list: mailboxProcedure.query(async ({}) => {
    return await db
      .select({
        id: faqs.id,
        content: faqs.content,
        enabled: faqs.enabled,
        suggested: faqs.suggested,
        suggestedReplacementForId: faqs.suggestedReplacementForId,
        createdAt: faqs.createdAt,
        updatedAt: faqs.updatedAt,
        usageCount: faqs.usageCount,
        lastUsedAt: faqs.lastUsedAt,
      })
      .from(faqs)
      .orderBy(asc(faqs.content));
  }),
  create: mailboxProcedure
    .input(
      z.object({
        content: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      return await db.transaction(async (tx) => {
        const faq = await tx.insert(faqs).values({ content: input.content }).returning().then(takeUniqueOrThrow);

        await resetMailboxPromptUpdatedAt(tx);

        await triggerEvent("faqs/embedding.create", { faqId: faq.id });

        return faq;
      });
    }),
  update: mailboxProcedure
    .input(
      z.object({
        id: z.number(),
        content: z.string().optional(),
        enabled: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      return await db.transaction(async (tx) => {
        const faq = await tx
          .update(faqs)
          .set({ content: input.content, enabled: input.enabled, suggested: false })
          .where(and(eq(faqs.id, input.id)))
          .returning()
          .then(takeUniqueOrThrow);

        if (faq.suggested) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot update suggested FAQ, use accept or reject instead",
          });
        }

        await resetMailboxPromptUpdatedAt(tx);

        await triggerEvent("faqs/embedding.create", { faqId: faq.id });

        return faq;
      });
    }),
  delete: mailboxProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    return await db.transaction(async (tx) => {
      const [faq] = await tx
        .select()
        .from(faqs)
        .where(and(eq(faqs.id, input.id)))
        .limit(1);
      if (!faq) {
        throw new TRPCError({ code: "NOT_FOUND", message: "FAQ not found" });
      }

      await tx.delete(faqs).where(eq(faqs.id, faq.id));
      await resetMailboxPromptUpdatedAt(tx);
    });
  }),
  accept: mailboxProcedure
    .input(
      z.object({
        id: z.number(),
        content: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const knowledge = await db.query.faqs.findFirst({
        where: and(eq(faqs.id, input.id)),
      });

      if (!knowledge) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Knowledge entry not found" });
      }

      await approveSuggestedEdit(knowledge, input.content);
    }),
  reject: mailboxProcedure
    .input(
      z.object({
        id: z.number(),
      }),
    )
    .mutation(async ({ input }) => {
      const knowledge = await db.query.faqs.findFirst({
        where: and(eq(faqs.id, input.id)),
      });

      if (!knowledge) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Knowledge entry not found" });
      }

      await rejectSuggestedEdit(knowledge);
    }),
  suggestFromHumanReply: mailboxProcedure
    .input(
      z.object({
        messageId: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const message = await db.query.conversationMessages.findFirst({
        where: and(
          eq(conversationMessages.id, input.messageId),
          inArray(conversationMessages.role, ["staff", "ai_assistant"]),
          isNull(conversationMessages.deletedAt),
        ),
      });

      if (!message) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Message not found" });
      }

      const messageContent = message.body || message.cleanedUpText || "";
      if (!messageContent.trim()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Message content is empty" });
      }

      return await generateKnowledgeBankSuggestion(ctx.mailbox, {
        type: "human_reply",
        messageContent,
      });
    }),
  promoteToSavedReply: mailboxProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const faq = await db.query.faqs.findFirst({
        where: eq(faqs.id, input.id),
      });

      if (!faq) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Knowledge entry not found" });
      }

      return await db
        .insert(savedReplies)
        .values({
          name: input.name,
          content: faq.content,
          unused_mailboxId: ctx.mailbox.id,
          createdByUserId: ctx.user.id,
        })
        .returning()
        .then(takeUniqueOrThrow);
    }),
} satisfies TRPCRouterRecord;
