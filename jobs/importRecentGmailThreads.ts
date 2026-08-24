import { eq, inArray } from "drizzle-orm";
import { gmail_v1 } from "googleapis";
import { htmlToText } from "html-to-text";
import { simpleParser } from "mailparser";
import { takeUniqueOrThrow } from "@/components/utils/arrays";
import { assertDefined } from "@/components/utils/assert";
import { db } from "@/db/client";
import { conversationMessages, conversations, gmailSupportEmails } from "@/db/schema";
import { getBasicProfileByEmail } from "@/lib/data/user";
import { parseEmailAddress } from "@/lib/emails";
import { getGmailService, getLast10GmailThreads, getMessageById, getThread, GmailClient } from "@/lib/gmail/client";
import { getPrimaryMailboxFromRelation } from "@/lib/tenant";
import {
  assertSuccessResponseOrThrow,
  createMessageAndProcessAttachments,
  extractAndUploadInlineImages,
  extractQuotations,
  getParsedEmailInfo,
} from "./handleGmailWebhookEvent";
import { assertDefinedOrRaiseNonRetriableError } from "./utils";

export const importRecentGmailThreads = async ({ gmailSupportEmailId }: { gmailSupportEmailId: number }) => {
  const threads = await getNewGmailThreads(gmailSupportEmailId);

  const results = await Promise.all(
    threads.map((thread) => processGmailThread(gmailSupportEmailId, assertDefinedOrRaiseNonRetriableError(thread.id))),
  );

  return results;
};

export const excludeExistingGmailThreads = async (gmailThreads: gmail_v1.Schema$Thread[]) => {
  const gmailThreadIds = gmailThreads.map((thread) => assertDefinedOrRaiseNonRetriableError(thread.id));
  const existingEmails = await db
    .selectDistinct({ gmailThreadId: conversationMessages.gmailThreadId })
    .from(conversationMessages)
    .where(inArray(conversationMessages.gmailThreadId, gmailThreadIds));
  const existingThreads = new Set(
    existingEmails.flatMap((email) => (email.gmailThreadId ? [email.gmailThreadId] : [])),
  );
  return gmailThreads.filter((thread) => !existingThreads.has(assertDefinedOrRaiseNonRetriableError(thread.id)));
};

export const getNewGmailThreads = async (gmailSupportEmailId: number) => {
  const gmailSupportEmail = await db.query.gmailSupportEmails
    .findFirst({
      where: eq(gmailSupportEmails.id, gmailSupportEmailId),
    })
    .then(assertDefinedOrRaiseNonRetriableError);
  const client = getGmailService(gmailSupportEmail);
  const response = await getLast10GmailThreads(client);
  assertSuccessResponseOrThrow(response);
  const threads = response.data.threads ?? [];
  return excludeExistingGmailThreads(threads);
};

export const processGmailThread = async (
  gmailSupportEmailId: number,
  gmailThreadId: string,
  conversationOverrides?: Partial<typeof conversations.$inferSelect>,
) => {
  const gmailSupportEmail = await db.query.gmailSupportEmails
    .findFirst({
      where: eq(gmailSupportEmails.id, gmailSupportEmailId),
      with: { mailboxes: true },
    })
    .then(assertDefinedOrRaiseNonRetriableError);
  const client = getGmailService(gmailSupportEmail);
  return processGmailThreadWithClient(client, gmailSupportEmail, gmailThreadId, conversationOverrides);
};

export const processGmailThreadWithClient = async (
  client: GmailClient,
  gmailSupportEmail: typeof gmailSupportEmails.$inferSelect & { mailboxes?: { id: number }[] },
  gmailThreadId: string,
  conversationOverrides?: Partial<typeof conversations.$inferSelect>,
) => {
  const response = await getThread(client, gmailThreadId);
  assertSuccessResponseOrThrow(response);
  const messages = response.data.messages ?? [];
  const threadRoot = assertDefinedOrRaiseNonRetriableError(messages[0]);
  const firstMessageHeaders = threadRoot.payload?.headers;
  const parsedEmailFrom = assertDefinedOrRaiseNonRetriableError(
    parseEmailAddress(firstMessageHeaders?.find((h) => h.name?.toLowerCase() === "from")?.value ?? ""),
  );
  const subject = firstMessageHeaders?.find((h) => h.name?.toLowerCase() === "subject")?.value ?? "";
  const primaryMailbox = getPrimaryMailboxFromRelation(gmailSupportEmail);
  const conversation = await db
    .insert(conversations)
    .values({
      unused_mailboxId: assertDefined(primaryMailbox, "mailbox linked to Gmail account").id,
      emailFrom: parsedEmailFrom.address,
      emailFromName: parsedEmailFrom.name,
      subject,
      status: "open",
      conversationProvider: "gmail",
      ...conversationOverrides,
    })
    .returning({ id: conversations.id, slug: conversations.slug })
    .then(takeUniqueOrThrow);

  let lastUserEmailCreatedAt: Date | null = null;
  const messageInfos = await Promise.all(
    messages.map((message) => {
      return getMessageById(client, assertDefinedOrRaiseNonRetriableError(message.id)).then(
        assertSuccessResponseOrThrow,
      );
    }),
  );
  for (let i = 0; i < messageInfos.length; i++) {
    const message = assertDefinedOrRaiseNonRetriableError(messageInfos[i]);
    const parsedEmail = await simpleParser(
      Buffer.from(assertDefinedOrRaiseNonRetriableError(message.data.raw), "base64url").toString("utf-8"),
    );
    const { parsedEmailFrom, parsedEmailBody } = getParsedEmailInfo(parsedEmail);
    const { processedHtml, fileSlugs } = await extractAndUploadInlineImages(parsedEmailBody);
    const isFirstMessageInImportedThread = i === 0;
    const cleanedUpText = htmlToText(isFirstMessageInImportedThread ? processedHtml : extractQuotations(processedHtml));
    // Process messages serially since we rely on the database ID for message ordering
    const staffUser = await getBasicProfileByEmail(parsedEmailFrom.address);

    const gmailMsgId = assertDefinedOrRaiseNonRetriableError(message.data.id);
    const isFirstInThread = isFirstMessageInImportedThread;

    await createMessageAndProcessAttachments(
      parsedEmail,
      parsedEmailFrom,
      processedHtml,
      cleanedUpText,
      fileSlugs,
      gmailMsgId,
      gmailThreadId,
      conversation,
      staffUser,
      isFirstInThread,
    );
    const isUserEmail = parsedEmailFrom.address.toLowerCase() !== gmailSupportEmail.email.toLowerCase();
    if (isUserEmail && parsedEmail.date && (!lastUserEmailCreatedAt || lastUserEmailCreatedAt < parsedEmail.date)) {
      lastUserEmailCreatedAt = parsedEmail.date;
    }
  }
  await db
    .update(conversations)
    .set({ lastUserEmailCreatedAt, lastReadAt: new Date() })
    .where(eq(conversations.id, conversation.id));

  return {
    gmailThreadId,
    lastUserEmailCreatedAt,
    conversationId: conversation.id,
    conversationSlug: conversation.slug,
  };
};
