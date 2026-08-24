import { Factuality } from "autoevals";
import { evalite } from "evalite";
import { knowledgeBankPrompt } from "@/lib/ai/prompts";
import { buildMessagesWithMocks, epicureInboxEvalPrompt, runAIQuery } from "@/tests/evals/support/chat";

const REASONING_ENABLED = true;

// Langfuse trace: traces/6f591e9e-c1e8-4cfe-a83c-6325f8ed75a5?observation=e94d188bc13518ad
evalite("Reasoning - Identify valid payout method", {
  data: () => [
    {
      input: buildMessagesWithMocks({
        messages: [
          {
            id: "1",
            role: "user",
            content: "why i havent gotten paid on 24th jan?",
          },
          {
            id: "1",
            role: "assistant",
            content: `Tool response regarding payout of that user: { next_payout_date: "2025-01-31" balance_for_next_payout: "$62.40" payout_note: "Payout skipped because the bank account on file failed micro-deposit verification" }`,
          },
          {
            id: "2",
            role: "user",
            content: "why i havent gotten paid on 24th jan?",
          },
        ],
        promptRetrievalData: {
          knowledgeBank: knowledgeBankPrompt([
            ...epicureInboxEvalPrompt.map((content) => ({ content })),
            {
              content:
                "If the user has a generic payment decline, ask them to use another form of payment to complete their purchase or contact their bank for more information.",
            },
          ]),
        },
      }),
      expected: `Recommend completing bank verification in the billing portal (micro-deposits) or updating the saved payout account.`,
    },
  ],
  task: (input) => runAIQuery(input, REASONING_ENABLED),
  scorers: [Factuality],
});

evalite("Reasoning - Correct refund information", {
  data: () => [
    {
      input: buildMessagesWithMocks({
        messages: [
          {
            id: "1",
            role: "user",
            content: "My last order can be refunded?",
          },
        ],
        promptRetrievalData: {
          knowledgeBank: knowledgeBankPrompt([
            ...epicureInboxEvalPrompt.map((content) => ({ content })),
            {
              content:
                "RMA returns: unopened spare parts may be returned within 30 days of delivery with a written RMA from support. Opened electrical components are non-returnable unless defective under warranty.",
            },
            {
              content:
                "To request an RMA, reply with your order number and serial number. Do not tell the customer to email connect@epicurerobotics.com if they are already emailing this inbox.",
            },
          ]),
        },
        tools: {
          find_last_order: {
            description: "Find the last order of the user",
            parameters: {
              type: "object",
              properties: {
                email: { type: "string", description: "The email of the user" },
              },
              required: ["email"],
            },
            executeReturn: "Last order of the user is an Epicure calibration kit, 20 days ago, paid with a credit card",
          },
        },
      }),
      expected:
        "The response explains the RMA window for unopened parts, asks for order and serial details, and avoids sending the customer on a duplicate email loop to connect@epicurerobotics.com.",
    },
  ],
  task: (input) => runAIQuery(input, REASONING_ENABLED),
  scorers: [Factuality],
});

evalite("Reasoning - Fees and overdraft explanation", {
  data: () => [
    {
      input: buildMessagesWithMocks({
        mailboxName: "Chase",
        messages: [
          {
            id: "1",
            role: "user",
            content:
              "Can you help me understand why I was charged a $35 fee on my checking account? I've never seen this before.",
          },
          {
            id: "2",
            role: "assistant",
            content:
              "I see a $35 overdraft fee was charged on your account on Monday. This happens when there are insufficient funds to cover a transaction.",
          },
          {
            id: "3",
            role: "user",
            content:
              "But I always keep at least $1000 in my account, and I just checked my balance yesterday. This doesn't make sense.",
          },
        ],
        promptRetrievalData: {
          knowledgeBank: knowledgeBankPrompt([
            {
              content:
                "Common account fees are: Monthly maintenance, overdraft, wire transfer fees.\nAvoid overdraft fees by maintaining minimum balance and enrolling in overdraft protection.\nQ: What is overdraft protection? A: Links savings account to cover checking shortfalls.\nTo dispute charges, submit form within 60 days.\nNo fee at bank ATMs, $3 at others.",
            },
            {
              content: "Check pending transactions",
            },
            {
              content: "Review account history for unusual activity",
            },
            {
              content: "Verify all recent deposits cleared",
            },
            {
              content: "Check if any automatic payments processed",
            },
          ]),
        },
      }),
      expected:
        "The AI should: 1) Check for pending transactions that might have affected available balance, 2) Review timing of recent deposits and withdrawals, 3) Look for any automatic payments or holds, 4) Explain difference between available and posted balance, 5) Offer to waive fee if this is first occurrence and customer maintains good balance history. Should NOT assume overdraft without investigating other possibilities.",
    },
  ],
  task: (input) => runAIQuery(input, REASONING_ENABLED),
  scorers: [Factuality],
});

evalite("Reasoning - Tool calling", {
  data: () => [
    {
      input: buildMessagesWithMocks({
        messages: [
          {
            id: "1",
            role: "user",
            content: "I need help with one of my past purchases, I would like a refund",
          },
          {
            id: "2",
            role: "assistant",
            content: `Certainly! I'd be happy to help you with your past purchase. To assist you better, I'll need some more information about the specific purchase you're inquiring about. Could you please provide me with the following details:
            The name of the product you purchased
            The approximate date of the purchase
            The email address you used for the purchase
            Once I have this information, I'll be able to look up your purchase and provide you with more specific assistance. Is there anything particular about the purchase you need help with, such as accessing the product, getting a receipt, or something else?`,
          },
          {
            id: "3",
            role: "user",
            content: "I purchased an Epicure calibration kit on 20th December 2024",
          },
        ],
        promptRetrievalData: {
          knowledgeBank: knowledgeBankPrompt([
            ...epicureInboxEvalPrompt.map((content) => ({ content })),
            {
              content:
                "If the user has a generic payment decline, ask them to use another form of payment to complete their purchase or contact their bank for more information.",
            },
            {
              content:
                "Use the refund_order tool only if the order can be refunded. Returned by the search_orders tool.",
            },
          ]),
        },
        tools: {
          search_orders: {
            description: "Search for orders",
            parameters: {
              type: "object",
              properties: {
                email: { type: "string", description: "The email of the user" },
              },
              required: ["email"],
            },
            executeReturn: "Order found and can be refunded",
          },
          refund_order: {
            description: "Refund an order",
            parameters: {
              type: "object",
              properties: {
                order_id: { type: "string", description: "The ID of the order" },
              },
              required: ["order_id"],
            },
            executeReturn: "Order refunded",
          },
        },
        getPastConversationsPrompt: null,
      }),
      expected: "Don't ask for the email address",
    },
  ],
  task: (input) => runAIQuery(input, REASONING_ENABLED),
  scorers: [Factuality],
});
