import { waitUntil } from "@vercel/functions";
import { eq } from "drizzle-orm";
import { createConversationBodySchema } from "@helperai/client";
import { corsOptions, corsResponse, withWidgetAuth } from "@/app/api/widget/utils";
import { db } from "@/db/client";
import { mailboxes } from "@/db/schema";
import { createAssistantMessage, createUserMessage } from "@/lib/ai/chat";
import { getInstantGreetingReply } from "@/lib/ai/instantGreeting";
import { CHAT_CONVERSATION_SUBJECT, createConversation, updateOriginalConversation } from "@/lib/data/conversation";
import { getPlatformCustomer } from "@/lib/data/platformCustomer";
import { checkWidgetChatRateLimit, widgetSessionKey } from "@/lib/rateLimit";
import { captureExceptionAndLog } from "@/lib/shared/sentry";

const VIP_INITIAL_STATUS = "open";
const DEFAULT_INITIAL_STATUS = "closed";

export const OPTIONS = () => corsOptions("POST");

export const POST = withWidgetAuth(async ({ request }, { session, mailbox }) => {
  const rateLimit = await checkWidgetChatRateLimit({
    request,
    sessionKey: widgetSessionKey(session),
    perSession: { limit: 10, windowSeconds: 300 },
    perIp: { limit: 30, windowSeconds: 300 },
  });
  if (!rateLimit.allowed) {
    return corsResponse(
      { error: "Too many requests. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": rateLimit.retryAfterSeconds.toString() } },
    );
  }

  const parsedParams = createConversationBodySchema.safeParse(await request.json());
  if (parsedParams.error) return corsResponse({ error: parsedParams.error.message }, { status: 400 });

  const isVisitor = session.isAnonymous;
  let status = DEFAULT_INITIAL_STATUS;

  if (isVisitor && session.email) {
    const platformCustomer = await getPlatformCustomer(session.email);
    if (platformCustomer?.isVip && !parsedParams.data.isPrompt) {
      status = VIP_INITIAL_STATUS;
    }
  }

  const newConversation = await createConversation({
    emailFrom: isVisitor || !session.email ? null : session.email,
    subject: parsedParams.data.subject || CHAT_CONVERSATION_SUBJECT,
    closedAt: status === DEFAULT_INITIAL_STATUS ? new Date() : undefined,
    status: status as "open" | "closed",
    source: "chat",
    isPrompt: parsedParams.data.isPrompt ?? false,
    isVisitor,
    /** Allow the widget / public chat to receive AI replies on first message (escalation path skips streaming when false). */
    assignedToAI: true,
    anonymousSessionId: session.isAnonymous ? session.anonymousSessionId : undefined,
  });

  if (!mailbox.chatIntegrationUsed) {
    waitUntil(db.update(mailboxes).set({ chatIntegrationUsed: true }).where(eq(mailboxes.id, mailbox.id)));
  }

  const initialMessage = parsedParams.data.initialMessage?.trim();
  const greetingReply = initialMessage ? getInstantGreetingReply(initialMessage) : null;
  if (initialMessage && greetingReply) {
    const assistantMessageId = `ai_${Date.now()}`;
    const userEmail = isVisitor ? null : session.email || null;
    waitUntil(
      (async () => {
        const userMessage = await createUserMessage(newConversation.id, userEmail, initialMessage, []);
        await createAssistantMessage(newConversation.id, userMessage.id, greetingReply, {});
        await updateOriginalConversation(newConversation.id, {
          set: { assignedToAI: true },
          message: "Automated reply sent",
        });
      })().catch(captureExceptionAndLog),
    );
    return corsResponse({
      conversationSlug: newConversation.slug,
      instantReply: { text: greetingReply, assistantMessageId },
    });
  }

  return corsResponse({ conversationSlug: newConversation.slug });
});
