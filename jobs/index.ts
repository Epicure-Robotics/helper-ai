import { archiveGmailThreadJob } from "./archiveGmailThread";
import { autoAssignConversation } from "./autoAssignConversation";
import { closeInactiveConversations, closeInactiveConversationsForMailbox } from "./autoCloseInactiveConversations";
import { autoFollowUpTickets } from "./autoFollowUpTickets";
import { bulkEmbeddingClosedConversations } from "./bulkEmbeddingClosedConversations";
import { bulkForwardConversations } from "./bulkForwardConversations";
import { bulkUpdateConversations } from "./bulkUpdateConversations";
import { categorizeConversationToIssueGroup } from "./categorizeConversationToIssueGroup";
import { categorizeConversationToIssueSubgroup } from "./categorizeConversationToIssueSubgroup";
import { checkConditionTemplates } from "./checkConditionTemplates";
import { checkStaleJobs } from "./checkStaleJobs";
import { cleanupDanglingFiles } from "./cleanupDanglingFiles";
import { cleanupIssueSubgroups } from "./cleanupIssueSubgroups";
import { cleanupStalePushSubscriptions } from "./cleanupStalePushSubscriptions";
import { crawlWebsite } from "./crawlWebsite";
import { createWebNotificationForAssignee } from "./createWebNotificationForAssignee";
import { embeddingConversation } from "./embeddingConversation";
import { embeddingFaq } from "./embeddingFaq";
import { generateBackgroundDraft } from "./generateBackgroundDraft";
import { generateConversationSummaryEmbeddings } from "./generateConversationSummaryEmbeddings";
import { generateFilePreview } from "./generateFilePreview";
import { handleAutoResponse } from "./handleAutoResponse";
import { handleGmailWebhookEvent } from "./handleGmailWebhookEvent";
import { handleTemplateResponse } from "./handleTemplateResponse";
import { importGmailThreads } from "./importGmailThreads";
import { importRecentGmailThreads } from "./importRecentGmailThreads";
import { indexConversationMessage } from "./indexConversation";
import { logKnowledgeGap } from "./logKnowledgeGap";
import { postEmailToGmail } from "./postEmailToGmail";
import { publishNewMessageEvent } from "./publishNewMessageEvent";
import { publishRequestHumanSupport } from "./publishRequestHumanSupport";
import { renewMailboxWatches } from "./renewMailboxWatches";
import { scheduledWebsiteCrawl } from "./scheduledWebsiteCrawl";
import { sendAssignmentEmail } from "./sendAssignmentEmail";
import { sendClosedThreadEmail } from "./sendClosedThreadEmail";
import { sendFollowerNotification } from "./sendFollowerNotification";
import { updateSuggestedActions } from "./updateSuggestedActions";

// Linked to events in trigger.ts
export const eventJobs = {
  generateFilePreview,
  embeddingConversation,
  indexConversationMessage,
  generateConversationSummaryEmbeddings,

  publishNewMessageEvent,
  postEmailToGmail,
  handleAutoResponse,
  bulkUpdateConversations,
  bulkForwardConversations,
  updateSuggestedActions,
  handleGmailWebhookEvent,
  embeddingFaq,
  generateBackgroundDraft,
  importRecentGmailThreads,
  importGmailThreads,
  crawlWebsite,
  logKnowledgeGap,
  closeInactiveConversations,
  closeInactiveConversationsForMailbox,
  autoFollowUpTickets,
  autoAssignConversation,
  categorizeConversationToIssueGroup,
  categorizeConversationToIssueSubgroup,
  publishRequestHumanSupport,
  sendFollowerNotification,
  sendAssignmentEmail,
  createWebNotificationForAssignee,
  archiveGmailThreadJob,
  sendClosedThreadEmail,
  checkConditionTemplates,
  handleTemplateResponse,
};

export const cronJobs = {
  "*/5 * * * *": { checkStaleJobs },
  "0 19 * * *": { bulkEmbeddingClosedConversations },
  "0 2 * * *": { autoFollowUpTickets },
  "0 * * * *": {
    cleanupDanglingFiles,
    closeInactiveConversations,
  },
  "0 3 * * 0": { cleanupIssueSubgroups, cleanupStalePushSubscriptions },
  "0 0 * * *": { renewMailboxWatches },
  "0 0 * * 0": { scheduledWebsiteCrawl },
};
