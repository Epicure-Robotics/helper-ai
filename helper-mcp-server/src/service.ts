import { and, count, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { htmlToText } from "html-to-text";
import { db } from "@/db/client";
import { conversationMessages, conversations, mailboxes, type FullUserProfile } from "@/db/schema";
import { serializeConversationWithMessages, updateConversation } from "@/lib/data/conversation";
import { searchConversations } from "@/lib/data/conversation/search";
import {
  createConversationMessage,
  generateCleanedUpText,
  getLastAiGeneratedDraft,
  serializeResponseAiDraft,
} from "@/lib/data/conversationMessage";
import { addNote } from "@/lib/data/note";
import { getFullProfileByEmail, getFullProfileById, getUsersWithMailboxAccess } from "@/lib/data/user";
import { helperMcpEnv } from "./env.js";

export const HELPER_TICKET_STATUSES = [
  "open",
  "waiting_on_customer",
  "closed",
  "spam",
  "check_back_later",
  "ignored",
] as const;

export const HELPER_TICKET_LIST_VIEWS = [
  "active",
  "mine",
  "open_unread",
  "unassigned_open",
  "awaiting_customer",
] as const;

export const HELPER_TICKET_LIST_SORTS = [
  "newest",
  "oldest",
  "highest_value",
  "latest",
  "created_desc",
  "created_asc",
  "updated_desc",
  "updated_asc",
] as const;

export type HelperTicketStatus = (typeof HELPER_TICKET_STATUSES)[number];
export type HelperTicketListView = (typeof HELPER_TICKET_LIST_VIEWS)[number];
export type HelperTicketListSort = (typeof HELPER_TICKET_LIST_SORTS)[number];
export type HelperResponseFormat = "markdown" | "json";
type HelperLegacyTicketCategory = "conversations" | "assigned" | "mine";
type HelperSearchConversationSort = Exclude<HelperTicketListSort, "latest">;

const HELPER_ACTIVE_TICKET_STATUSES: HelperTicketStatus[] = ["open", "waiting_on_customer", "check_back_later"];
const HELPER_HIGHEST_VALUE_SORTABLE_STATUSES = new Set<HelperTicketStatus>([
  "open",
  "waiting_on_customer",
  "check_back_later",
]);

export type ActingUserSelectors = {
  userId?: string;
  userEmail?: string;
};

export type HelperUserSummary = {
  id: string;
  email: string | null;
  display_name: string;
  permissions: string;
  access_role: "afk" | "active";
  access_keywords: string[];
};

export type HelperMailboxSummary = {
  id: number;
  name: string;
  slug: string;
};

export type HelperCurrentUserResult = {
  acting_as: HelperUserSummary;
  mailbox: HelperMailboxSummary;
};

export type HelperTeamMember = {
  id: string;
  email: string | null;
  display_name: string;
  role: "afk" | "active";
  keywords: string[];
  permissions: string;
  open_ticket_count: number;
  email_on_assignment: boolean;
};

export type HelperTeamMembersResult = {
  acting_as: HelperUserSummary;
  is_admin: boolean;
  members: HelperTeamMember[];
};

export type HelperTicketCustomer = {
  email: string | null;
  name: string | null;
  value: string | number | null;
  is_vip: boolean | null;
  links: Record<string, string> | null;
  metadata: Record<string, unknown> | null;
};

export type HelperTicketFile = {
  id: number;
  name: string;
  mimetype: string;
  size_human: string | null;
  url: string | null;
  preview_url: string | null;
};

export type HelperTimelineEntry = {
  id: number;
  type: "message" | "note" | "event" | "guide_session";
  created_at: string;
  author: HelperTeamMember | null;
  role: string | null;
  status: string | null;
  body: string | null;
  html_body: string | null;
  body_text: string | null;
  from: string | null;
  to: string | null;
  cc: string[];
  bcc: string[];
  files: HelperTicketFile[];
  metadata: Record<string, unknown> | null;
  reaction_type: string | null;
  reaction_feedback: string | null;
  event_type: string | null;
  changes: Record<string, unknown> | null;
  reason: string | null;
  title: string | null;
  guide_status: string | null;
  instructions: string | null;
};

export type HelperTicketSummary = {
  id: number;
  slug: string;
  status: HelperTicketStatus;
  subject: string;
  customer: HelperTicketCustomer;
  conversation_provider: string | null;
  source: string | null;
  assigned_to: HelperTeamMember | null;
  assigned_to_ai: boolean;
  issue_group_id: number | null;
  issue_subgroup_id: number | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  last_customer_message_at: string | null;
  last_message_at: string | null;
  recent_message_text: string | null;
  matched_message_text: string | null;
  unread_message_count: number | null;
};

export type HelperTicketDetail = HelperTicketSummary & {
  cc_recipients: string[];
  ai_draft: {
    id: number;
    body: string | null;
    response_to_id: number;
    is_stale: boolean;
  } | null;
  timeline: HelperTimelineEntry[];
  total_timeline_entries: number;
  timeline_truncated: boolean;
};

export type HelperListTicketsInput = {
  limit: number;
  cursor?: string | null;
  category?: HelperLegacyTicketCategory;
  view?: HelperTicketListView;
  search?: string;
  statuses?: HelperTicketStatus[];
  assigneeIds?: string[];
  assigneeEmails?: string[];
  isAssigned?: boolean;
  customerEmails?: string[];
  hasUnreadMessages?: boolean;
  sort?: HelperTicketListSort;
  createdAfter?: string;
  createdBefore?: string;
};

export type HelperListTicketsResult = {
  acting_as: HelperUserSummary;
  tickets: HelperTicketSummary[];
  total_returned: number;
  next_cursor: string | null;
  supports_highest_value_sort: boolean;
  resolved_view: HelperTicketListView | null;
  resolved_sort: HelperSearchConversationSort;
  applied_filters: Record<string, unknown>;
};

export type HelperGetTicketInput = {
  ticketSlug: string;
  includeTimeline?: boolean;
  timelineLimit?: number;
};

export type HelperReplyInput = {
  ticketSlug: string;
  message: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  shouldAutoAssign?: boolean;
  shouldClose?: boolean;
  responseToMessageId?: number | null;
};

export type HelperSetStatusInput = {
  ticketSlug: string;
  status: HelperTicketStatus;
  reason?: string;
};

export type HelperAssignTicketInput = {
  ticketSlug: string;
  assignedToId?: string;
  assignedToEmail?: string;
  unassign?: boolean;
  assignedToAI?: boolean;
  reason?: string;
};

export type HelperAddNoteInput = {
  ticketSlug: string;
  note: string;
};

export type HelperTicketMutationResult = {
  acting_as: HelperUserSummary;
  ticket: HelperTicketDetail;
};

export type HelperReplyResult = HelperTicketMutationResult & {
  message_id: number;
};

export type HelperNoteResult = HelperTicketMutationResult & {
  note_id: number;
};

const ACTIVE_MAILBOX_CONDITION = isNull(sql`${mailboxes.preferences}->>'disabled'`);

const unique = <T>(values: T[]) => Array.from(new Set(values));

const toIso = (value: Date | string | null | undefined) => {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.toISOString();
};

const splitCommaSeparated = (value: string | null | undefined) =>
  value
    ? value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
    : [];

const normalizePlainText = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  return trimmed
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const mapCurrentUser = (user: FullUserProfile): HelperUserSummary => ({
  id: user.id,
  email: user.email,
  display_name: user.displayName || user.email || user.id,
  permissions: user.permissions,
  access_role: user.access?.role === "afk" ? "afk" : "active",
  access_keywords: user.access?.keywords ?? [],
});

const mapTeamMember = (member: {
  id: string;
  email?: string;
  displayName: string;
  role: "afk" | "active";
  keywords: string[];
  permissions: string;
  openCount: number;
  emailOnAssignment: boolean;
}): HelperTeamMember => ({
  id: member.id,
  email: member.email ?? null,
  display_name: member.displayName || member.email || member.id,
  role: member.role,
  keywords: member.keywords,
  permissions: member.permissions,
  open_ticket_count: member.openCount,
  email_on_assignment: member.emailOnAssignment,
});

const mapTicketFile = (file: {
  id: number;
  name: string;
  mimetype: string;
  sizeHuman?: string | null;
  presignedUrl?: string | null;
  previewUrl?: string | null;
}): HelperTicketFile => ({
  id: Number(file.id),
  name: file.name,
  mimetype: file.mimetype,
  size_human: file.sizeHuman ?? null,
  url: file.presignedUrl ?? null,
  preview_url: file.previewUrl ?? null,
});

const mapCustomerFromSummary = (conversation: {
  emailFrom: string | null;
  platformCustomer: {
    name: string | null;
    value: string | number | null;
    isVip: boolean;
    links: Record<string, string> | null;
    metadata: Record<string, unknown> | null;
  } | null;
}): HelperTicketCustomer => ({
  email: conversation.emailFrom ?? null,
  name: conversation.platformCustomer?.name ?? null,
  value: conversation.platformCustomer?.value ?? null,
  is_vip: conversation.platformCustomer?.isVip ?? null,
  links: conversation.platformCustomer?.links ?? null,
  metadata: conversation.platformCustomer?.metadata ?? null,
});

const mapCustomerFromDetail = (conversation: {
  emailFrom: string | null;
  customerInfo: {
    name: string | null;
    value: number | null;
    isVip: boolean;
    links: Record<string, string> | null;
    metadata: Record<string, unknown> | null;
  } | null;
}): HelperTicketCustomer => ({
  email: conversation.emailFrom ?? null,
  name: conversation.customerInfo?.name ?? null,
  value: conversation.customerInfo?.value ?? null,
  is_vip: conversation.customerInfo?.isVip ?? null,
  links: conversation.customerInfo?.links ?? null,
  metadata: conversation.customerInfo?.metadata ?? null,
});

const getActiveMailbox = async () => {
  const mailbox = await db.query.mailboxes.findFirst({
    where: ACTIVE_MAILBOX_CONDITION,
  });

  if (!mailbox) {
    throw new Error("No active mailbox found.");
  }

  return mailbox;
};

const getConversationBySlug = async (ticketSlug: string) => {
  const conversation = await db.query.conversations.findFirst({
    where: eq(conversations.slug, ticketSlug),
  });

  if (!conversation) {
    throw new Error(`Ticket ${ticketSlug} was not found.`);
  }

  return conversation;
};

const getOpenTicketCountsByAssignee = async () => {
  const rows = await db
    .select({
      assignedToId: conversations.assignedToId,
      count: count(),
    })
    .from(conversations)
    .where(
      and(eq(conversations.status, "open"), isNotNull(conversations.assignedToId), isNull(conversations.mergedIntoId)),
    )
    .groupBy(conversations.assignedToId);

  return new Map(rows.map((row) => [row.assignedToId ?? "", row.count]));
};

export const resolveActingUserSelection = async (selectors: ActingUserSelectors = {}): Promise<FullUserProfile> => {
  const userId = selectors.userId ?? helperMcpEnv.HELPER_MCP_USER_ID;
  const userEmail = selectors.userEmail ?? helperMcpEnv.HELPER_MCP_USER_EMAIL;

  if (userId && userEmail) {
    throw new Error("Set only one of HELPER_MCP_USER_ID or HELPER_MCP_USER_EMAIL.");
  }

  if (userId) {
    const user = await getFullProfileById(userId);
    if (!user) {
      throw new Error(`No user matched HELPER_MCP_USER_ID=${userId}.`);
    }
    return user;
  }

  if (userEmail) {
    const user = await getFullProfileByEmail(userEmail);
    if (!user) {
      throw new Error(`No user matched HELPER_MCP_USER_EMAIL=${userEmail}.`);
    }
    return user;
  }

  const members = await getUsersWithMailboxAccess();
  if (members.length === 0) {
    throw new Error("No active team members were found. Create a user or set HELPER_MCP_USER_EMAIL.");
  }

  if (members.length === 1) {
    const [member] = members;
    if (!member) {
      throw new Error("The only active user could not be determined.");
    }
    const user = await getFullProfileById(member.id);
    if (!user) {
      throw new Error(`The only active user (${member.id}) could not be loaded.`);
    }
    return user;
  }

  const admins = members.filter((member) => member.permissions === "admin");
  if (admins.length === 1) {
    const [admin] = admins;
    if (!admin) {
      throw new Error("The only admin user could not be determined.");
    }
    const user = await getFullProfileById(admin.id);
    if (!user) {
      throw new Error(`The only admin user (${admin.id}) could not be loaded.`);
    }
    return user;
  }

  throw new Error(
    "Epicure Assist MCP could not choose an acting user automatically. Set HELPER_MCP_USER_EMAIL or HELPER_MCP_USER_ID.",
  );
};

export class HelperMcpService {
  private readonly actingAs: HelperUserSummary;
  private teamMembersCache?: HelperTeamMembersResult;

  constructor(private readonly user: FullUserProfile) {
    this.actingAs = mapCurrentUser(user);
  }

  static async create(selectors: ActingUserSelectors = {}) {
    const user = await resolveActingUserSelection(selectors);
    return new HelperMcpService(user);
  }

  async getCurrentUser(): Promise<HelperCurrentUserResult> {
    const mailbox = await getActiveMailbox();
    return {
      acting_as: this.actingAs,
      mailbox: {
        id: mailbox.id,
        name: mailbox.name,
        slug: mailbox.slug,
      },
    };
  }

  async listTeamMembers(): Promise<HelperTeamMembersResult> {
    if (this.teamMembersCache) {
      return this.teamMembersCache;
    }

    const [members, openCounts] = await Promise.all([getUsersWithMailboxAccess(), getOpenTicketCountsByAssignee()]);

    this.teamMembersCache = {
      acting_as: this.actingAs,
      is_admin: this.user.permissions === "admin",
      members: members.map((member) =>
        mapTeamMember({
          ...member,
          openCount: openCounts.get(member.id) ?? 0,
        }),
      ),
    };

    return this.teamMembersCache;
  }

  async listTickets(input: HelperListTicketsInput): Promise<HelperListTicketsResult> {
    const [teamMembers, mailbox, anyPlatformCustomer] = await Promise.all([
      this.listTeamMembers(),
      getActiveMailbox(),
      db.query.platformCustomers.findFirst({ columns: { id: true } }),
    ]);
    const assigneeIds = this.resolveAssigneeFilters(input.assigneeIds, input.assigneeEmails, teamMembers.members);
    const normalizedInput = this.normalizeListTicketsInput(input, assigneeIds);

    const result = await searchConversations(
      mailbox,
      {
        cursor: normalizedInput.cursor ?? null,
        limit: normalizedInput.limit,
        sort: normalizedInput.sort,
        category: normalizedInput.category ?? null,
        search: normalizedInput.search ?? null,
        status: normalizedInput.statuses,
        assignee: normalizedInput.assigneeIds.length > 0 ? normalizedInput.assigneeIds : undefined,
        isAssigned: normalizedInput.isAssigned,
        createdAfter: normalizedInput.createdAfter,
        createdBefore: normalizedInput.createdBefore,
        customer: normalizedInput.customerEmails,
        hasUnreadMessages: normalizedInput.hasUnreadMessages,
      },
      this.user.id,
    );

    const { results, nextCursor } = await result.list;

    return {
      acting_as: this.actingAs,
      tickets: results.map((conversation) => this.mapTicketSummary(conversation, teamMembers.members)),
      total_returned: results.length,
      next_cursor: nextCursor ?? null,
      supports_highest_value_sort: Boolean(anyPlatformCustomer) && this.supportsHighestValueSort(normalizedInput),
      resolved_view: normalizedInput.view,
      resolved_sort: normalizedInput.sort,
      applied_filters: {
        view: normalizedInput.view,
        category: normalizedInput.category ?? null,
        search: normalizedInput.search ?? null,
        statuses: normalizedInput.statuses ?? [],
        assignee_ids: normalizedInput.assigneeIds,
        assignee_emails: input.assigneeEmails ?? [],
        is_assigned: normalizedInput.isAssigned ?? null,
        customer_emails: normalizedInput.customerEmails ?? [],
        has_unread_messages: normalizedInput.hasUnreadMessages ?? null,
        requested_sort: input.sort ?? null,
        sort: normalizedInput.sort,
        created_after: normalizedInput.createdAfter ?? null,
        created_before: normalizedInput.createdBefore ?? null,
      },
    };
  }

  async getTicket(input: HelperGetTicketInput): Promise<HelperTicketDetail> {
    const [teamMembers, mailbox, conversation] = await Promise.all([
      this.listTeamMembers(),
      getActiveMailbox(),
      getConversationBySlug(input.ticketSlug),
    ]);
    const [ticket, draft] = await Promise.all([
      serializeConversationWithMessages(mailbox, conversation),
      getLastAiGeneratedDraft(conversation.id),
    ]);

    return this.mapTicketDetail(
      {
        ...ticket,
        draft: draft ? serializeResponseAiDraft(draft, mailbox) : null,
      },
      teamMembers.members,
      {
        includeTimeline: input.includeTimeline ?? true,
        timelineLimit: input.timelineLimit ?? 25,
      },
    );
  }

  async replyToTicket(input: HelperReplyInput): Promise<HelperReplyResult> {
    const conversation = await getConversationBySlug(input.ticketSlug);

    const message = await db.transaction(async (tx) => {
      if (input.shouldAutoAssign && !conversation.assignedToId) {
        await updateConversation(
          conversation.id,
          {
            set: { assignedToId: this.user.id, assignedToAI: false },
            byUserId: this.user.id,
            message: "Auto-assigned by MCP reply",
          },
          tx,
        );
      }

      if (conversation.assignedToAI) {
        await updateConversation(
          conversation.id,
          {
            set: { assignedToAI: false },
            byUserId: this.user.id,
            message: "AI response disabled after MCP reply",
          },
          tx,
        );
      }

      const createdMessage = await createConversationMessage(
        {
          conversationId: conversation.id,
          body: input.message,
          cleanedUpText: generateCleanedUpText(input.message),
          userId: this.user.id,
          emailTo: input.to?.[0] ?? conversation.emailFrom ?? null,
          emailCc: input.cc ?? [],
          emailBcc: input.bcc ?? [],
          role: "staff",
          responseToId: input.responseToMessageId ?? null,
          status: "queueing",
          isPerfect: false,
          isFlaggedAsBad: false,
        },
        tx,
      );

      await tx
        .update(conversationMessages)
        .set({ status: "discarded" })
        .where(
          and(
            eq(conversationMessages.conversationId, conversation.id),
            eq(conversationMessages.role, "ai_assistant"),
            eq(conversationMessages.status, "draft"),
          ),
        );

      if (input.shouldClose && conversation.status !== "spam") {
        await updateConversation(
          conversation.id,
          {
            set: { status: "closed" },
            byUserId: this.user.id,
            message: "Reply sent",
          },
          tx,
        );
      }

      return createdMessage;
    });

    return {
      acting_as: this.actingAs,
      message_id: message.id,
      ticket: await this.getTicket({
        ticketSlug: input.ticketSlug,
        includeTimeline: true,
        timelineLimit: 10,
      }),
    };
  }

  async setTicketStatus(input: HelperSetStatusInput): Promise<HelperTicketMutationResult> {
    const conversation = await getConversationBySlug(input.ticketSlug);

    await updateConversation(conversation.id, {
      set: { status: input.status },
      byUserId: this.user.id,
      message: input.reason ?? null,
    });

    return {
      acting_as: this.actingAs,
      ticket: await this.getTicket({
        ticketSlug: input.ticketSlug,
        includeTimeline: true,
        timelineLimit: 10,
      }),
    };
  }

  async assignTicket(input: HelperAssignTicketInput): Promise<HelperTicketMutationResult> {
    if (!input.unassign && !input.assignedToId && !input.assignedToEmail && input.assignedToAI === undefined) {
      throw new Error("Provide assigned_to_id, assigned_to_email, unassign, or assigned_to_ai.");
    }

    const [conversation, teamMembers] = await Promise.all([
      getConversationBySlug(input.ticketSlug),
      this.listTeamMembers(),
    ]);
    const assignedToId = this.resolveSingleAssigneeId(
      {
        assignedToId: input.assignedToId,
        assignedToEmail: input.assignedToEmail,
        unassign: input.unassign ?? false,
      },
      teamMembers.members,
    );

    await updateConversation(conversation.id, {
      set: {
        ...(assignedToId !== undefined ? { assignedToId } : {}),
        ...(input.assignedToAI !== undefined ? { assignedToAI: input.assignedToAI } : {}),
      },
      byUserId: this.user.id,
      message: input.reason ?? null,
    });

    return {
      acting_as: this.actingAs,
      ticket: await this.getTicket({
        ticketSlug: input.ticketSlug,
        includeTimeline: true,
        timelineLimit: 10,
      }),
    };
  }

  async addInternalNote(input: HelperAddNoteInput): Promise<HelperNoteResult> {
    const conversation = await getConversationBySlug(input.ticketSlug);

    const note = await addNote({
      conversationId: conversation.id,
      message: input.note,
      fileSlugs: [],
      user: {
        id: this.user.id,
        displayName: this.user.displayName,
        email: this.user.email,
      },
    });

    return {
      acting_as: this.actingAs,
      note_id: note.id,
      ticket: await this.getTicket({
        ticketSlug: input.ticketSlug,
        includeTimeline: true,
        timelineLimit: 10,
      }),
    };
  }

  private resolveAssigneeFilters(
    assigneeIds: string[] | undefined,
    assigneeEmails: string[] | undefined,
    teamMembers: HelperTeamMember[],
  ) {
    const resolvedIds = assigneeIds ? [...assigneeIds] : [];

    if (!assigneeEmails?.length) {
      return unique(resolvedIds);
    }

    const lookup = new Map(teamMembers.map((member) => [member.email?.toLowerCase(), member.id]));

    for (const email of assigneeEmails) {
      const match = lookup.get(email.toLowerCase());
      if (!match) {
        throw new Error(`No team member matched assignee email ${email}.`);
      }
      resolvedIds.push(match);
    }

    return unique(resolvedIds);
  }

  private resolveSingleAssigneeId(
    input: {
      assignedToId?: string;
      assignedToEmail?: string;
      unassign: boolean;
    },
    teamMembers: HelperTeamMember[],
  ) {
    if (input.unassign) {
      if (input.assignedToId || input.assignedToEmail) {
        throw new Error("Do not combine unassign with assigned_to_id or assigned_to_email.");
      }
      return null;
    }

    if (input.assignedToId && input.assignedToEmail) {
      throw new Error("Provide either assigned_to_id or assigned_to_email, not both.");
    }

    if (input.assignedToId) {
      const exists = teamMembers.some((member) => member.id === input.assignedToId);
      if (!exists) {
        throw new Error(`No team member matched assigned_to_id ${input.assignedToId}.`);
      }
      return input.assignedToId;
    }

    if (input.assignedToEmail) {
      const match = teamMembers.find((member) => member.email?.toLowerCase() === input.assignedToEmail?.toLowerCase());
      if (!match) {
        throw new Error(`No team member matched assigned_to_email ${input.assignedToEmail}.`);
      }
      return match.id;
    }

    return undefined;
  }

  private mapTicketSummary(
    conversation: {
      id: number;
      slug: string;
      status: HelperTicketStatus | null;
      subject: string;
      emailFrom: string | null;
      conversationProvider: string | null;
      source: string | null;
      assignedToId: string | null;
      assignedToAI: boolean;
      issueGroupId: number | null;
      issueSubgroupId: number | null;
      createdAt: Date;
      updatedAt: Date;
      closedAt: Date | null;
      lastUserEmailCreatedAt: Date | null;
      lastMessageAt: Date | null;
      recentMessageText: string | null;
      matchedMessageText: string | null;
      unreadMessageCount?: number;
      platformCustomer: {
        name: string | null;
        value: string | number | null;
        isVip: boolean;
        links: Record<string, string> | null;
        metadata: Record<string, unknown> | null;
      } | null;
    },
    teamMembers: HelperTeamMember[],
  ): HelperTicketSummary {
    return {
      id: conversation.id,
      slug: conversation.slug,
      status: conversation.status ?? "open",
      subject: conversation.subject,
      customer: mapCustomerFromSummary(conversation),
      conversation_provider: conversation.conversationProvider ?? null,
      source: conversation.source ?? null,
      assigned_to: this.findTeamMember(conversation.assignedToId, teamMembers),
      assigned_to_ai: conversation.assignedToAI,
      issue_group_id: conversation.issueGroupId ?? null,
      issue_subgroup_id: conversation.issueSubgroupId ?? null,
      created_at: toIso(conversation.createdAt) ?? "",
      updated_at: toIso(conversation.updatedAt) ?? "",
      closed_at: toIso(conversation.closedAt),
      last_customer_message_at: toIso(conversation.lastUserEmailCreatedAt),
      last_message_at: toIso(conversation.lastMessageAt),
      recent_message_text: conversation.recentMessageText ?? null,
      matched_message_text: conversation.matchedMessageText ?? null,
      unread_message_count: conversation.unreadMessageCount ?? null,
    };
  }

  private mapTicketDetail(
    conversation: {
      id: number;
      slug: string;
      status: HelperTicketStatus | null;
      subject: string;
      emailFrom: string | null;
      conversationProvider: string | null;
      source: string | null;
      assignedToId: string | null;
      assignedToAI: boolean;
      issueGroupId: number | null;
      issueSubgroupId: number | null;
      createdAt: Date;
      updatedAt: Date;
      closedAt: Date | null;
      lastUserEmailCreatedAt: Date | null;
      lastMessageAt: Date | null;
      customerInfo: {
        name: string | null;
        value: number | null;
        isVip: boolean;
        links: Record<string, string> | null;
        metadata: Record<string, unknown> | null;
      } | null;
      messages: Record<string, unknown>[];
      cc: string;
      draft: {
        id: number;
        body: string | null;
        responseToId: number;
        isStale: boolean;
      } | null;
    },
    teamMembers: HelperTeamMember[],
    options: {
      includeTimeline: boolean;
      timelineLimit: number;
    },
  ): HelperTicketDetail {
    const summary = {
      id: conversation.id,
      slug: conversation.slug,
      status: conversation.status ?? "open",
      subject: conversation.subject,
      customer: mapCustomerFromDetail(conversation),
      conversation_provider: conversation.conversationProvider ?? null,
      source: conversation.source ?? null,
      assigned_to: this.findTeamMember(conversation.assignedToId, teamMembers),
      assigned_to_ai: conversation.assignedToAI,
      issue_group_id: conversation.issueGroupId ?? null,
      issue_subgroup_id: conversation.issueSubgroupId ?? null,
      created_at: toIso(conversation.createdAt) ?? "",
      updated_at: toIso(conversation.updatedAt) ?? "",
      closed_at: toIso(conversation.closedAt),
      last_customer_message_at: toIso(conversation.lastUserEmailCreatedAt),
      last_message_at: toIso(conversation.lastMessageAt),
      recent_message_text: null,
      matched_message_text: null,
      unread_message_count: null,
    } satisfies HelperTicketSummary;

    const timeline = options.includeTimeline
      ? conversation.messages
          .map((entry) => this.mapTimelineEntry(entry, teamMembers))
          .slice(-Math.max(1, options.timelineLimit))
      : [];

    return {
      ...summary,
      cc_recipients: splitCommaSeparated(conversation.cc),
      ai_draft: conversation.draft
        ? {
            id: conversation.draft.id,
            body: conversation.draft.body ?? null,
            response_to_id: conversation.draft.responseToId,
            is_stale: conversation.draft.isStale,
          }
        : null,
      timeline,
      total_timeline_entries: conversation.messages.length,
      timeline_truncated: options.includeTimeline ? conversation.messages.length > timeline.length : false,
    };
  }

  private mapTimelineEntry(entry: Record<string, unknown>, teamMembers: HelperTeamMember[]): HelperTimelineEntry {
    const entryType = entry.type;

    if (entryType !== "message" && entryType !== "note" && entryType !== "event" && entryType !== "guide_session") {
      throw new Error(`Unsupported timeline entry type: ${String(entryType)}`);
    }

    return {
      id: Number(entry.id),
      type: entryType,
      created_at: toIso(entry.createdAt as Date | string | null | undefined) ?? "",
      author: this.findTeamMember(
        (entry.userId as string | null | undefined) ?? (entry.byUserId as string | null | undefined) ?? null,
        teamMembers,
      ),
      role: (entry.role as string | null | undefined) ?? null,
      status: (entry.status as string | null | undefined) ?? null,
      body: (entry.body as string | null | undefined) ?? null,
      html_body: (entry.htmlBody as string | null | undefined) ?? null,
      body_text: this.getTimelineBodyText(entryType, entry),
      from: (entry.from as string | null | undefined) ?? null,
      to: (entry.emailTo as string | null | undefined) ?? null,
      cc: Array.isArray(entry.cc) ? (entry.cc as string[]) : [],
      bcc: Array.isArray(entry.bcc) ? (entry.bcc as string[]) : [],
      files: Array.isArray(entry.files)
        ? entry.files.map((file) =>
            mapTicketFile(
              file as {
                id: number;
                name: string;
                mimetype: string;
                sizeHuman?: string | null;
                presignedUrl?: string | null;
                previewUrl?: string | null;
              },
            ),
          )
        : [],
      metadata: (entry.metadata as Record<string, unknown> | null | undefined) ?? null,
      reaction_type: (entry.reactionType as string | null | undefined) ?? null,
      reaction_feedback: (entry.reactionFeedback as string | null | undefined) ?? null,
      event_type: (entry.eventType as string | null | undefined) ?? null,
      changes: (entry.changes as Record<string, unknown> | null | undefined) ?? null,
      reason: (entry.reason as string | null | undefined) ?? null,
      title: (entry.title as string | null | undefined) ?? null,
      guide_status: entryType === "guide_session" ? ((entry.status as string | null | undefined) ?? null) : null,
      instructions: (entry.instructions as string | null | undefined) ?? null,
    };
  }

  private findTeamMember(userId: string | null | undefined, teamMembers: HelperTeamMember[]) {
    if (!userId) return null;
    return teamMembers.find((member) => member.id === userId) ?? null;
  }

  private normalizeListTicketsInput(input: HelperListTicketsInput, assigneeIds: string[]) {
    const hasExplicitStatuses = Boolean(input.statuses?.length);
    const hasExplicitAssigneeFilter = assigneeIds.length > 0;
    const sort = this.normalizeListTicketSort(input.sort);
    let view = input.view ?? null;
    let category = input.view ? undefined : input.category;
    let statuses = input.statuses ? [...input.statuses] : undefined;
    let isAssigned = input.isAssigned;
    let hasUnreadMessages = input.hasUnreadMessages;
    let resolvedAssigneeIds = [...assigneeIds];

    if (!view && !category && !hasExplicitStatuses) {
      view = "active";
      statuses = [...HELPER_ACTIVE_TICKET_STATUSES];
    }

    if (view) {
      switch (view) {
        case "active":
          if (!hasExplicitStatuses) {
            statuses = [...HELPER_ACTIVE_TICKET_STATUSES];
          }
          break;
        case "mine":
          category = undefined;
          if (!hasExplicitStatuses) {
            statuses = [...HELPER_ACTIVE_TICKET_STATUSES];
          }
          if (!hasExplicitAssigneeFilter) {
            resolvedAssigneeIds = unique([...resolvedAssigneeIds, this.user.id]);
          }
          if (input.isAssigned === undefined) {
            isAssigned = true;
          }
          break;
        case "open_unread":
          category = undefined;
          if (!hasExplicitStatuses) {
            statuses = ["open"];
          }
          if (input.hasUnreadMessages === undefined) {
            hasUnreadMessages = true;
          }
          break;
        case "unassigned_open":
          category = undefined;
          if (!hasExplicitStatuses) {
            statuses = ["open"];
          }
          if (input.isAssigned === undefined && !hasExplicitAssigneeFilter) {
            isAssigned = false;
          }
          break;
        case "awaiting_customer":
          category = undefined;
          if (!hasExplicitStatuses) {
            statuses = ["waiting_on_customer"];
          }
          break;
      }
    }

    return {
      ...input,
      assigneeIds: unique(resolvedAssigneeIds),
      category,
      hasUnreadMessages,
      isAssigned,
      sort,
      statuses,
      view,
    };
  }

  private normalizeListTicketSort(sort: HelperTicketListSort | undefined): HelperSearchConversationSort {
    if (!sort || sort === "latest") {
      return "newest";
    }

    return sort;
  }

  private supportsHighestValueSort(input: {
    category?: HelperLegacyTicketCategory;
    search?: string;
    statuses?: HelperTicketStatus[];
  }) {
    if (input.search) {
      return false;
    }

    if (input.statuses?.length === 1) {
      const [status] = input.statuses;
      return status ? HELPER_HIGHEST_VALUE_SORTABLE_STATUSES.has(status) : false;
    }

    return Boolean(input.category && !input.statuses?.length);
  }

  private getTimelineBodyText(entryType: HelperTimelineEntry["type"], entry: Record<string, unknown>) {
    if (entryType === "event") {
      return null;
    }

    if (entryType === "message") {
      const explicitText = normalizePlainText((entry.bodyText as string | null | undefined) ?? null);
      if (explicitText) {
        return explicitText;
      }

      return normalizePlainText(
        htmlToText((entry.htmlBody as string | null | undefined) ?? (entry.body as string | null | undefined) ?? "", {
          wordwrap: false,
        }),
      );
    }

    if (entryType === "guide_session") {
      return normalizePlainText(
        (entry.instructions as string | null | undefined) ?? (entry.title as string | null | undefined) ?? null,
      );
    }

    return normalizePlainText((entry.body as string | null | undefined) ?? null);
  }
}
