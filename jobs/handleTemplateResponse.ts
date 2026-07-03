import { convertToCoreMessages, type Message } from "ai";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { assertDefined } from "@/components/utils/assert";
import { db } from "@/db/client";
import { conversationMessages, conversations, issueGroups, platformCustomers, savedReplies } from "@/db/schema";
import { runAIObjectQuery } from "@/lib/ai";
import { buildPromptMessages, createAssistantMessage, loadPreviousMessages } from "@/lib/ai/chat";
import { cleanUpTextForAI } from "@/lib/ai/core";
import { updateConversation } from "@/lib/data/conversation";
import { ensureCleanedUpText, getTextWithConversationSubject } from "@/lib/data/conversationMessage";
import { getMailbox } from "@/lib/data/mailbox";
import { createMessageNotification } from "@/lib/data/messageNotifications";
import { extractTemplateVariables, replaceTemplateVariables } from "@/lib/utils/templateVariables";

class AITimeoutError extends Error {}

export const handleTemplateResponse = async ({
  conversationId,
  responseTimeoutMs = 60_000,
}: {
  conversationId: number;
  responseTimeoutMs?: number;
}) => {
  const conversation = await db.query.conversations
    .findFirst({
      where: eq(conversations.id, conversationId),
    })
    .then(assertDefined);

  if (conversation.status === "spam") return { message: "Skipped - conversation is spam" };

  // Check if this is the first message in the conversation
  const messageCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, conversationId))
    .then((res) => Number(res[0]?.count ?? 0));

  if (messageCount > 1) {
    return { message: "Skipped - not the first message" };
  }

  // Find latest user message to respond to
  const message = await db.query.conversationMessages.findFirst({
    where: and(eq(conversationMessages.conversationId, conversationId), eq(conversationMessages.role, "user")),
    orderBy: desc(conversationMessages.createdAt),
  });

  if (!message) return { message: "Skipped - no user message" };

  await ensureCleanedUpText(message);

  const mailbox = await getMailbox();
  if (!mailbox) return { message: "Skipped - mailbox not found" };

  if (!conversation.issueGroupId) {
    return { message: "Skipped - no issue group" };
  }

  const issueGroup = await db.query.issueGroups.findFirst({
    where: eq(issueGroups.id, conversation.issueGroupId),
  });

  if (!issueGroup?.defaultSavedReplyId) {
    return { message: "Skipped - no default saved reply" };
  }

  const savedReply = await db.query.savedReplies.findFirst({
    where: eq(savedReplies.id, issueGroup.defaultSavedReplyId),
  });

  if (!savedReply) {
    return { message: "Skipped - saved reply not found" };
  }

  // Template Logic
  const savedReplyTemplate = savedReply.content;
  const templateVariables = extractTemplateVariables(savedReply.content);

  if (templateVariables.length === 0) {
    return { message: "Skipped - no variables in template" };
  }

  const emailText = (await getTextWithConversationSubject(conversation, message)).trim();
  if (emailText.length === 0) return { message: "Skipped - email text is empty" };

  const messageText = cleanUpTextForAI(
    [conversation.subject ?? "", message.cleanedUpText ?? message.body ?? ""].join("\n\n"),
  );

  const generateResponse = async () => {
    // Build context-rich messages
    const { messages: systemMessages } = await buildPromptMessages(
      mailbox,
      message.emailFrom,
      messageText,
      false,
      mailbox.customerInfoUrl,
    );

    const previousMessages = await loadPreviousMessages(conversation.id, message.id);
    const allMessages = [
      ...previousMessages,
      { id: message.id.toString(), role: "user", content: messageText } as Message,
    ];
    const coreMessages = convertToCoreMessages(allMessages, { tools: {} });

    // Enhance instructions for structured output
    const customInstructions = issueGroup.customPrompt ? `\n\nCustom Instructions: ${issueGroup.customPrompt}` : "";
    const prompt = `You are answering an email using a template. Provide content for ALL template variables. Do not include any URLs or links in your responses.\n\nTemplate variables to fill: ${templateVariables.join(", ")}${customInstructions}`;

    if (systemMessages[0] && typeof systemMessages[0].content === "string") {
      systemMessages[0].content += `\n\n${prompt}`;
    }

    // Use Structured AI Output
    const values = await runAIObjectQuery({
      mailbox,
      queryType: "chat_completion",
      schema: z.object(
        Object.fromEntries(templateVariables.map((v) => [v, z.string().describe(`Content for variable ${v}`)])),
      ),
      messages: [...systemMessages, ...coreMessages],
    });

    // Validate variables
    const missingVars = templateVariables.filter(
      (v) => !values[v as keyof typeof values] || (values as any)[v].trim() === "",
    );

    if (missingVars.length > 0) {
      console.log(`[TemplateResponse] Skipping: Missing variables: ${missingVars.join(", ")}`);
      return { message: "Skipped - incomplete variables" };
    }

    const filledContent = replaceTemplateVariables(savedReplyTemplate, values as Record<string, string>);

    await db.transaction(async (tx) => {
      // Create the assistant message record with HTML template
      await createAssistantMessage(conversation.id, message.id, filledContent, {
        sendEmail: true,
        htmlBody: filledContent, // Pass as htmlBody so it's sent as HTML, not wrapped in AIReplyEmail
      });

      // Notify platform customer if needed
      if (message.emailFrom) {
        const platformCustomer = await tx.query.platformCustomers.findFirst({
          where: eq(platformCustomers.email, message.emailFrom),
        });

        if (platformCustomer && conversation.status !== "spam") {
          await createMessageNotification({
            messageId: message.id,
            conversationId: message.conversationId,
            platformCustomerId: platformCustomer.id,
            notificationText: `You have a new reply for ${conversation.subject ?? "(no subject)"}`,
            tx,
          });
        }
      }

      await updateConversation(
        message.conversationId,
        {
          set: { status: "open" },
          message: "Automated template reply sent (structured)",
        },
        tx,
      );
    });

    return { message: "Template response sent", conversationId };
  };

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new AITimeoutError()), responseTimeoutMs);
  });

  try {
    return await Promise.race([generateResponse(), timeoutPromise]);
  } catch (error) {
    if (error instanceof AITimeoutError) {
      await updateConversation(conversation.id, { set: { status: "open" }, message: "AI response timeout" });
      return { message: "Timeout" };
    }
    throw error;
  }
};
