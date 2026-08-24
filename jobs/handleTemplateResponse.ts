import { convertToCoreMessages, type Message } from "ai";
import { and, desc, eq, isNull, ne, or, sql } from "drizzle-orm";
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
import { leadCategoryAutoReplyAllowed, parseWebsiteLeadSubject } from "@/lib/leads/leadCategory";
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

  /**
   * "Has anyone actually replied yet?" — an unsent AI draft is not a reply.
   *
   * This used to count every row, and generateBackgroundDraft runs on the same event and usually
   * wins the race, so the count was always 2 and this job silently skipped every time. That made
   * the per-category "Enable AI Auto-Response" toggle decorative: it was never reached.
   *
   * Inbound user messages carry status NULL, so the draft test has to be NULL-safe or it would
   * exclude the very message being answered.
   */
  const messageCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, conversationId),
        isNull(conversationMessages.deletedAt),
        or(isNull(conversationMessages.status), ne(conversationMessages.status, "draft")),
      ),
    )
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

  if (!issueGroup) {
    return { message: "Skipped - issue group not found" };
  }

  /**
   * "Enable AI Auto-Response" (Settings → Common Issues). Off means this category never sends an
   * automated mail — the lead sits with its assigned human instead.
   */
  if (issueGroup.autoResponseEnabled !== 1) {
    return { message: "Skipped - auto-response disabled for this issue group", issueGroupId: issueGroup.id };
  }

  /**
   * A category the lead stated on the form is certain; one the model inferred from a plain email
   * is not. Below the confidence bar the lead still gets filed and assigned — it just does not get
   * a templated reply written for a category we are not sure it belongs to.
   */
  if (conversation.inboundTriage && !leadCategoryAutoReplyAllowed(conversation.inboundTriage)) {
    return {
      message: "Skipped - lead category inferred with low confidence; leaving the reply to a human",
      conversationId,
      leadCategoryConfidence: conversation.inboundTriage.leadCategoryConfidence,
    };
  }

  if (!issueGroup.defaultSavedReplyId) {
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

  /**
   * We already know who the lead is, so never let the model guess the greeting — asked to fill
   * {name} it has produced "Hi New Lead," by lifting words out of the subject line.
   */
  const parsedSubjectName = parseWebsiteLeadSubject(conversation.subject)?.leadName ?? null;
  const knownName =
    parsedSubjectName?.trim() ||
    conversation.emailFromName?.trim() ||
    conversation.emailFrom?.split("@")[0]?.trim() ||
    null;

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

    // Fill what we already know ourselves; only the rest goes to the model.
    const preFilled: Record<string, string> = knownName ? { name: knownName } : {};
    const aiVariables = templateVariables.filter((v) => !(v in preFilled));

    // Enhance instructions for structured output
    const customInstructions = issueGroup.customPrompt ? `\n\nCustom Instructions: ${issueGroup.customPrompt}` : "";

    /**
     * When the team has written a standard answer for this category, it is the ONLY source of
     * facts — the model rewrites it to fit the email rather than answering from the knowledge
     * base. Empty falls back to the previous behaviour.
     */
    const standardAnswer = issueGroup.standardAnswer?.trim();
    const standardAnswerInstructions = standardAnswer
      ? `\n\nSTANDARD ANSWER — the team's current, authoritative position for this category:\n"""\n${standardAnswer}\n"""\nEvery factual statement you make must come from the standard answer above. Rephrase it to fit this specific email; do not add timelines, prices, availability, capabilities, or commitments that are not stated in it, and do not fall back to the knowledge base for facts. If the standard answer does not address what they asked, say the team will follow up with those details rather than inventing them.`
      : `\n\nNo standard answer has been set for this category, so you do not know the team's current position. Do NOT state timelines, prices, availability, capacity, or any commitment. Where the customer asked for specifics, say the team will confirm them directly.`;

    /**
     * Values are substituted mid-sentence, so they must read as fragments. Without this the model
     * returns whole clauses and the mail comes out as "Thanks for your interest in interested in
     * purchasing two machines for a cafe chain in Pune. with Epicure Robotics."
     */
    const prompt = `You are filling in the blanks of an email template. Each value is substituted directly into a sentence, so it must fit grammatically.

Rules for every value:
- Write a short fragment, not a sentence. No leading capital unless it is a proper noun, and no trailing full stop.
- Do not repeat words that already surround the blank in the template.
- Address the customer in the second person ("your cafe chain"), never the third.
- No URLs or links.

For example, in "Thanks for your interest in ___ with Epicure Robotics." a good value is "purchasing two machines for your cafe chain in Pune"; a bad one is "The customer is interested in purchasing two machines."

Template being filled:
"""
${savedReplyTemplate}
"""

Variables to fill: ${aiVariables.join(", ")}${standardAnswerInstructions}${customInstructions}`;

    if (systemMessages[0] && typeof systemMessages[0].content === "string") {
      systemMessages[0].content += `\n\n${prompt}`;
    }

    // Use Structured AI Output
    const aiValues = aiVariables.length
      ? await runAIObjectQuery({
          mailbox,
          queryType: "chat_completion",
          schema: z.object(
            Object.fromEntries(aiVariables.map((v) => [v, z.string().describe(`Content for variable ${v}`)])),
          ),
          messages: [...systemMessages, ...coreMessages],
        })
      : {};
    const values = { ...aiValues, ...preFilled } as Record<string, string>;

    // Validate variables
    const missingVars = templateVariables.filter((v) => !values[v] || (values as any)[v].trim() === "");

    if (missingVars.length > 0) {
      console.log(`[TemplateResponse] Skipping: Missing variables: ${missingVars.join(", ")}`);
      return { message: "Skipped - incomplete variables" };
    }

    const filledContent = replaceTemplateVariables(savedReplyTemplate, values);

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
