import { openai } from "@ai-sdk/openai";
import { type Message } from "ai";
import { traceAISDKModel } from "evalite/ai-sdk";
import { vi } from "vitest";
import { z } from "zod";
import { generateAIResponse, REASONING_MODEL } from "@/lib/ai/chat";
import { CHAT_MODEL } from "@/lib/ai/core";
import { buildTools } from "@/lib/ai/tools";
import { Mailbox } from "@/lib/data/mailbox";
import { fetchPromptRetrievalData, PromptRetrievalData as FetchPromptRetrievalData } from "@/lib/data/retrieval";

type PromptRetrievalData = {
  knowledgeBank?: string | null;
  metadata?: string | null;
};

const generateZodSchema = (parameters: {
  type: string;
  properties: Record<string, { type: string; description?: string }>;
  required?: string[];
}) => {
  const shape: Record<string, z.ZodType> = {};

  for (const [key, value] of Object.entries(parameters.properties)) {
    let schema: z.ZodType;
    switch (value.type) {
      case "string":
        schema = z.string();
        break;
      case "number":
        schema = z.number();
        break;
      case "boolean":
        schema = z.boolean();
        break;
      case "array":
        schema = z.array(z.any());
        break;
      default:
        schema = z.any();
    }

    shape[key] = parameters.required?.includes(key) ? schema : schema.optional();
  }

  return z.object(shape);
};

type EvalMockTool = {
  description: string;
  parameters: {
    type: string;
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
  executeReturn: string;
};

export const buildMessagesWithMocks = ({
  messages,
  promptRetrievalData,
  getPastConversationsPrompt = null,
  mailboxName = null,
  tools = {},
}: {
  messages: Message[];
  promptRetrievalData: PromptRetrievalData;
  getPastConversationsPrompt?: string | null;
  mailboxName?: string | null;
  tools?: Record<string, EvalMockTool>;
}) => {
  return JSON.stringify({
    messages,
    promptRetrievalData,
    getPastConversationsPrompt,
    mailboxName,
    tools,
  });
};

const parseMessagesWithMocks = (input: string) => {
  const { messages, mailboxName, tools, promptRetrievalData } = JSON.parse(input);
  const parsedTools: Record<string, EvalMockTool> = tools;

  vi.mocked(fetchPromptRetrievalData).mockResolvedValue(promptRetrievalData as FetchPromptRetrievalData);

  const toolsMock: Record<string, any> = {};
  Object.entries(parsedTools).forEach(([name, tool]) => {
    toolsMock[name] = {
      description: tool.description,
      parameters: generateZodSchema(tool.parameters),
      execute: () => Promise.resolve(tool.executeReturn),
    };
  });

  vi.mocked(buildTools).mockResolvedValue(toolsMock);

  const mailbox: Mailbox = {
    id: 1,
    name: mailboxName || "Epicure Assist",
    slug: mailboxName || "epicure",
    gmailSupportEmailId: null,
    promptUpdatedAt: new Date(),
    widgetHMACSecret: "test_secret",
    widgetDisplayMode: "off",
    widgetDisplayMinValue: null,
    widgetHost: null,
    customerInfoUrl: null,
    vipThreshold: null,
    vipExpectedResponseHours: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    githubInstallationId: null,
    githubRepoOwner: null,
    githubRepoName: null,
    autoCloseEnabled: false,
    autoCloseDaysOfInactivity: 14,
    closedThreadEmailEnabled: false,
    weekendAutoReplyEnabled: false,
    weekendAutoReplyMessage: null,
    holidayAutoReplyEnabled: false,
    holidayAutoReplyMessage: null,
    chatIntegrationUsed: false,
    preferences: {},
    isWhitelabel: false,
  };

  return { messages, mailbox };
};

export const runAIQuery = async (input: string, reasoning = false) => {
  const { messages, mailbox } = parseMessagesWithMocks(input);

  const result = await generateAIResponse({
    model: traceAISDKModel(openai(CHAT_MODEL)),
    reasoningModel: traceAISDKModel(REASONING_MODEL),
    messages,
    mailbox,
    conversationId: 1,
    email: "marco.costa@gmail.com",
    addReasoning: reasoning,
    evaluation: true,
    guideEnabled: false,
  });

  return result.textStream;
};

export const epicureInboxEvalPrompt = [
  "You are a concise customer support assistant for Epicure Robotics customers using Epicure Assist. Be accurate, professional, and use as few words as needed.",
  "Standard hardware warranty is 12 months from shipment unless your order or quote specifies a different term. Device registration: https://epicurerobotics.com/support",
  "When asked about US ACH or wire payout details, share Stripe’s bank account format guide: https://docs.stripe.com/payouts#adding-bank-account-information",
  "If a saved payout method fails verification, ask the customer to update banking in the billing portal and complete micro-deposit verification before the next payout run.",
  "Avoid telling customers to email connect@epicurerobotics.com when they are already in this support thread—that is the same channel.",
];
