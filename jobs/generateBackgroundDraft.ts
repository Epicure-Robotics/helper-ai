import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { conversationMessages, conversations } from "@/db/schema";
import { generateDraftResponse } from "@/lib/ai/chat";
import { getLastAiGeneratedDraft, serializeResponseAiDraft } from "@/lib/data/conversationMessage";
import { getMailbox } from "@/lib/data/mailbox";
import { conversationChannelId } from "@/lib/realtime/channels";
import { publishToRealtime } from "@/lib/realtime/publish";

export const generateBackgroundDraft = async ({ messageId }: { messageId: number }) => {
  const message = await db.query.conversationMessages.findFirst({
    where: eq(conversationMessages.id, messageId),
  });

  if (!message) return "Skipped - message not found";
  if (message.role !== "user") return "Skipped - not a user message";

  const conversation = await db.query.conversations.findFirst({
    where: eq(conversations.id, message.conversationId),
  });

  if (!conversation) return "Skipped - conversation not found";
  if (conversation.status === "spam") return "Skipped - conversation is spam";

  const existingDraft = await getLastAiGeneratedDraft(conversation.id);
  if (existingDraft) {
    // Inbound user messages carry no status (only staff/AI messages are drafted, sent or discarded),
    // so filtering on one matched nothing and this skip never fired — every run redrafted the same reply.
    const newerUserMessage = await db.query.conversationMessages.findFirst({
      columns: { id: true },
      where: and(eq(conversationMessages.conversationId, conversation.id), eq(conversationMessages.role, "user")),
      orderBy: (msg, { desc }) => [desc(msg.createdAt)],
    });
    if (newerUserMessage && existingDraft.responseToId === newerUserMessage.id) {
      return "Skipped - draft already exists for latest user message";
    }
  }

  const staffRepliedAfter = await db.query.conversationMessages.findFirst({
    columns: { id: true },
    where: and(eq(conversationMessages.conversationId, conversation.id), eq(conversationMessages.role, "staff")),
    orderBy: (msg, { desc }) => [desc(msg.createdAt)],
  });

  if (staffRepliedAfter && staffRepliedAfter.id > message.id) {
    return "Skipped - staff already replied after this message";
  }

  const mailbox = await getMailbox();
  if (!mailbox) return "Skipped - mailbox not found";

  try {
    console.log(
      `[generateBackgroundDraft] Generating draft for conversation ${conversation.id} (message ${messageId})`,
    );
    const draft = await generateDraftResponse(conversation.id, mailbox);
    console.log(`[generateBackgroundDraft] Draft generated (ID: ${draft.id}) for conversation ${conversation.id}`);

    const serializedDraft = serializeResponseAiDraft(draft, mailbox);
    if (serializedDraft) {
      await publishToRealtime({
        channel: conversationChannelId(conversation.slug),
        event: "conversation.draft",
        data: serializedDraft,
      });
      console.log(`[generateBackgroundDraft] Published draft to realtime for conversation ${conversation.slug}`);
    }

    return `Draft generated (ID: ${draft.id})`;
  } catch (error) {
    console.error(`[generateBackgroundDraft] Failed to generate draft for conversation ${conversation.id}:`, error);
    return `Failed - ${error instanceof Error ? error.message : "unknown error"}`;
  }
};
