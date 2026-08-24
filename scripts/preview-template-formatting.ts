#!/usr/bin/env tsx
/**
 * Script to preview template formatting with REAL AI-generated content
 * Usage: pnpm tsx scripts/preview-template-formatting.ts
 */
import fs from "fs";
import path from "path";
import { generateText } from "ai";
import openai from "@/lib/ai/openai";
import { replaceTemplateVariables } from "@/lib/utils/templateVariables";

// Sample customer question
const sampleCustomerQuestion = `We run a gym in Whitefield and keep hearing members ask for protein shakes between classes. Does Epicure place Zoe kiosks at fitness venues, and what would you need from us to explore a site?`;

async function generateAIResponse(question: string): Promise<string> {
  console.log("🤖 Generating real AI response using GPT-4o-mini...\n");

  const { text } = await generateText({
    model: openai("gpt-4o-mini"),
    messages: [
      {
        role: "system",
        content: `You are a helpful Epicure Robotics support contact. Epicure deploys and operates fresh-food kiosks (Smoothie Bar, Zoe) at offices, tech parks, and gyms — service-led, not selling machines as capital equipment by default.
Provide clear, professional replies with:
- Short paragraphs
- Numbered lists when steps help
- Use menu price bands from knowledge when relevant; no invented commitments or install guarantees`,
      },
      {
        role: "user",
        content: question,
      },
    ],
    temperature: 0.7,
  });

  console.log("✅ AI response generated!\n");

  return text;
}

async function main() {
  // Generate real AI response
  const aiResponse = await generateAIResponse(sampleCustomerQuestion);

  console.log("📝 Raw AI Response (plain text with newlines):");
  console.log("─".repeat(80));
  console.log(`${aiResponse.substring(0, 500)}...`);
  console.log("─".repeat(80));
  console.log();

  // Read the template
  const templatePath = path.join(process.cwd(), "template-auto.html");
  const template = fs.readFileSync(templatePath, "utf-8");

  // Create values object
  const values = {
    CUSTOMER_QUESTION: sampleCustomerQuestion,
    ASSISTANT_RESPONSE: aiResponse,
  };

  // Apply the formatting
  console.log("🔧 Applying template variable replacement with formatting...\n");
  const result = replaceTemplateVariables(template, values);

  // Write output to a file
  const outputPath = path.join(process.cwd(), "template-preview-output.html");
  fs.writeFileSync(outputPath, result, "utf-8");

  console.log("✅ Template preview generated!");
  console.log(`📄 Output file: ${outputPath}`);
  console.log("\n📝 Preview the formatted content:");
  console.log("   open template-preview-output.html");
  console.log("\n🔍 To see the before/after difference:");
  console.log("   - Before: Plain text with \\n newlines (shown above)");
  console.log("   - After: HTML with <p> and <br> tags (in output file)");

  // Show a snippet of the formatted response for quick verification
  console.log("\n📋 Formatted HTML snippet (first 600 chars):");
  console.log("─".repeat(80));
  const responseMatch = /<h3[^>]*>Our answer<\/h3>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>[\s\S]*?<\/p>/.exec(result);
  if (responseMatch?.[1]) {
    const snippet = responseMatch[1].substring(0, 600);
    console.log(`${snippet}...`);
  } else {
    console.log("(Could not extract snippet - check full file)");
  }
  console.log("─".repeat(80));

  console.log("\n✨ Done! Open the HTML file in your browser to see properly formatted content.");
}

main().catch((error) => {
  console.error("❌ Error:", error.message);
  process.exit(1);
});
