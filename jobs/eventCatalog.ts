import { z } from "zod";
import { toolBodySchema } from "@helperai/client";
import { searchSchema } from "@/lib/data/conversation/searchSchema";

export const events = {
  "files/preview.generate": {
    data: z.object({
      fileId: z.number(),
    }),
    jobs: ["generateFilePreview"],
  },
  "conversations/embedding.create": {
    data: z.object({ conversationSlug: z.string() }),
    jobs: ["embeddingConversation"],
  },
  "conversations/message.created": {
    data: z.object({ messageId: z.number() }),
    jobs: [
      "indexConversationMessage",
      "generateConversationSummaryEmbeddings",
      "publishNewMessageEvent",
      "categorizeConversationToIssueGroup",
      "generateBackgroundDraft",
    ],
  },
  "conversations/issue-group.assigned": {
    data: z.object({
      conversationId: z.number(),
      messageId: z.number().optional(),
    }),
    jobs: ["autoAssignConversation", "checkConditionTemplates", "categorizeConversationToIssueSubgroup"],
  },
  "conversations/template-response.check": {
    data: z.object({
      conversationId: z.number(),
    }),
    jobs: ["handleTemplateResponse"],
  },
  "conversations/email.enqueued": {
    data: z.object({
      messageId: z.number(),
    }),
    jobs: ["postEmailToGmail"],
  },
  "conversations/auto-response.create": {
    data: z.object({
      messageId: z.number(),
      tools: z.record(z.string(), toolBodySchema).optional(),
      customerInfoUrl: z.string().nullish(),
    }),
    jobs: ["handleAutoResponse"],
  },

  "conversations/bulk-update": {
    data: z.object({
      userId: z.string(),
      conversationFilter: z.union([z.array(z.number()), searchSchema]),
      status: z.enum(["open", "waiting_on_customer", "closed", "spam", "check_back_later", "ignored"]).optional(),
      assignedToId: z.string().nullable().optional(),
      assignedToAI: z.boolean().optional(),
      message: z.string().optional(),
    }),
    jobs: ["bulkUpdateConversations"],
  },
  "conversations/bulk-forward": {
    data: z.object({
      userId: z.string(),
      conversationSlugs: z.array(z.string()),
      to: z.array(z.string().email()),
      note: z.string().optional(),
      includeFullThread: z.boolean(),
    }),
    jobs: ["bulkForwardConversations"],
  },
  "conversations/update-suggested-actions": {
    data: z.object({
      conversationId: z.number(),
    }),
    jobs: ["updateSuggestedActions"],
  },
  "gmail/webhook.received": {
    data: z.object({
      body: z.any(),
      headers: z.any(),
    }),
    jobs: ["handleGmailWebhookEvent"],
  },
  "faqs/embedding.create": {
    data: z.object({
      faqId: z.number(),
    }),
    jobs: ["embeddingFaq"],
  },
  "gmail/import-recent-threads": {
    data: z.object({
      gmailSupportEmailId: z.number(),
    }),
    jobs: ["importRecentGmailThreads"],
  },
  "gmail/import-gmail-threads": {
    data: z.object({
      gmailSupportEmailId: z.number(),
      fromInclusive: z.string().datetime(),
      toInclusive: z.string().datetime(),
      gmailQuerySuffix: z.string().optional(),
    }),
    jobs: ["importGmailThreads"],
  },
  "websites/crawl.create": {
    data: z.object({
      websiteId: z.number(),
      crawlId: z.number(),
    }),
    jobs: ["crawlWebsite"],
  },
  "knowledge/gap.detected": {
    data: z.object({
      query: z.string(),
    }),
    jobs: ["logKnowledgeGap"],
  },
  "conversations/auto-close.check": {
    data: z.object({}),
    jobs: ["closeInactiveConversations"],
  },
  "conversations/auto-close.process-mailbox": {
    data: z.object({}),
    jobs: ["closeInactiveConversationsForMailbox"],
  },
  "conversations/auto-follow-up.check": {
    data: z.object({}),
    jobs: ["autoFollowUpTickets"],
  },
  "conversations/human-support-requested": {
    data: z.object({
      conversationId: z.number(),
    }),
    jobs: ["autoAssignConversation", "publishRequestHumanSupport"],
  },
  "conversations/send-follower-notification": {
    data: z.object({
      conversationId: z.number(),
      eventType: z.enum(["new_message", "status_change", "assignment_change", "note_added"]),
      triggeredByUserId: z.string(),
      eventDetails: z.object({
        message: z.string().optional(),
        oldStatus: z.string().optional(),
        newStatus: z.string().optional(),
        oldAssignee: z.string().optional(),
        newAssignee: z.string().optional(),
        note: z.string().optional(),
      }),
    }),
    jobs: ["sendFollowerNotification"],
  },
  "notifications/create-web-notification": {
    data: z.object({
      conversationId: z.number(),
      type: z.enum(["new_message", "assignment_change", "internal_note"]),
      messageId: z.number().optional(),
      noteId: z.number().optional(),
      triggeredByUserId: z.string().optional(),
    }),
    jobs: ["createWebNotificationForAssignee"],
  },
  "conversations/send-assignment-email": {
    data: z.object({
      conversationId: z.number(),
      newAssigneeId: z.string(),
      triggeredByUserId: z.string(),
    }),
    jobs: ["sendAssignmentEmail"],
  },
  "gmail/archive-thread": {
    data: z.object({
      conversationId: z.number(),
    }),
    jobs: ["archiveGmailThreadJob"],
  },
  "conversations/closed-thread-email": {
    data: z.object({
      conversationId: z.number(),
      closedByUserId: z.string().nullable(),
    }),
    jobs: ["sendClosedThreadEmail"],
  },
};

export type EventName = keyof typeof events;
export type EventData<T extends EventName> = z.infer<(typeof events)[T]["data"]>;
