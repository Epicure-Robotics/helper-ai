import { createHash, randomUUID } from "crypto";
import { fireworks } from "@ai-sdk/fireworks";
import { TRPCError } from "@trpc/server";
import { waitUntil } from "@vercel/functions";
import {
  appendClientMessage,
  convertToCoreMessages,
  createDataStreamResponse,
  DataStreamWriter,
  formatDataStreamPart,
  generateText,
  LanguageModelUsage,
  LanguageModelV1,
  streamText,
  type CoreMessage,
  type Message,
  type TextStreamPart,
  type Tool,
} from "ai";
import { count, eq, inArray } from "drizzle-orm";
import { remark } from "remark";
import remarkHtml from "remark-html";
import { z } from "zod";
import { ToolRequestBody } from "@helperai/client";
import { ReadPageToolConfig } from "@helperai/sdk";
import { db } from "@/db/client";
import { conversationMessages, conversations, files, MessageMetadata, ToolMetadata } from "@/db/schema";
import { CHAT_MODEL, DRAFT_MODEL, isWithinTokenLimit, MINI_MODEL } from "@/lib/ai/core";
import { customerInfoPrompt } from "@/lib/ai/customerInfoPrompt";
import { getInstantGreetingReply } from "@/lib/ai/instantGreeting";
import openai from "@/lib/ai/openai";
import { PromptInfo } from "@/lib/ai/promptInfo";
import {
  CHAT_SYSTEM_PROMPT,
  DRAFT_SYSTEM_PROMPT,
  getDraftPromptForCategory,
  GUIDE_INSTRUCTIONS,
} from "@/lib/ai/prompts";
import { buildTools, callServerSideTool } from "@/lib/ai/tools";
import { cacheFor } from "@/lib/cache";
import { Conversation, updateOriginalConversation } from "@/lib/data/conversation";
import {
  createAiDraft,
  createConversationMessage,
  findLatestUserMessageForConversation,
  getLastAiGeneratedDraft,
  getMessagesOnly,
} from "@/lib/data/conversationMessage";
import { createAndUploadFile, downloadFile, getFileUrl } from "@/lib/data/files";
import { type Mailbox } from "@/lib/data/mailbox";
import { getPlatformCustomer, PlatformCustomer, upsertPlatformCustomer } from "@/lib/data/platformCustomer";
import { fetchFastWidgetRetrievalData, fetchPromptRetrievalData } from "@/lib/data/retrieval";
import {
  EPICURE_MAILBOX_SLUG,
  epicurePromptExtension,
  epicureWidgetPromptExtension,
} from "@/lib/epicure/companyKnowledge";
import { CustomerInfo, fetchCustomerInfo } from "@/lib/metadataApiClient";
import { trackAIUsageEvent } from "../data/aiUsageEvents";
import { captureExceptionAndLog, captureExceptionAndThrowIfDevelopment } from "../shared/sentry";

export { getInstantGreetingReply } from "@/lib/ai/instantGreeting";

const SUMMARY_MAX_TOKENS = 7000;
const SUMMARY_PROMPT =
  "Summarize the following text while preserving all key information and context. Keep the summary under 8000 tokens.";
export const REASONING_MODEL = fireworks("accounts/fireworks/models/deepseek-r1");

const hashQuery = (query: string): string => createHash("md5").update(query).digest("hex");

function hideToolResults<TOOLS extends Record<string, Tool>>(): (options: {
  tools: TOOLS;
}) => TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>> {
  return () => {
    return new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      transform(chunk, controller) {
        if (chunk.type !== "tool-result") {
          controller.enqueue(chunk);
        }
      },
    });
  };
}

export const checkTokenCountAndSummarizeIfNeeded = async (text: string): Promise<string> => {
  if (isWithinTokenLimit(text, false)) {
    return text;
  }

  const { text: summary } = await generateText({
    model: openai(MINI_MODEL),
    system: SUMMARY_PROMPT,
    prompt: text,
    maxTokens: SUMMARY_MAX_TOKENS,
  });

  return summary;
};

const loadScreenshotAttachments = async (messages: (typeof conversationMessages.$inferSelect)[]) => {
  const attachments = await db.query.files.findMany({
    where: inArray(
      files.messageId,
      messages.filter((m) => (m.metadata as MessageMetadata)?.includesScreenshot).map((m) => m.id),
    ),
  });

  const attachmentsWithData = await Promise.all(
    attachments.map(async (a) => {
      try {
        const bytes = await downloadFile(a);
        const base64 = Buffer.from(bytes).toString("base64");
        const url = `data:${a.mimetype};base64,${base64}`;
        return { messageId: a.messageId, name: a.name, contentType: a.mimetype, url };
      } catch {
        // Fallback to signed URL if download fails
        const url = await getFileUrl(a);
        return { messageId: a.messageId, name: a.name, contentType: a.mimetype, url };
      }
    }),
  );

  return attachmentsWithData.filter((a): a is { messageId: number; name: string; contentType: string; url: string } =>
    Boolean(a.url),
  );
};

export const loadPreviousMessages = async (
  conversationId: number,
  latestMessageId?: number,
  { skipHistoryWhenEmpty = false }: { skipHistoryWhenEmpty?: boolean } = {},
): Promise<Message[]> => {
  if (skipHistoryWhenEmpty && latestMessageId) {
    const [countRow] = await db
      .select({ value: count() })
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conversationId));
    if (countRow && Number(countRow.value) <= 1) return [];
  }

  const dbMessages = await getMessagesOnly(conversationId);
  const attachments = await loadScreenshotAttachments(dbMessages);

  return dbMessages
    .filter((message) => message.body && message.id !== latestMessageId)
    .map((message) => {
      if (message.role === "tool") {
        const metadata = message.metadata as ToolMetadata;
        return {
          id: message.id.toString(),
          role: "assistant",
          content: "",
          toolInvocations: [
            {
              id: message.id.toString(),
              toolName: metadata?.tool?.slug ?? metadata?.tool?.name,
              result: metadata?.result,
              step: 0,
              state: "result",
              toolCallId: `tool_${message.id}`,
              args: metadata?.parameters,
            },
          ],
        };
      }

      return {
        id: message.id.toString(),
        role: message.role === "staff" || message.role === "ai_assistant" ? "assistant" : message.role,
        content: message.body || "",
        experimental_attachments: attachments.filter((a) => a.messageId === message.id),
      };
    });
};

export type ChatPromptProfile = "widget" | "full";

export const buildPromptMessages = async (
  mailbox: Mailbox,
  email: string | null,
  query: string,
  guideEnabled = false,
  customerInfoUrl?: string | null,
  isDraftMode = false,
  draftPromptOverride?: string,
  promptProfile: ChatPromptProfile = "full",
): Promise<{
  messages: CoreMessage[];
  sources: { url: string; pageTitle: string; markdown: string; similarity: number }[];
  promptInfo: Omit<PromptInfo, "availableTools">;
  customerInfo: CustomerInfo | null;
}> => {
  // The built prompt embeds the requester's email and any live customer info, so it can only be shared
  // between requests from the same identity. Skip the cache entirely when live customer data is injected.
  const promptCacheKey =
    promptProfile === "widget" && query.trim() && !(email && customerInfoUrl)
      ? `widget-system-prompt:v2:${mailbox.id}:${email ? hashQuery(email) : "anon"}:${hashQuery(query)}`
      : null;

  if (promptCacheKey) {
    const cached = await cacheFor<Awaited<ReturnType<typeof buildPromptMessages>>>(promptCacheKey).get();
    if (cached) return cached;
  }

  const retrievalPromise =
    promptProfile === "widget"
      ? fetchFastWidgetRetrievalData(mailbox.id, query)
      : fetchPromptRetrievalData(query, null, mailbox.id);

  const [{ knowledgeBank, knowledgeBankEntryIds, websitePagesPrompt, websitePages }, customerInfo] = await Promise.all([
    retrievalPromise,
    email && customerInfoUrl ? fetchCustomerInfo(email, customerInfoUrl, mailbox) : null,
  ]);

  const basePrompt = draftPromptOverride ?? (isDraftMode ? DRAFT_SYSTEM_PROMPT : CHAT_SYSTEM_PROMPT);
  const systemPrompt = [
    basePrompt.replaceAll("MAILBOX_NAME", mailbox.name).replaceAll("{{CURRENT_DATE}}", new Date().toISOString()),
    guideEnabled ? GUIDE_INSTRUCTIONS : null,
  ]
    .filter(Boolean)
    .join("\n");

  let prompt = systemPrompt;
  if (knowledgeBank) {
    prompt += `\n${knowledgeBank}`;
  }
  if (websitePagesPrompt) {
    prompt += `\n${websitePagesPrompt}`;
  }
  const userPrompt = customerInfoPrompt(email, customerInfo);
  prompt += userPrompt;

  if (mailbox.slug === EPICURE_MAILBOX_SLUG) {
    prompt += promptProfile === "widget" ? epicureWidgetPromptExtension() : epicurePromptExtension();
  }

  const result = {
    messages: [
      {
        role: "system",
        content: prompt,
      },
    ] as CoreMessage[],
    sources: websitePages,
    promptInfo: {
      systemPrompt,
      knowledgeBank,
      knowledgeBankEntryIds,
      websitePages: websitePages.map((page) => ({ url: page.url, title: page.pageTitle, similarity: page.similarity })),
      userPrompt,
    },
    customerInfo,
  };

  if (promptCacheKey) {
    try {
      await cacheFor(promptCacheKey).set(result, 60 * 60);
    } catch (error) {
      captureExceptionAndLog(error);
    }
  }

  return result;
};

const generateReasoning = async ({
  tools,
  systemMessages,
  coreMessages,
  reasoningModel,
  email,
  conversationId,
  traceId = null,
  evaluation = false,
  dataStream,
}: {
  tools: Record<string, Tool>;
  systemMessages: CoreMessage[];
  coreMessages: CoreMessage[];
  reasoningModel: LanguageModelV1;
  email: string | null;
  conversationId: number;
  traceId?: string | null;
  evaluation?: boolean;
  dataStream?: DataStreamWriter;
}): Promise<{ reasoning: string | null; usage: LanguageModelUsage | null }> => {
  const toolsAvailable = Object.keys(tools).map((tool) => {
    const toolObj = tools[tool] as Tool & { description: string };
    const params = toolObj?.parameters.shape;
    const paramsString = Object.keys(params)
      .map((key) => `${key}: ${params[key].description}`)
      .join(", ");
    return `${tool}: ${toolObj?.description ?? ""} Params: ${paramsString}`;
  });

  const hasScreenshot = coreMessages.some((m) => Array.isArray(m.content) && m.content.some((c) => c.type === "image"));
  coreMessages = coreMessages.map((message) =>
    message.role === "user"
      ? {
          ...message,
          content: Array.isArray(message.content) ? message.content.filter((c) => c.type === "text") : message.content,
        }
      : message,
  );

  const reasoningSystemMessages: CoreMessage[] = [
    {
      role: "system",
      content: `The following tools are available:\n${toolsAvailable.join("\n")}`,
    },
    {
      role: "system",
      content: `Think about how you can give the best answer to the user's question.`,
    },
  ];

  if (hasScreenshot) {
    reasoningSystemMessages.push({
      role: "system",
      content:
        "Don't worry if there's no screenshot, as sometimes it's not sent due to lack of multimodal functionality. Just move on.",
    });
  }

  try {
    const startTime = Date.now();
    const { textStream, usage } = streamText({
      model: reasoningModel,
      messages: [...systemMessages, ...reasoningSystemMessages, ...coreMessages],
      temperature: 0.6,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(evaluation ? 50000 : 30000),
      experimental_telemetry: {
        isEnabled: true,
        functionId: "reasoning",
        metadata: {
          sessionId: conversationId,
          userId: email ?? "anonymous",
          email: email ?? "anonymous",
        },
      },
    });

    dataStream?.writeData({
      event: "reasoningStarted",
      data: {
        id: traceId || randomUUID(),
      },
    });

    let text = "";
    let finished = false;
    for await (const textPart of textStream) {
      text += textPart;
      if (textPart === "</think>") {
        finished = true;
        dataStream?.writeData({
          event: "reasoningFinished",
          data: {
            id: traceId || randomUUID(),
          },
        });
      } else if (!textPart.includes("<think>") && !finished) {
        dataStream?.writeData({ reasoning: textPart });
      }
    }

    // Extract reasoning from <think> tags
    const thinkMatch = /<think>(.*?)<\/think>/s.exec(text);
    const reasoning = thinkMatch?.[1]?.trim() ?? null;

    dataStream?.writeMessageAnnotation({
      reasoning: { message: reasoning, reasoningTimeSeconds: Math.round((Date.now() - startTime) / 1000) },
    });

    return { reasoning, usage: await usage };
  } catch (error) {
    if (evaluation) {
      captureExceptionAndThrowIfDevelopment(error);
    } else {
      captureExceptionAndLog(error);
    }
    return { reasoning: null, usage: null };
  }
};

export const generateAIResponse = async ({
  messages,
  mailbox,
  conversationId,
  email,
  readPageTool = null,
  onFinish,
  dataStream,
  model = openai(CHAT_MODEL, { structuredOutputs: false }),
  addReasoning = false,
  reasoningModel = REASONING_MODEL,
  evaluation = false,
  guideEnabled = false,
  tools: clientProvidedTools,
  customerInfoUrl,
  maxTokens,
  customPrompt,
  isDraftMode = false,
  promptProfile = "full",
  maxSteps,
}: {
  messages: Message[];
  mailbox: Mailbox;
  conversationId: number;
  email: string | null;
  readPageTool?: ReadPageToolConfig | null;
  guideEnabled: boolean;
  onFinish?: (params: {
    text: string;
    finishReason: string;
    experimental_providerMetadata: any;
    steps: any;
    traceId: string;
    sources: { url: string; pageTitle: string }[];
    promptInfo: PromptInfo;
  }) => Promise<void>;
  model?: LanguageModelV1;
  addReasoning?: boolean;
  reasoningModel?: LanguageModelV1;
  seed?: number | undefined;
  evaluation?: boolean;
  dataStream?: DataStreamWriter;
  tools?: Record<string, ToolRequestBody>;
  customerInfoUrl?: string | null;
  maxTokens?: number;
  customPrompt?: string | null;
  isDraftMode?: boolean;
  promptProfile?: ChatPromptProfile;
  maxSteps?: number;
}) => {
  const lastMessage = messages.findLast((m: Message) => m.role === "user");
  const query = lastMessage?.content || "";
  const isWidgetProfile = promptProfile === "widget";

  const coreMessages = convertToCoreMessages(messages, { tools: {} });
  const [{ messages: systemMessages, sources, promptInfo, customerInfo }, tools] = await Promise.all([
    buildPromptMessages(
      mailbox,
      email,
      query,
      guideEnabled,
      customerInfoUrl,
      isDraftMode,
      undefined,
      promptProfile ?? "full",
    ),
    // The widget gets only the escalation tools: everything else it needs is already retrieved into the
    // system prompt, but without `request_human_support` a customer asking for a person is never actually
    // handed off (the ticket stays assigned to AI and closed, so nobody on the team sees it).
    isWidgetProfile
      ? buildTools({
          conversationId,
          email,
          includeHumanSupport: true,
          guideEnabled: false,
          includeMailboxTools: false,
          includePastConversationSearch: false,
          includeSavedReplyTool: false,
        })
      : buildTools({
          conversationId,
          email,
          includeHumanSupport: true,
          guideEnabled,
          includeMailboxTools: true,
          includePastConversationSearch: true,
          includeSavedReplyTool: true,
        }),
  ]);

  if (email && customerInfo) await upsertPlatformCustomer({ email, customerInfo });

  if (readPageTool) {
    tools[readPageTool.toolName] = {
      description: readPageTool.toolDescription,
      parameters: z.object({}),
    };
  }

  if (clientProvidedTools) {
    Object.entries(clientProvidedTools).forEach(([toolName, tool]) => {
      const toolDefinition: Tool = {
        description: tool.description ?? undefined,
        parameters: z.object(
          Object.fromEntries(
            Object.entries(tool.parameters).map(([key, value]) => {
              let type: z.ZodType = value.type === "string" ? z.string() : z.number();
              if (value.optional) {
                type = type.optional();
              }
              if (value.description) {
                type = type.describe(value.description);
              }
              return [key, type];
            }),
          ),
        ),
      };

      if (tool.serverRequestUrl) {
        toolDefinition.execute = (params: Record<string, any>) =>
          callServerSideTool({
            tool,
            toolName,
            conversationId,
            email,
            params,
            mailbox,
          });
      }

      tools[toolName] = toolDefinition;
    });
  }

  const traceId = randomUUID();
  const finalMessages = [...systemMessages, ...coreMessages];

  // Append custom prompt as additional system message if provided
  if (customPrompt) {
    finalMessages.push({
      role: "system",
      content: `Additional Instructions: ${customPrompt}`,
    });
  }

  let reasoning: string | null = null;
  if (addReasoning) {
    const { reasoning: reasoningText, usage } = await generateReasoning({
      tools,
      systemMessages,
      coreMessages,
      reasoningModel,
      email,
      conversationId,
      traceId,
      evaluation,
      dataStream,
    });

    if (!evaluation) {
      await trackAIUsageEvent({
        mailbox,
        model: "fireworks/deepseek-r1",
        queryType: "reasoning",
        usage: {
          promptTokens: usage?.promptTokens ?? 0,
          completionTokens: usage?.completionTokens ?? 0,
          totalTokens: usage?.totalTokens ?? 0,
          cachedTokens: 0,
        },
      });
    }

    if (reasoningText) {
      reasoning = reasoningText;
      finalMessages.push({
        role: "system",
        content: `Reasoning: ${reasoning}`,
      });
    }
  }

  return streamText({
    model,
    messages: finalMessages,
    // Widget needs a second step so it can answer in words after an escalation/email tool call
    // instead of finishing on a bare tool call with no text.
    maxSteps: maxSteps ?? (isWidgetProfile ? 2 : 4),
    tools,
    temperature: 0.1,
    seed: evaluation ? 100 : undefined,
    maxTokens: maxTokens ?? (isWidgetProfile ? 600 : undefined),
    experimental_transform: hideToolResults(),
    experimental_providerMetadata: {
      openai: {
        store: true,
        metadata: {
          conversationId: conversationId.toString(),
          email: email ?? "anonymous",
          usingReasoning: addReasoning.toString(),
        },
      },
    },
    experimental_telemetry: {
      isEnabled: true,
      functionId: "chat-completion",
      metadata: {
        sessionId: conversationId,
        userId: email ?? "anonymous",
        email: email ?? "anonymous",
        usingReasoning: addReasoning,
      },
    },
    async onFinish({ text, finishReason, experimental_providerMetadata, steps }) {
      // const metadata = experimental_providerMetadata?.openai as { cachedPromptTokens?: number };
      // const openAIUsage = {
      //   ...usage,
      //   cachedTokens: metadata?.cachedPromptTokens ?? 0,
      // };
      if (!evaluation) {
        // await trackAIUsageEvent({
        //   mailbox,
        //   model: CHAT_MODEL,
        //   queryType: "chat_completion",
        //   usage: openAIUsage,
        // });
      }
      if (onFinish) {
        await onFinish({
          text,
          finishReason,
          experimental_providerMetadata: { ...experimental_providerMetadata, reasoning },
          steps,
          traceId,
          sources: sources.map((source) => ({ url: source.url, pageTitle: source.pageTitle })),
          promptInfo: {
            ...promptInfo,
            availableTools: Object.keys(tools),
          },
        });
      }
    },
  });
};

export const createUserMessage = async (
  conversationId: number,
  email: string | null,
  query: string,
  attachmentData: { name: string; contentType: string; data: string }[],
) => {
  const hasAttachments = attachmentData?.length > 0;
  const message = await createConversationMessage({
    conversationId,
    emailFrom: email,
    body: query,
    cleanedUpText: query,
    role: "user",
    isPerfect: false,
    isPinned: false,
    isFlaggedAsBad: false,
    metadata: { hasAttachments },
  });

  if (hasAttachments) {
    await Promise.all(
      attachmentData.map((attachment) =>
        createAndUploadFile({
          data: Buffer.from(attachment.data, "base64"),
          fileName: attachment.name,
          mimetype: attachment.contentType,
          prefix: `attachments/${conversationId}`,
          messageId: message.id,
        }),
      ),
    );
  }

  return message;
};

export const createAssistantMessage = (
  conversationId: number,
  userMessageId: number,
  text: string,
  options?: {
    traceId?: string | null;
    reasoning?: string | null;
    sendEmail?: boolean;
    htmlBody?: string | null;
  },
) => {
  return createConversationMessage({
    conversationId,
    responseToId: userMessageId,
    status: options?.sendEmail ? "queueing" : "sent",
    body: text,
    cleanedUpText: text,
    htmlBody: options?.htmlBody ?? null,
    role: "ai_assistant",
    isPerfect: false,
    isPinned: false,
    isFlaggedAsBad: false,
    metadata: {
      trace_id: options?.traceId,
      reasoning: options?.reasoning,
    },
  });
};

export const respondWithAI = async ({
  conversation,
  mailbox,
  userEmail,
  sendEmail,
  message,
  messageId,
  readPageTool,
  guideEnabled,
  onResponse,
  isHelperUser = false,
  reasoningEnabled = true,
  tools,
  customerInfoUrl,
  customPrompt,
  promptProfile = "widget",
}: {
  conversation: Conversation;
  mailbox: Mailbox;
  userEmail: string | null;
  sendEmail: boolean;
  message: Message;
  messageId: number;
  readPageTool: ReadPageToolConfig | null;
  guideEnabled: boolean;
  promptProfile?: ChatPromptProfile;
  onResponse?: (result: {
    messages: Message[];
    platformCustomer: PlatformCustomer | null;
    isPromptConversation: boolean;
    isFirstMessage: boolean;
    humanSupportRequested: boolean;
    assistantMessage?: typeof conversationMessages.$inferSelect;
  }) => void | Promise<void>;
  isHelperUser?: boolean;
  reasoningEnabled?: boolean;
  tools?: Record<string, ToolRequestBody>;
  customerInfoUrl?: string | null;
  customPrompt?: string | null;
}) => {
  if (conversation.status === "spam") return createTextResponse("", Date.now().toString());

  const [previousMessages, platformCustomer] = await Promise.all([
    loadPreviousMessages(conversation.id, messageId, { skipHistoryWhenEmpty: true }),
    userEmail ? getPlatformCustomer(userEmail) : Promise.resolve(null),
  ]);
  const messages = appendClientMessage({
    messages: previousMessages,
    message,
  });

  const isPromptConversation = conversation.isPrompt;
  const isFirstMessage = messages.length === 1;

  // Only shortcut an opening "hi". Mid-conversation the same word is usually an answer to something we
  // just asked, and replying "How can I assist you today?" throws the thread away.
  const greetingReply = isFirstMessage ? getInstantGreetingReply(message.content) : null;
  if (greetingReply) {
    const responseId = `ai_${Date.now()}`;
    waitUntil(
      (async () => {
        await createAssistantMessage(conversation.id, messageId, greetingReply, {});
        await updateOriginalConversation(conversation.id, {
          set: { assignedToAI: true },
          message: "Automated reply sent",
        });
      })().catch(captureExceptionAndLog),
    );
    return createTextResponse(greetingReply, responseId);
  }

  const handleAssistantMessage = async (
    text: string,
    humanSupportRequested: boolean,
    traceId: string | null = null,
    reasoning: string | null = null,
  ) => {
    const assistantMessage = await createAssistantMessage(conversation.id, messageId, text, {
      traceId,
      reasoning,
      sendEmail,
    });
    if (!humanSupportRequested) {
      void updateOriginalConversation(conversation.id, {
        set: { assignedToAI: true },
        message: "Automated reply sent",
      }).catch(captureExceptionAndLog);
    }
    onResponse?.({
      messages,
      platformCustomer,
      isPromptConversation,
      isFirstMessage,
      humanSupportRequested,
      assistantMessage,
    });
    return assistantMessage;
  };

  if (!isHelperUser && !conversation.assignedToAI && (!isPromptConversation || !isFirstMessage)) {
    await updateOriginalConversation(conversation.id, {
      set: { status: "open" },
      message: "Escalated to human support",
    });
    if (
      messages.length === 1 ||
      (isPromptConversation && messages.filter((message) => message.role === "user").length === 2)
    ) {
      const message = "Our support team will respond to your message shortly. Thank you for your patience.";
      const assistantMessage = await handleAssistantMessage(message, true);
      return createTextResponse(message, assistantMessage.id.toString());
    }
    onResponse?.({
      messages,
      platformCustomer,
      isPromptConversation,
      isFirstMessage,
      humanSupportRequested: true,
    });
    return createTextResponse("", Date.now().toString());
  }

  const cacheKey = `chat:v2:mailbox-${mailbox.id}:initial-response:${hashQuery(message.content)}`;
  const widgetCacheKey = `chat:widget:v1:${mailbox.id}:${hashQuery(message.content ?? "")}`;
  // These caches are keyed by question only, so one customer's answer is replayed to everyone who asks
  // the same thing. Answers for an identified customer can be personalized, so only share anonymous ones.
  const canShareAnswerAcrossCustomers = !userEmail;
  if (isFirstMessage && canShareAnswerAcrossCustomers && promptProfile === "widget") {
    const cached: string | null = await cacheFor<string>(widgetCacheKey).get();
    if (cached != null) {
      const responseId = `ai_${Date.now()}`;
      waitUntil(handleAssistantMessage(cached, false).catch(captureExceptionAndLog));
      return createTextResponse(cached, responseId);
    }
  }
  if (isFirstMessage && canShareAnswerAcrossCustomers && isPromptConversation) {
    const cached: string | null = await cacheFor<string>(cacheKey).get();
    if (cached != null) {
      const responseId = `ai_${Date.now()}`;
      waitUntil(handleAssistantMessage(cached, false).catch(captureExceptionAndLog));
      return createTextResponse(cached, responseId);
    }
  }

  return createDataStreamResponse({
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
    execute: async (dataStream) => {
      const result = await generateAIResponse({
        messages,
        mailbox,
        conversationId: conversation.id,
        email: userEmail,
        readPageTool,
        guideEnabled,
        addReasoning: reasoningEnabled,
        tools,
        customerInfoUrl,
        customPrompt,
        promptProfile,
        maxSteps: promptProfile === "widget" ? 2 : 4,
        maxTokens: promptProfile === "widget" ? 600 : undefined,
        dataStream,
        async onFinish({ text, finishReason, steps, traceId, experimental_providerMetadata, sources, promptInfo }) {
          const hasSensitiveToolCall = steps.some((step: any) =>
            step.toolCalls.some((toolCall: any) => toolCall.toolName.includes("fetch_user_information")),
          );

          const hasRequestHumanSupportCall = steps.some((step: any) =>
            step.toolCalls.some((toolCall: any) => toolCall.toolName === "request_human_support"),
          );

          // "length" means the model hit maxTokens: the customer already saw the text stream in, so it has
          // to be persisted too, otherwise the reply vanishes on reload and feedback buttons have no message.
          if (finishReason !== "stop" && finishReason !== "tool-calls" && finishReason !== "length") return;

          const reasoning = experimental_providerMetadata?.reasoning;
          const responseText =
            hasRequestHumanSupportCall && !text.trim()
              ? "_Escalated to a human! You will be contacted soon here and by email._"
              : text;
          if (!responseText.trim()) return;
          const assistantMessage = await handleAssistantMessage(
            responseText,
            hasRequestHumanSupportCall,
            traceId,
            reasoning,
          );

          // Extract sources from markdown links like [(1)](url)
          const markdownSources = Array.from(text.matchAll(/\[\((\d+)\)\]\((https?:\/\/[^\s)]+)\)/g)).map((match) => {
            const [, id, url] = match;
            const existingSource = sources.find((source) => source.url === url);
            const title = existingSource ? existingSource.pageTitle : url;
            return { id, url, title };
          });

          const uniqueMarkdownSources = Array.from(new Map(markdownSources.map((s) => [s.id, s])).values());

          uniqueMarkdownSources.sort((a, b) => {
            if (!a.id || !b.id) return 0;
            return parseInt(a.id) - parseInt(b.id);
          });

          for (const source of uniqueMarkdownSources) {
            dataStream.writeSource({
              sourceType: "url",
              id: source.id ?? "",
              url: source.url ?? "",
              title: source.title ?? "",
            });
          }

          if (isHelperUser) {
            dataStream.writeMessageAnnotation({ promptInfo });
          }

          dataStream.writeMessageAnnotation({
            id: assistantMessage.id.toString(),
            traceId,
          });

          if (finishReason === "stop" && isFirstMessage && !hasSensitiveToolCall && !hasRequestHumanSupportCall) {
            if (promptProfile === "widget") {
              await cacheFor<string>(widgetCacheKey).set(responseText, 60 * 60 * 24);
            } else if (isPromptConversation) {
              await cacheFor<string>(cacheKey).set(responseText, 60 * 60 * 24);
            }
          }
        },
      });

      // consume the stream to ensure it runs to completion & triggers onFinish
      // even when the client response is aborted
      result.consumeStream();

      result.mergeIntoDataStream(dataStream);
    },
    onError(error) {
      captureExceptionAndLog(error);
      return "Error generating AI response";
    },
  });
};

const createTextResponse = (text: string, messageId: string) => {
  return createDataStreamResponse({
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
    execute: (dataStream) => {
      const textStream = new ReadableStream({
        start(controller) {
          controller.enqueue(formatDataStreamPart("text", text));
          controller.close();
        },
      });
      dataStream.merge(textStream);
      dataStream.writeMessageAnnotation({
        id: messageId,
      });
    },
  });
};

const convertMarkdownToHtml = async (markdown: string): Promise<string> => {
  const result = await remark().use(remarkHtml).process(markdown);
  return result.toString();
};

export const generateDraftResponse = async (
  conversationId: number,
  mailbox: Mailbox,
  _tools?: Record<string, ToolRequestBody>,
  customPrompt?: string,
) => {
  console.log(
    `[generateDraft] Starting draft generation for conversation ${conversationId}, mailbox: ${mailbox.name} (${mailbox.id})`,
  );

  const conversation = await db.query.conversations.findFirst({
    where: eq(conversations.id, conversationId),
    columns: { issueGroupId: true, createdAt: true },
    with: { issueGroup: { columns: { title: true } } },
  });
  const categoryTitle = conversation?.issueGroup?.title ?? null;
  console.log(`[generateDraft] Conversation category: ${categoryTitle || "none"}`);

  const lastUserMessage = await findLatestUserMessageForConversation(conversationId);

  if (!lastUserMessage) {
    console.log(`[generateDraft] No user message found for conversation ${conversationId}`);
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "There is no recent customer message in this conversation (only staff or internal messages, or inbound messages were removed). Add an inbound thread or reopen the sidebar after the customer sends a message.",
    });
  }

  console.log(
    `[generateDraft] Found last user message (ID: ${lastUserMessage.id}) from ${lastUserMessage.emailFrom || "unknown"}`,
  );

  const oldDraft = await getLastAiGeneratedDraft(conversationId);
  if (oldDraft) {
    console.log(`[generateDraft] Found existing draft (ID: ${oldDraft.id}) - will be discarded`);
  }

  const messages = await loadPreviousMessages(conversationId);
  console.log(`[generateDraft] Loaded ${messages.length} previous messages for conversation ${conversationId}`);

  if (customPrompt) {
    console.log(
      `[generateDraft] Custom prompt provided: "${customPrompt.substring(0, 100)}${customPrompt.length > 100 ? "..." : ""}"`,
    );
  }

  console.log(`[generateDraft] Generating AI response for conversation ${conversationId}...`);
  const startTime = Date.now();

  const categoryPrompt = getDraftPromptForCategory(categoryTitle);
  const staleLead =
    conversation?.createdAt && Date.now() - new Date(conversation.createdAt).getTime() > 7 * 24 * 60 * 60 * 1000;
  const staleNote = staleLead
    ? "\n\nNote: This thread is more than a week old. Open with a brief, warm acknowledgement of the delay before addressing their request."
    : "";

  const { messages: systemMessages, customerInfo } = await buildPromptMessages(
    mailbox,
    lastUserMessage.emailFrom,
    lastUserMessage.body || "",
    false,
    undefined,
    true,
    categoryPrompt + staleNote,
  );

  if (lastUserMessage.emailFrom && customerInfo)
    await upsertPlatformCustomer({ email: lastUserMessage.emailFrom, customerInfo });

  const coreMessages = convertToCoreMessages(messages, { tools: {} });
  const finalMessages = [...systemMessages, ...coreMessages];

  if (customPrompt) {
    finalMessages.push({
      role: "system",
      content: `Use these specifically instruction to draft response don't include Email signature block: ${customPrompt}`,
    });
  }

  const result = await generateText({
    model: openai(DRAFT_MODEL, { structuredOutputs: false }),
    messages: finalMessages,
    temperature: 0.4,
    maxTokens: 800,
  });

  const generationTime = Date.now() - startTime;
  console.log(`[generateDraft] AI response generated in ${generationTime}ms`);
  console.log(`[generateDraft] Raw text length: ${result.text.length} characters for conversation ${conversationId}`);

  const draftResponse = await convertMarkdownToHtml(result.text);
  console.log(
    `[generateDraft] Converted markdown to HTML (${draftResponse.length} characters) for conversation ${conversationId}`,
  );

  const newDraft = await db.transaction(async (tx) => {
    if (oldDraft) {
      await tx
        .update(conversationMessages)
        .set({ status: "discarded" })
        .where(eq(conversationMessages.id, oldDraft.id));
    }
    return await createAiDraft(conversationId, draftResponse, lastUserMessage.id, null, tx);
  });

  console.log(`[generateDraft] Successfully created new draft (ID: ${newDraft.id}) for conversation ${conversationId}`);
  return newDraft;
};
