import { and, asc, desc, eq, inArray, isNull, ne, notInArray, or, sql, SQL } from "drizzle-orm";
import { htmlToText } from "html-to-text";
import DOMPurify from "isomorphic-dompurify";
import { marked } from "marked";
import { Message } from "@helperai/client";
import { EMAIL_UNDO_COUNTDOWN_SECONDS } from "@/components/constants";
import { takeUniqueOrThrow } from "@/components/utils/arrays";
import { db, Transaction } from "@/db/client";
import {
  BasicUserProfile,
  conversationEvents,
  conversationMessages,
  DRAFT_STATUSES,
  faqs,
  files,
  guideSessions,
  mailboxes,
  MessageMetadata,
  notes,
  Tool,
} from "@/db/schema";
import { conversations } from "@/db/schema/conversations";
import { triggerEvent } from "@/jobs/trigger";
import { PromptInfo } from "@/lib/ai/promptInfo";
import { getStaffName } from "@/lib/data/user";
import { proxyExternalContent } from "@/lib/proxyExternalContent";
import { formatBytes } from "../files";
import { getConversationById, getNonSupportParticipants, updateConversation } from "./conversation";
import { finishFileUpload, formatAttachments, getFileUrl } from "./files";

const isAiDraftStale = (draft: typeof conversationMessages.$inferSelect, mailbox: typeof mailboxes.$inferSelect) => {
  return draft.status !== "draft" || draft.createdAt < mailbox.promptUpdatedAt;
};

export const serializeResponseAiDraft = (
  draft: typeof conversationMessages.$inferSelect,
  mailbox: typeof mailboxes.$inferSelect,
) => {
  if (!draft?.responseToId) {
    return null;
  }
  return {
    id: draft.id,
    responseToId: draft.responseToId,
    body: draft.body,
    isStale: isAiDraftStale(draft, mailbox),
  };
};

export const findOriginalAndMergedMessages = async <T>(
  conversationId: number,
  query: (condition: SQL) => Promise<T[]>,
) => {
  const [originalMessages, mergedMessages] = await Promise.all([
    query(eq(conversationMessages.conversationId, conversationId)),
    query(
      inArray(
        conversationMessages.conversationId,
        db.select({ id: conversations.id }).from(conversations).where(eq(conversations.mergedIntoId, conversationId)),
      ),
    ),
  ]);
  return [...originalMessages, ...mergedMessages];
};

export const getMessagesOnly = async (conversationId: number) => {
  const findMessages = (where: SQL) =>
    db.query.conversationMessages.findMany({
      where: and(
        where,
        isNull(conversationMessages.deletedAt),
        or(eq(conversationMessages.role, "user"), notInArray(conversationMessages.status, DRAFT_STATUSES)),
      ),
      orderBy: [asc(conversationMessages.createdAt)],
    });

  const merged = await findOriginalAndMergedMessages(conversationId, findMessages);
  return merged.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
};

/** Latest inbound customer message for draft/replies, including threads merged into this conversation. */
export const findLatestUserMessageForConversation = async (conversationId: number) => {
  const mergedChildIds = db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.mergedIntoId, conversationId));

  return db.query.conversationMessages.findFirst({
    where: and(
      or(
        eq(conversationMessages.conversationId, conversationId),
        inArray(conversationMessages.conversationId, mergedChildIds),
      ),
      eq(conversationMessages.role, "user"),
      isNull(conversationMessages.deletedAt),
    ),
    orderBy: desc(conversationMessages.createdAt),
    with: {
      conversation: {
        columns: {
          subject: true,
        },
      },
    },
  });
};

export const getMessages = async (conversationId: number) => {
  const findMessages = (where: SQL) =>
    db.query.conversationMessages.findMany({
      where: and(
        where,
        isNull(conversationMessages.deletedAt),
        or(eq(conversationMessages.role, "user"), notInArray(conversationMessages.status, DRAFT_STATUSES)),
      ),
      columns: {
        id: true,
        status: true,
        body: true,
        htmlBody: true,
        cleanedUpText: true,
        createdAt: true,
        emailTo: true,
        emailCc: true,
        emailBcc: true,
        userId: true,
        emailFrom: true,
        isPinned: true,
        role: true,
        conversationId: true,
        metadata: true,
        reactionType: true,
        reactionFeedback: true,
        reactionCreatedAt: true,
        isFlaggedAsBad: true,
        reason: true,
      },
      with: {
        files: {
          where: eq(files.isPublic, false),
        },
      },
    });

  const [messages, noteRecords, eventRecords, guideSessionRecords] = await Promise.all([
    findOriginalAndMergedMessages(conversationId, findMessages),
    db.query.notes.findMany({
      where: eq(notes.conversationId, conversationId),
      columns: {
        id: true,
        createdAt: true,
        body: true,
        role: true,
        userId: true,
      },
      with: {
        files: true,
      },
    }),
    db.query.conversationEvents.findMany({
      where: and(
        eq(conversationEvents.conversationId, conversationId),
        ne(conversationEvents.type, "reasoning_toggled"),
      ),
      columns: {
        id: true,
        type: true,
        createdAt: true,
        changes: true,
        byUserId: true,
        reason: true,
      },
    }),
    db.query.guideSessions.findMany({
      where: eq(guideSessions.conversationId, conversationId),
      columns: {
        id: true,
        uuid: true,
        messageId: true,
        createdAt: true,
        status: true,
        title: true,
        instructions: true,
        steps: true,
      },
    }),
  ]);

  const messageInfos = await Promise.all(messages.map((message) => serializeMessage(message, conversationId)));

  const noteInfos = await Promise.all(
    noteRecords.map(async (note) => ({
      ...note,
      type: "note" as const,
      userId: note.userId,
      files: (await serializeFiles(note.files)).flatMap((f) => (f.isInline ? [] : [f])),
    })),
  );

  const eventInfos = await Promise.all(
    eventRecords.map((event) => ({
      ...event,
      changes: {
        ...event.changes,
        assignedToId: event.changes?.assignedToId,
        assignedToAI: event.changes?.assignedToAI,
      },
      byUserId: event.byUserId,
      eventType: event.type,
      type: "event" as const,
    })),
  );

  const guideSessionInfos = await Promise.all(
    guideSessionRecords.map((guideSession) => ({
      ...guideSession,
      type: "guide_session" as const,
    })),
  );

  return [...messageInfos, ...noteInfos, ...eventInfos, ...guideSessionInfos]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((info) => ({ ...info, isNew: false }));
};

export const sanitizeBody = async (body: string | null) =>
  body ? await proxyExternalContent(DOMPurify.sanitize(body, { FORBID_TAGS: ["script", "style"] })) : null;

export const serializeMessage = async (
  message: Pick<
    typeof conversationMessages.$inferSelect,
    | "id"
    | "status"
    | "body"
    | "htmlBody"
    | "cleanedUpText"
    | "createdAt"
    | "emailTo"
    | "emailCc"
    | "emailBcc"
    | "userId"
    | "emailFrom"
    | "isPinned"
    | "role"
    | "conversationId"
    | "metadata"
    | "reactionType"
    | "reactionFeedback"
    | "reactionCreatedAt"
    | "isFlaggedAsBad"
    | "reason"
  > & {
    files?: (typeof files.$inferSelect)[];
  },
  conversationId: number,
) => {
  const messageFiles =
    message.files ??
    (await db.query.files.findMany({ where: and(eq(files.messageId, message.id), eq(files.isPublic, false)) }));

  const filesData = await serializeFiles(messageFiles);

  let sanitizedBody = await sanitizeBody(message.body);
  let sanitizedHtmlBody = message.htmlBody ? await sanitizeBody(message.htmlBody) : null;

  filesData.forEach((f) => {
    if (f.isInline && sanitizedBody) {
      sanitizedBody = sanitizedBody.replaceAll(`src="${f.key}"`, `src="${f.presignedUrl}"`);
    }
    if (f.isInline && sanitizedHtmlBody) {
      sanitizedHtmlBody = sanitizedHtmlBody.replaceAll(`src="${f.key}"`, `src="${f.presignedUrl}"`);
    }
  });

  return {
    type: "message" as const,
    id: message.id,
    status: message.status,
    body: sanitizedBody,
    htmlBody: sanitizedHtmlBody,
    bodyText:
      message.cleanedUpText?.trim() ||
      htmlToText(message.htmlBody ?? message.body ?? "", { wordwrap: false })
        .replace(/\r\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim() ||
      null,
    createdAt: message.createdAt,
    role: message.role,
    emailTo: message.emailTo,
    cc: message.emailCc || [],
    bcc: message.emailBcc || [],
    from: message.role === "staff" ? null : message.emailFrom, // Frontend resolves staff names using userId
    userId: message.userId,
    isMerged: message.conversationId !== conversationId,
    isPinned: message.isPinned ?? false,
    files: filesData.flatMap((f) => (f.isInline ? [] : [f])),
    metadata: message.metadata,
    reactionType: message.reactionType,
    reactionFeedback: message.reactionFeedback,
    reactionCreatedAt: message.reactionCreatedAt,
    isFlaggedAsBad: message.isFlaggedAsBad,
    reason: message.reason,
  };
};

export const serializeMessageForWidget = async (
  message: typeof conversationMessages.$inferSelect,
  attachments: (typeof files.$inferSelect)[],
): Promise<Message> => {
  const messageAttachments = await formatAttachments(attachments.filter((a) => a.messageId === message.id));
  const hasPublicAttachments =
    (message.metadata as MessageMetadata)?.hasAttachments || (message.metadata as MessageMetadata)?.includesScreenshot;
  return {
    id: message.id.toString(),
    role: message.role === "ai_assistant" || message.role === "tool" ? ("assistant" as const) : message.role,
    content: message.cleanedUpText || htmlToText(message.body ?? "", { wordwrap: false }),
    createdAt: message.createdAt.toISOString(),
    reactionType: message.reactionType,
    reactionFeedback: message.reactionFeedback,
    reactionCreatedAt: message.reactionCreatedAt?.toISOString() ?? null,
    staffName: await getStaffName(message.userId),
    publicAttachments: hasPublicAttachments ? messageAttachments : [],
    privateAttachments: hasPublicAttachments ? [] : messageAttachments,
  };
};

const serializeFiles = (inputFiles: (typeof files.$inferSelect)[]) =>
  Promise.all(
    inputFiles.map(async (file) => {
      if (file.isInline) {
        return { isInline: true as const, key: file.key, presignedUrl: await getFileUrl(file) };
      }

      const [presignedUrl, previewUrl] = await Promise.all([
        getFileUrl(file),
        file.previewKey ? getFileUrl(file, { preview: true }) : null,
      ]);

      return {
        ...file,
        isInline: false as const,
        sizeHuman: formatBytes(file.size, 2),
        presignedUrl,
        previewUrl,
      };
    }),
  );

type OptionalMessageAttributes = "updatedAt" | "createdAt";
type NewConversationMessage = Omit<typeof conversationMessages.$inferInsert, OptionalMessageAttributes> &
  Partial<Pick<typeof conversationMessages.$inferInsert, OptionalMessageAttributes>>;

export type ConversationMessage = typeof conversationMessages.$inferSelect;

export const createReply = async (
  {
    conversationId,
    message,
    htmlBody,
    user,
    to,
    cc,
    bcc = [],
    fileSlugs = [],
    close = true,
    role,
    responseToId = null,
    shouldAutoAssign = true,
  }: {
    conversationId: number;
    message: string | null;
    htmlBody?: string | null;
    user: BasicUserProfile | null;
    to?: string[] | null;
    cc?: string[] | null;
    bcc?: string[];
    fileSlugs?: string[];
    close?: boolean;
    role?: "user" | "staff" | null;
    responseToId?: number | null;
    shouldAutoAssign?: boolean;
  },
  tx0: Transaction | typeof db = db,
) => {
  const conversation = await getConversationById(conversationId);
  if (!conversation) throw new Error("Conversation not found");

  return tx0.transaction(async (tx) => {
    if (shouldAutoAssign && user && !conversation.assignedToId) {
      await updateConversation(
        conversationId,
        { set: { assignedToId: user.id, assignedToAI: false }, byUserId: null, message: "Auto-assigned" },
        tx,
      );
    }

    // Auto-disable AI response when staff replies
    if ((role === "staff" || role === null) && conversation.assignedToAI) {
      await updateConversation(
        conversationId,
        { set: { assignedToAI: false }, byUserId: user?.id ?? null, message: "AI response disabled after staff reply" },
        tx,
      );
    }

    // If htmlBody is provided, use it as the body so it displays properly in chat
    const bodyContent = htmlBody || message;

    const createdMessage = await createConversationMessage(
      {
        conversationId,
        body: bodyContent,
        htmlBody,
        cleanedUpText: bodyContent ? generateCleanedUpText(bodyContent) : undefined,
        userId: user?.id,
        emailTo: to?.[0] ?? conversation.emailFrom ?? null,
        emailCc: cc ?? (await getNonSupportParticipants(conversation)),
        emailBcc: bcc,
        role: role ?? "staff",
        responseToId,
        status: "queueing",
        isPerfect: false,
        isFlaggedAsBad: false,
      },
      tx,
    );

    await finishFileUpload({ fileSlugs, messageId: createdMessage.id }, tx);

    if (close && conversation.status !== "spam") {
      await updateConversation(
        conversationId,
        {
          set: { status: "closed" },
          byUserId: user?.id ?? null,
          message: user?.id ? "Reply sent" : "Automated reply sent",
        },
        tx,
      );
    }

    const lastAiDraft = await getLastAiGeneratedDraft(conversationId, tx);
    if (lastAiDraft?.body) {
      const isPerfectReply = Boolean(message && cleanupMessage(lastAiDraft.body) === cleanupMessage(message));

      if (isPerfectReply) {
        await tx
          .update(conversationMessages)
          .set({ isPerfect: true })
          .where(eq(conversationMessages.id, createdMessage.id));

        // Increment usage count for every KB entry that was included in this draft.
        const entryIds = (lastAiDraft.promptInfo as { details?: PromptInfo } | null)?.details?.knowledgeBankEntryIds;
        if (entryIds && entryIds.length > 0) {
          await tx
            .update(faqs)
            .set({ usageCount: sql`${faqs.usageCount} + 1`, lastUsedAt: new Date() })
            .where(inArray(faqs.id, entryIds));
        }
      }
    }
    await discardAiGeneratedDrafts(conversationId, tx);

    return createdMessage.id;
  });
};

export const createConversationMessage = async (
  conversationMessage: NewConversationMessage,
  tx: Transaction | typeof db = db,
): Promise<typeof conversationMessages.$inferSelect> => {
  const existingConversation = await tx.query.conversations.findFirst({
    columns: { status: true, assignedToId: true },
    where: eq(conversations.id, conversationMessage.conversationId),
  });
  const shouldReopen =
    conversationMessage.role === "user" &&
    ["waiting_on_customer", "check_back_later"].includes(existingConversation?.status ?? "");
  const messageValues = {
    isPinned: false,
    ...conversationMessage,
    body: conversationMessage.body,
    cleanedUpText: conversationMessage.cleanedUpText,
  };

  const message = await tx.insert(conversationMessages).values(messageValues).returning().then(takeUniqueOrThrow);

  await updateConversation(
    message.conversationId,
    {
      set: {
        lastMessageAt: new Date(),
        ...(message.role === "user" && {
          lastUserEmailCreatedAt: new Date(),
          lastReadAt: new Date(),
        }),
        ...(shouldReopen ? { status: "open" } : {}),
      },
      skipRealtimeEvents: !shouldReopen,
    },
    tx,
  );

  const eventsToSend = [];

  if (message.status !== "draft") {
    eventsToSend.push({
      name: "conversations/message.created" as const,
      data: {
        messageId: message.id,
        conversationId: message.conversationId,
      },
    });
    if (message.userId && (message.role === "user" || message.role === "staff")) {
      eventsToSend.push({
        name: "conversations/send-follower-notification" as const,
        data: {
          conversationId: message.conversationId,
          eventType: "new_message" as const,
          triggeredByUserId: message.userId,
          eventDetails: {
            message: message.cleanedUpText || undefined,
          },
        },
      });
    }

    // Send web notification to assigned team member for new customer messages
    if (message.role === "user" && existingConversation?.assignedToId) {
      eventsToSend.push({
        name: "notifications/create-web-notification" as const,
        data: {
          conversationId: message.conversationId,
          type: "new_message" as const,
          messageId: message.id,
          triggeredByUserId: message.userId || undefined,
        },
      });
    }
  }

  if (message.status === "queueing") {
    eventsToSend.push({
      name: "conversations/email.enqueued" as const,
      data: { messageId: message.id },
      sleepSeconds: EMAIL_UNDO_COUNTDOWN_SECONDS,
    });
  }

  if (eventsToSend.length > 0) {
    await Promise.all(
      eventsToSend.map((event) =>
        triggerEvent(event.name, event.data, event.sleepSeconds ? { sleepSeconds: event.sleepSeconds } : {}),
      ),
    );
  }

  return message;
};

export const createAiDraft = async (
  conversationId: number,
  body: string,
  responseToId: number,
  promptInfo: PromptInfo | null,
  tx: Transaction | typeof db = db,
): Promise<typeof conversationMessages.$inferSelect> => {
  if (!responseToId) {
    throw new Error("responseToId is required");
  }

  const sanitizedBody = DOMPurify.sanitize(marked.parse(body.trim().replace(/\n\n+/g, "\n\n"), { async: false }));

  return await createConversationMessage(
    {
      conversationId,
      body: sanitizedBody,
      role: "ai_assistant",
      status: "draft",
      responseToId,
      promptInfo: promptInfo ? { details: promptInfo } : null,
      cleanedUpText: body,
      isPerfect: false,
      isFlaggedAsBad: false,
    },
    tx,
  );
};

export const ensureCleanedUpText = async (
  message: typeof conversationMessages.$inferSelect,
  tx: Transaction | typeof db = db,
) => {
  if (message.cleanedUpText !== null) return message.cleanedUpText;
  const cleanedUpText = generateCleanedUpText(message.body ?? "");
  await tx.update(conversationMessages).set({ cleanedUpText }).where(eq(conversationMessages.id, message.id));
  return cleanedUpText;
};

export const getConversationMessageById = async (id: number): Promise<ConversationMessage | null> => {
  const result = await db.query.conversationMessages.findFirst({
    where: eq(conversationMessages.id, id),
  });
  return result ?? null;
};

export const getLastAiGeneratedDraft = async (
  conversationId: number,
  tx: Transaction | typeof db = db,
): Promise<typeof conversationMessages.$inferSelect | null> => {
  const result = await tx.query.conversationMessages.findFirst({
    where: and(
      eq(conversationMessages.conversationId, conversationId),
      eq(conversationMessages.role, "ai_assistant"),
      eq(conversationMessages.status, "draft"),
    ),
    orderBy: [desc(conversationMessages.createdAt)],
  });
  return result ?? null;
};

export const getStaffDraft = async (
  conversationId: number,
  tx: Transaction | typeof db = db,
): Promise<typeof conversationMessages.$inferSelect | null> => {
  const result = await tx.query.conversationMessages.findFirst({
    where: and(
      eq(conversationMessages.conversationId, conversationId),
      eq(conversationMessages.status, "staff_draft"),
      isNull(conversationMessages.deletedAt),
    ),
    orderBy: [desc(conversationMessages.draftEditedAt)],
  });
  return result ?? null;
};

export const saveStaffDraft = async (
  conversationId: number,
  userId: string,
  body: string,
  emailTo: string | null,
  emailCc: string[] | null,
  emailBcc: string[] | null,
  currentVersion: number | null,
  tx: Transaction | typeof db = db,
): Promise<typeof conversationMessages.$inferSelect> => {
  const existingDraft = await getStaffDraft(conversationId, tx);

  // Check for conflicts if version is provided
  if (existingDraft && currentVersion !== null && existingDraft.draftVersion > currentVersion) {
    throw new Error("DRAFT_CONFLICT");
  }

  const sanitizedBody = DOMPurify.sanitize(body);
  const cleanedUpText = htmlToText(sanitizedBody, { wordwrap: false });
  const newVersion = existingDraft ? existingDraft.draftVersion + 1 : 1;

  if (existingDraft) {
    // Update existing draft
    return await tx
      .update(conversationMessages)
      .set({
        body: sanitizedBody,
        cleanedUpText,
        emailTo: emailTo ?? existingDraft.emailTo,
        emailCc: emailCc ?? existingDraft.emailCc,
        emailBcc: emailBcc ?? existingDraft.emailBcc,
        draftAuthorId: userId,
        draftEditedAt: new Date(),
        draftVersion: newVersion,
      })
      .where(eq(conversationMessages.id, existingDraft.id))
      .returning()
      .then(takeUniqueOrThrow);
  }
  // Create new draft
  return await createConversationMessage(
    {
      conversationId,
      body: sanitizedBody,
      cleanedUpText,
      emailTo: emailTo ?? undefined,
      emailCc: emailCc ?? undefined,
      emailBcc: emailBcc ?? undefined,
      role: "staff",
      status: "staff_draft",
      userId,
      draftAuthorId: userId,
      draftEditedAt: new Date(),
      draftVersion: newVersion,
      isPerfect: false,
      isFlaggedAsBad: false,
    },
    tx,
  );
};

export const deleteStaffDraft = async (conversationId: number, tx: Transaction | typeof db = db): Promise<void> => {
  const existingDraft = await getStaffDraft(conversationId, tx);
  if (existingDraft) {
    await tx
      .update(conversationMessages)
      .set({ status: "discarded", deletedAt: new Date() })
      .where(eq(conversationMessages.id, existingDraft.id));
  }
};

export async function getTextWithConversationSubject(
  conversation: { subject: string | null },
  message: typeof conversationMessages.$inferSelect,
) {
  const cleanedUpText = await ensureCleanedUpText(message);
  const subject = conversation.subject;
  return `${subject ? `${subject}\n\n` : ""}${cleanedUpText}`;
}

export const createToolEvent = async ({
  conversationId,
  tool,
  data,
  error,
  parameters,
  userMessage,
  userId,
  tx = db,
}: {
  conversationId: number;
  tool: Tool | { name: string; description?: string | null; url?: string | null };
  data?: any;
  error?: any;
  parameters: Record<string, any>;
  userMessage: string;
  userId?: string;
  tx?: Transaction | typeof db;
}) => {
  const message = await tx.insert(conversationMessages).values({
    conversationId,
    role: "tool",
    body: userMessage,
    cleanedUpText: userMessage,
    metadata: {
      tool:
        "id" in tool
          ? {
              id: tool.id,
              slug: tool.slug,
              name: tool.name,
              description: tool.description,
              url: tool.url,
              requestMethod: tool.requestMethod,
            }
          : {
              name: tool.name,
              description: tool.description,
              url: tool.url,
            },
      result: data || error,
      success: !error,
      parameters,
    },
    isPerfect: false,
    isFlaggedAsBad: false,
    status: "sent",
    userId,
  });

  return message;
};

const discardAiGeneratedDrafts = async (conversationId: number, tx: Transaction | typeof db = db): Promise<void> => {
  await tx
    .update(conversationMessages)
    .set({ status: "discarded" })
    .where(
      and(
        eq(conversationMessages.conversationId, conversationId),
        eq(conversationMessages.role, "ai_assistant"),
        eq(conversationMessages.status, "draft"),
      ),
    );
};

const cleanupMessage = (message: string): string => {
  const strippedMessage = message.replace(/<[^>]*>/g, "");
  return strippedMessage.replace(/\s+/g, " ").trim();
};

export const generateCleanedUpText = (html: string) => {
  if (!html.trim()) return "";

  const paragraphs = htmlToText(html, {
    formatters: {
      image: (elem, _walk, builder) =>
        builder.addInline(`![${elem.attribs?.alt || "image"}](${elem.attribs?.src})`, { noWordTransform: true }),
    },
    wordwrap: false,
  })
    .split(/\s*\n\s*/)
    .filter((p) => p.trim().replace(/\s+/g, " "));
  return paragraphs.join("\n\n");
};
