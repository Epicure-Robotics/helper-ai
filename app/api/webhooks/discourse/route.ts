import { waitUntil } from "@vercel/functions";
import { generateObject } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";
import openai from "@/lib/ai/openai";

// Schema for sentiment analysis result
const HelpSeekingAnalysisSchema = z.object({
  isSeekingHelp: z.boolean().describe("Whether the user is seeking help or support"),
  confidence: z.number().min(0).max(1).describe("Confidence score between 0 and 1"),
  category: z
    .enum(["question", "problem", "bug_report", "feature_request", "discussion", "announcement", "other"])
    .describe("Category of the post"),
});

type HelpSeekingAnalysis = z.infer<typeof HelpSeekingAnalysisSchema>;

interface DiscourseUser {
  id: number;
  username: string;
  name: string;
  avatar_template: string;
}

interface DiscoursePost {
  id: number;
  name: string;
  username: string;
  avatar_template: string;
  created_at: string;
  cooked: string; // HTML content
  post_number: number;
  post_type: number;
  posts_count: number;
  updated_at: string;
  reply_count: number;
  reply_to_post_number: number | null;
  quote_count: number;
  incoming_link_count: number;
  reads: number;
  score: number;
  topic_id: number;
  topic_slug: string;
  topic_title: string;
  category_id: number;
  category_slug: string;
  display_username: string;
  primary_group_name: string | null;
  flair_name: string | null;
  flair_group_id: number | null;
  version: number;
  user_title: string | null;
  title_is_group: boolean;
  reply_to_user?: DiscourseUser;
  bookmarked: boolean;
  raw: string; // Plain text content
  moderator: boolean;
  admin: boolean;
  staff: boolean;
  user_id: number;
  hidden: boolean;
  trust_level: number;
  deleted_at: string | null;
  user_deleted: boolean;
  edit_reason: string | null;
  wiki: boolean;
  reviewable_id: number | null;
  reviewable_score_count: number;
  reviewable_score_pending_count: number;
  post_url: string;
  topic_posts_count: number;
  topic_filtered_posts_count: number;
  topic_archetype: string;
  user_cakedate: string;
  can_accept_answer: boolean;
  can_unaccept_answer: boolean;
  accepted_answer: boolean;
  topic_accepted_answer: boolean | null;
}

interface DiscourseWebhookPayload {
  post?: DiscoursePost;
  // Add other event types as needed
  [key: string]: any;
}

/**
 * Discourse webhook handler
 * Handles incoming webhook events from Discourse community platform
 */
export const POST = async (request: Request) => {
  try {
    const body = await request.text();
    const data: DiscourseWebhookPayload = JSON.parse(body);

    // Extract event information from Discourse headers
    const discourseEvent = request.headers.get("x-discourse-event") || "unknown";
    const discourseEventType = request.headers.get("x-discourse-event-type") || "unknown";
    const discourseInstance = request.headers.get("x-discourse-instance") || "unknown";

    // Log the complete webhook payload
    console.log("=== Discourse Webhook Received ===");
    console.log("Timestamp:", new Date().toISOString());
    console.log("Event:", discourseEvent);
    console.log("Event Type:", discourseEventType);
    console.log("Instance:", discourseInstance);
    console.log("Headers:", Object.fromEntries(request.headers.entries()));
    console.log("Payload:", JSON.stringify(data, null, 2));
    console.log("=================================");

    // Handle specific event types
    if (discourseEvent === "post_created") {
      // Run analysis in background without blocking the response
      waitUntil(handlePostCreated(data));
    } else {
      // Log other events for future implementation
      console.log(`[${discourseEvent}] Event received but not yet handled. Logging for future implementation.`);
    }

    // Return success response
    return NextResponse.json(
      {
        message: "Webhook received successfully",
        event: discourseEvent,
        eventType: discourseEventType,
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error processing Discourse webhook:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
};

/**
 * Handle post_created events from Discourse
 */
async function handlePostCreated(data: DiscourseWebhookPayload) {
  const post = data.post;

  if (!post) {
    console.error("No post data in post_created event");
    return;
  }

  console.log("=== Post Created Event ===");
  console.log("Post ID:", post.id);
  console.log("Topic:", post.topic_title);
  console.log("Topic URL:", post.post_url);
  console.log("Author:", post.username, `(${post.name})`);
  console.log("Category:", post.category_slug);
  console.log("Reply to:", post.reply_to_user?.username || "N/A");
  console.log("Content:", post.raw);
  console.log("Staff:", post.staff ? "Yes" : "No");
  console.log("Admin:", post.admin ? "Yes" : "No");
  console.log("========================");

  // Skip analysis for staff, admin, or moderator posts
  if (post.staff || post.admin || post.moderator) {
    console.log("Skipping sentiment analysis for staff/admin/moderator post");
    return;
  }

  // Analyze if the post is seeking help
  try {
    const analysis = await analyzeHelpSeeking(post);

    console.log("=== Sentiment Analysis ===");
    console.log("Is Seeking Help:", analysis.isSeekingHelp);
    console.log("Confidence:", `${(analysis.confidence * 100).toFixed(1)}%`);
    console.log("Category:", analysis.category);
    console.log("=========================");

    if (analysis.isSeekingHelp) {
      console.log("🚨 USER NEEDS HELP - This post should be escalated!");
    }
  } catch (error) {
    console.error("Error analyzing post sentiment:", error);
  }
}

/**
 * Analyze if a Discourse post is seeking help using AI
 */
async function analyzeHelpSeeking(post: DiscoursePost): Promise<HelpSeekingAnalysis> {
  const prompt = `Analyze this community forum post and determine if the user is seeking help or support.

Topic: ${post.topic_title}
Author: ${post.username}
Post Content: ${post.raw}
${post.reply_to_user ? `Replying to: ${post.reply_to_user.username}` : "This is a new topic or first post"}

Consider:
- Is the user asking a question?
- Are they reporting a problem or bug?
- Are they requesting assistance or guidance?
- Are they expressing confusion or frustration?

Do NOT classify as seeking help if:
- They are just sharing information or updates
- They are making an announcement
- They are having a casual discussion
- They are providing help to others`;

  const result = await generateObject({
    model: openai("gpt-5-nano-2025-08-07"),
    schema: HelpSeekingAnalysisSchema,
    prompt,
    temperature: 0.3,
  });

  return result.object;
}
