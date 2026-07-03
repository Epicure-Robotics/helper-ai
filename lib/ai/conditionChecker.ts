import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { z } from "zod";
import { buildConditionTools } from "./conditionTools";

const CONDITION_EVAL_MODEL = "gpt-4o-mini";

const conditionResultSchema = z.object({
  conditionMet: z.boolean().describe("Whether the condition is met based on the gathered data"),
  reasoning: z.string().describe("Brief explanation of why the condition is met or not met"),
});

type ConditionResult = z.infer<typeof conditionResultSchema>;

/**
 * Evaluate a condition using AI with access to data tools.
 * The AI will use available tools to gather information and determine if the condition is met.
 */
export async function evaluateCondition({
  conditionText,
  email,
  conversationSubject,
  conversationText,
  verbose = false,
}: {
  conditionText: string;
  email: string | null;
  conversationSubject: string | null;
  conversationText?: string | null;
  verbose?: boolean;
}): Promise<ConditionResult> {
  if (!email) {
    return {
      conditionMet: false,
      reasoning: "No email provided, cannot evaluate condition without customer identifier",
    };
  }

  const tools = buildConditionTools(email);

  if (verbose) {
    console.log("🔧 Available tools:", Object.keys(tools).join(", "));
  }

  const systemPrompt = `You are a condition evaluator. Your job is to determine if a specific condition is met based on customer data.

IMPORTANT:
1. Use the tools to gather the necessary information
2. After gathering data, determine if the condition is TRUE or FALSE
3. Respond with a JSON object: {"conditionMet": boolean, "reasoning": "brief explanation"}

The customer email is: ${email}
${conversationSubject ? `The conversation subject is: ${conversationSubject}` : ""}
${conversationText ? `The customer message is: ${conversationText}` : ""}`;

  try {
    const result = await generateText({
      model: openai(CONDITION_EVAL_MODEL),
      system: systemPrompt,
      prompt: `Evaluate this condition: "${conditionText}"

Use the available tools to gather customer data, then respond with:
{"conditionMet": true/false, "reasoning": "brief explanation of why the condition is met or not met"}`,
      tools,
      maxSteps: 3,
      temperature: 0.1,
    });

    // Log tool calls and results if verbose
    if (verbose && result.steps) {
      console.log("\n📋 Tool Calls:");
      for (const step of result.steps) {
        if (step.toolCalls && step.toolCalls.length > 0) {
          for (const toolCall of step.toolCalls) {
            console.log(`   🔧 ${toolCall.toolName}(${JSON.stringify(toolCall.args)})`);
          }
        }
        if (step.toolResults && step.toolResults.length > 0) {
          for (const toolResult of step.toolResults) {
            console.log(`   📦 Result: ${JSON.stringify((toolResult as { result: unknown }).result, null, 2)}`);
          }
        }
      }
      console.log("");
    }

    // Parse the response
    try {
      const jsonMatch = /\{[\s\S]*"conditionMet"[\s\S]*\}/.exec(result.text);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return conditionResultSchema.parse(parsed);
      }

      // If no JSON found, try to infer from text
      const textLower = result.text.toLowerCase();
      const conditionMet =
        textLower.includes("condition is met") ||
        textLower.includes("conditionmet: true") ||
        textLower.includes('"conditionmet":true') ||
        textLower.includes('"conditionmet": true');

      return {
        conditionMet,
        reasoning: result.text.slice(0, 200),
      };
    } catch (parseError) {
      console.error("[conditionChecker] Failed to parse AI response:", parseError);
      return {
        conditionMet: false,
        reasoning: `Failed to parse condition result: ${result.text.slice(0, 100)}`,
      };
    }
  } catch (error) {
    console.error("[conditionChecker] Error evaluating condition:", error);
    return {
      conditionMet: false,
      reasoning: `Error evaluating condition: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Evaluate multiple conditions and return the first one that is met.
 * Returns null if no conditions are met.
 */
export async function findFirstMatchingCondition(
  conditions: {
    id: number;
    condition: string;
    savedReplyId: number;
  }[],
  email: string | null,
  conversationSubject: string | null,
): Promise<{
  matchedCondition: (typeof conditions)[number];
  reasoning: string;
} | null> {
  for (const conditionItem of conditions) {
    const result = await evaluateCondition({
      conditionText: conditionItem.condition,
      email,
      conversationSubject,
    });

    if (result.conditionMet) {
      return {
        matchedCondition: conditionItem,
        reasoning: result.reasoning,
      };
    }
  }

  return null;
}
