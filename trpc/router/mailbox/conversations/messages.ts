import { TRPCError, TRPCRouterRecord } from "@trpc/server";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import MailComposer from "nodemailer/lib/mail-composer";
import { z } from "zod";
import { assertDefined } from "@/components/utils/assert";
import { db } from "@/db/client";
import { conversationMessages } from "@/db/schema";
import { createConversationEmbedding } from "@/lib/ai/conversationEmbedding";
import { createReply, sanitizeBody } from "@/lib/data/conversationMessage";
import { getGmailSupportEmail } from "@/lib/data/gmailSupportEmail";
import { findSimilarConversations } from "@/lib/data/retrieval";
import { getGmailService, sendGmailEmail } from "@/lib/gmail/client";
import { conversationProcedure } from "./procedure";

export const messagesRouter = {
  previousReplies: conversationProcedure.query(async ({ ctx }) => {
    let conversation = ctx.conversation;
    if (!conversation.embeddingText) {
      conversation = await createConversationEmbedding(conversation.id);
    }

    const similarConversations = await findSimilarConversations(
      assertDefined(conversation.embedding),
      5,
      conversation.slug,
    );

    if (!similarConversations?.length) return [];

    const replies = await db.query.conversationMessages.findMany({
      where: and(
        eq(conversationMessages.role, "staff"),
        eq(conversationMessages.status, "sent"),
        isNull(conversationMessages.deletedAt),
        inArray(
          conversationMessages.conversationId,
          similarConversations.map((c) => c.id),
        ),
      ),
      orderBy: [sql`${conversationMessages.createdAt} desc`],
      limit: 10,
      with: {
        conversation: {
          columns: {
            subject: true,
          },
        },
      },
    });

    return Promise.all(
      replies.map(async (reply) => ({
        id: reply.id.toString(),
        content: await sanitizeBody(reply.body ?? ""),
        cleanedUpText: reply.cleanedUpText ?? "",
        timestamp: reply.createdAt.toISOString(),
        conversationSubject: reply.conversation.subject,
        similarity: similarConversations.find((c) => c.id === reply.conversationId)?.similarity ?? 0,
      })),
    );
  }),
  reply: conversationProcedure
    .input(
      z.object({
        message: z.string(),
        htmlBody: z.string().optional(),
        fileSlugs: z.array(z.string()),
        to: z.array(z.string().email()).optional(),
        cc: z.array(z.string().email()),
        bcc: z.array(z.string().email()),
        shouldAutoAssign: z.boolean().optional().default(true),
        shouldClose: z.boolean().optional().default(true),
        responseToId: z.number().nullable(),
      }),
    )
    .mutation(
      async ({
        input: { message, htmlBody, fileSlugs, to, cc, bcc, shouldAutoAssign, shouldClose, responseToId },
        ctx,
      }) => {
        const id = await createReply({
          conversationId: ctx.conversation.id,
          user: ctx.user,
          message,
          htmlBody,
          fileSlugs,
          to,
          cc,
          bcc,
          shouldAutoAssign,
          close: shouldClose,
          responseToId,
          role: "staff",
        });
        return { id };
      },
    ),
  flagAsBad: conversationProcedure
    .input(
      z.object({
        id: z.number(),
        reason: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, reason } = input;

      const updatedMessage = await db
        .update(conversationMessages)
        .set({
          isFlaggedAsBad: true,
          reason: reason || null,
        })
        .where(
          and(
            eq(conversationMessages.id, id),
            eq(conversationMessages.conversationId, ctx.conversation.id),
            eq(conversationMessages.role, "ai_assistant"),
            isNull(conversationMessages.deletedAt),
          ),
        )
        .returning({ id: conversationMessages.id });

      if (updatedMessage.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Message not found or not part of this conversation",
        });
      }
    }),
  forward: conversationProcedure
    .input(
      z.object({
        messageId: z.number().optional(),
        includeFullThread: z.boolean().default(false),
        to: z.array(z.string().email()).min(1),
        note: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { messageId, includeFullThread, to, note } = input;

      // Get Gmail support email credentials
      const gmailSupportEmail = await getGmailSupportEmail(ctx.mailbox);
      if (!gmailSupportEmail) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Gmail is not connected. Please connect a Gmail account to use email forwarding.",
        });
      }

      let forwardBody = "";

      if (includeFullThread) {
        // Forward entire conversation thread (excluding AI assistant messages)
        const messages = await db.query.conversationMessages.findMany({
          where: and(
            eq(conversationMessages.conversationId, ctx.conversation.id),
            isNull(conversationMessages.deletedAt),
            inArray(conversationMessages.role, ["user", "staff"]),
          ),
          orderBy: [sql`${conversationMessages.createdAt} asc`],
        });

        if (messages.length === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "No messages found in this conversation",
          });
        }

        // Add optional note
        if (note) {
          forwardBody += `<p>${note}</p><br/>`;
        }

        forwardBody += `<div style="margin: 20px 0; padding: 15px; border-left: 3px solid #ccc; background: #f5f5f5;">`;
        forwardBody += `<p style="margin: 0 0 10px; font-weight: bold;">---------- Forwarded conversation ----------</p>`;
        forwardBody += `<p style="margin: 5px 0;"><strong>Subject:</strong> ${ctx.conversation.subject || "(no subject)"}</p>`;
        forwardBody += `<p style="margin: 5px 0;"><strong>Messages:</strong> ${messages.length}</p>`;
        forwardBody += `</div>`;

        // Add all messages (only user and staff)
        messages.forEach((msg, index) => {
          const roleLabel = msg.role === "user" ? "Customer" : "Staff";
          forwardBody += `<div style="margin: 20px 0; padding: 15px; border-left: 2px solid ${msg.role === "user" ? "#3b82f6" : "#10b981"}; background: #fafafa;">`;
          forwardBody += `<p style="margin: 0 0 5px; font-size: 12px; color: #666;"><strong>${roleLabel}</strong> - ${msg.createdAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</p>`;
          if (msg.emailFrom) {
            forwardBody += `<p style="margin: 0 0 10px; font-size: 12px; color: #666;">From: ${msg.emailFrom}</p>`;
          }
          forwardBody += `<div>${msg.htmlBody || msg.body || "<p>(no content)</p>"}</div>`;
          forwardBody += `</div>`;
          if (index < messages.length - 1) {
            forwardBody += `<hr style="border: none; border-top: 1px solid #e5e5e5; margin: 10px 0;" />`;
          }
        });
      } else {
        // Forward single message
        if (!messageId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Message ID is required when not forwarding full thread",
          });
        }

        const message = await db.query.conversationMessages.findFirst({
          where: and(
            eq(conversationMessages.id, messageId),
            eq(conversationMessages.conversationId, ctx.conversation.id),
            isNull(conversationMessages.deletedAt),
          ),
          with: {
            files: true,
          },
        });

        if (!message) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Message not found or not part of this conversation",
          });
        }

        // Add optional note
        if (note) {
          forwardBody += `<p>${note}</p><br/>`;
        }

        forwardBody += `<div style="margin: 20px 0; padding: 15px; border-left: 3px solid #ccc; background: #f5f5f5;">`;
        forwardBody += `<p style="margin: 0 0 10px; font-weight: bold;">---------- Forwarded message ----------</p>`;
        forwardBody += `<p style="margin: 5px 0;"><strong>From:</strong> ${message.emailFrom || "Unknown"}</p>`;
        forwardBody += `<p style="margin: 5px 0;"><strong>Date:</strong> ${message.createdAt.toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" })}</p>`;
        forwardBody += `<p style="margin: 5px 0;"><strong>Subject:</strong> ${ctx.conversation.subject || "(no subject)"}</p>`;
        forwardBody += `</div>`;
        forwardBody += `<div style="margin-top: 20px;">`;
        forwardBody += message.htmlBody || message.body || "<p>(no content)</p>";
        forwardBody += `</div>`;
      }

      // Create raw email using MailComposer
      const mailComposer = new MailComposer({
        from: gmailSupportEmail.email,
        to,
        subject: `Fwd: ${ctx.conversation.subject || "(no subject)"}`,
        html: forwardBody,
        textEncoding: "base64",
      });

      const rawEmail = await new Promise<string>((resolve, reject) => {
        mailComposer.compile().build((err, message) => {
          if (err) reject(err);
          else resolve(Buffer.from(message).toString("base64url"));
        });
      });

      // Send via Gmail API
      const gmailService = getGmailService(gmailSupportEmail);

      try {
        await sendGmailEmail(gmailService, rawEmail, null);
        return { success: true };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to forward message via Gmail",
        });
      }
    }),
} satisfies TRPCRouterRecord;
