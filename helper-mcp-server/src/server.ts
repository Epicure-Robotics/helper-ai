import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  formatCurrentUser,
  formatListTickets,
  formatTeamMembers,
  formatTicket,
  formatTicketMutation,
  renderStructuredText,
} from "./formatters.js";
import {
  HELPER_TICKET_LIST_SORTS,
  HELPER_TICKET_LIST_VIEWS,
  HELPER_TICKET_STATUSES,
  HelperMcpService,
  type HelperResponseFormat,
} from "./service.js";

const RESPONSE_FORMAT = z
  .enum(["markdown", "json"])
  .default("markdown")
  .describe("Use markdown for human-readable text or json for machine-readable output.");

const TICKET_STATUS = z.enum(HELPER_TICKET_STATUSES).describe("Conversation status.");
const TICKET_LIST_VIEW = z
  .enum(HELPER_TICKET_LIST_VIEWS)
  .describe(
    "Built-in MCP triage view. Use active, mine, open_unread, unassigned_open, or awaiting_customer instead of composing common filters by hand.",
  );
const TICKET_LIST_SORT = z
  .enum(HELPER_TICKET_LIST_SORTS)
  .describe(
    "Sort order. newest is the default. latest aliases newest. created_desc/created_asc sort by ticket creation time, updated_desc/updated_asc sort by ticket update time.",
  );

const buildToolError = (error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  return {
    isError: true as const,
    content: [
      {
        type: "text" as const,
        text: `Error: ${message}`,
      },
    ],
  };
};

const handleWithFormatting = async <T>(
  operation: () => Promise<T>,
  responseFormat: HelperResponseFormat,
  markdownRenderer: (data: T) => string,
) => {
  try {
    const structured = await operation();
    return {
      content: [
        {
          type: "text" as const,
          text: renderStructuredText(responseFormat, structured, markdownRenderer),
        },
      ],
      structuredContent: structured,
    };
  } catch (error) {
    console.error(error);
    return buildToolError(error);
  }
};

const registerTools = (server: McpServer, service: HelperMcpService) => {
  server.registerTool(
    "helper_get_current_user",
    {
      title: "Get Current User",
      description:
        "Show which team member this MCP server is acting as, along with the active mailbox. Use this first to confirm permissions or identity.",
      inputSchema: {
        response_format: RESPONSE_FORMAT,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ response_format }) => handleWithFormatting(() => service.getCurrentUser(), response_format, formatCurrentUser),
  );

  server.registerTool(
    "helper_list_team_members",
    {
      title: "List Team Members",
      description:
        "List team members who can be assigned. Returns IDs, emails, roles, permissions, and each member's open conversation count.",
      inputSchema: {
        response_format: RESPONSE_FORMAT,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ response_format }) => handleWithFormatting(() => service.listTeamMembers(), response_format, formatTeamMembers),
  );

  server.registerTool(
    "helper_list_tickets",
    {
      title: "List Conversations",
      description:
        "List conversations with pagination and filters (status, assignee, category, customer email, unread, search). By default returns active items, newest first.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).default(25).describe("Maximum number of tickets to return."),
        cursor: z.string().nullish().describe("Pagination cursor from a previous helper_list_tickets call."),
        view: TICKET_LIST_VIEW.optional(),
        category: z
          .enum(["conversations", "assigned", "mine"])
          .optional()
          .describe(
            "Legacy dashboard category filter. Prefer view for common MCP triage use cases (e.g. unassigned_open for open unassigned tickets).",
          ),
        search: z.string().optional().describe("Search subject, customer email, or indexed message content."),
        statuses: z.array(TICKET_STATUS).optional().describe("Ticket status filters."),
        assignee_ids: z.array(z.string().uuid()).optional().describe("Filter by team member IDs."),
        assignee_emails: z.array(z.string().email()).optional().describe("Filter by team member emails."),
        is_assigned: z.boolean().optional().describe("Filter assigned or unassigned tickets."),
        customer_emails: z.array(z.string().email()).optional().describe("Filter by customer email."),
        has_unread_messages: z.boolean().optional().describe("Only return tickets with unread customer replies."),
        sort: TICKET_LIST_SORT.optional(),
        created_after: z
          .string()
          .datetime()
          .optional()
          .describe("Only return tickets created after this ISO timestamp."),
        created_before: z
          .string()
          .datetime()
          .optional()
          .describe("Only return tickets created before this ISO timestamp."),
        response_format: RESPONSE_FORMAT,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({
      assignee_emails,
      assignee_ids,
      category,
      created_after,
      created_before,
      cursor,
      customer_emails,
      has_unread_messages,
      is_assigned,
      limit,
      response_format,
      search,
      sort,
      statuses,
      view,
    }) =>
      handleWithFormatting(
        () =>
          service.listTickets({
            limit,
            cursor,
            view,
            category,
            search,
            statuses,
            assigneeIds: assignee_ids,
            assigneeEmails: assignee_emails,
            isAssigned: is_assigned,
            customerEmails: customer_emails,
            hasUnreadMessages: has_unread_messages,
            sort,
            createdAfter: created_after,
            createdBefore: created_before,
          }),
        response_format,
        formatListTickets,
      ),
  );

  server.registerTool(
    "helper_get_ticket",
    {
      title: "Get Conversation",
      description:
        "Fetch a single conversation by slug, including message/note/event history. Use before replying or changing status.",
      inputSchema: {
        ticket_slug: z.string().min(1).describe("Conversation slug."),
        include_timeline: z
          .boolean()
          .default(true)
          .describe("Include timeline entries such as messages, notes, and events."),
        timeline_limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(25)
          .describe("Maximum timeline entries to include, counting backward from the most recent entry."),
        response_format: RESPONSE_FORMAT,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ include_timeline, response_format, ticket_slug, timeline_limit }) =>
      handleWithFormatting(
        () =>
          service.getTicket({
            ticketSlug: ticket_slug,
            includeTimeline: include_timeline,
            timelineLimit: timeline_limit,
          }),
        response_format,
        formatTicket,
      ),
  );

  server.registerTool(
    "helper_reply_to_ticket",
    {
      title: "Reply To Conversation",
      description:
        "Queue a staff reply on an existing conversation. By default keeps it open; set should_close=true to close after send.",
      inputSchema: {
        ticket_slug: z.string().min(1).describe("Conversation slug."),
        message: z.string().min(1).describe("Reply body."),
        to: z.array(z.string().email()).optional().describe("Optional explicit To recipients."),
        cc: z.array(z.string().email()).default([]).describe("Optional CC recipients."),
        bcc: z.array(z.string().email()).default([]).describe("Optional BCC recipients."),
        should_auto_assign: z
          .boolean()
          .default(true)
          .describe("Auto-assign the ticket to the acting user if it is currently unassigned."),
        should_close: z.boolean().default(false).describe("Close the ticket after queuing the reply."),
        response_to_message_id: z
          .number()
          .int()
          .positive()
          .nullable()
          .optional()
          .describe("Optional message ID this reply is responding to."),
        response_format: RESPONSE_FORMAT,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    ({
      bcc,
      cc,
      message,
      response_format,
      response_to_message_id,
      should_auto_assign,
      should_close,
      ticket_slug,
      to,
    }) =>
      handleWithFormatting(
        () =>
          service.replyToTicket({
            ticketSlug: ticket_slug,
            message,
            to,
            cc,
            bcc,
            shouldAutoAssign: should_auto_assign,
            shouldClose: should_close,
            responseToMessageId: response_to_message_id ?? null,
          }),
        response_format,
        (result) => formatTicketMutation("Reply queued.", result),
      ),
  );

  server.registerTool(
    "helper_set_ticket_status",
    {
      title: "Set Conversation Status",
      description: "Update conversation status: open, waiting_on_customer, closed, spam, check_back_later, or ignored.",
      inputSchema: {
        ticket_slug: z.string().min(1).describe("Conversation slug."),
        status: TICKET_STATUS,
        reason: z.string().optional().describe("Optional audit reason recorded on the ticket event."),
        response_format: RESPONSE_FORMAT,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ reason, response_format, status, ticket_slug }) =>
      handleWithFormatting(
        () =>
          service.setTicketStatus({
            ticketSlug: ticket_slug,
            status,
            reason,
          }),
        response_format,
        (result) => formatTicketMutation(`Status updated to ${status}.`, result),
      ),
  );

  server.registerTool(
    "helper_assign_ticket",
    {
      title: "Assign Conversation",
      description:
        "Assign or unassign a conversation, or toggle AI auto-response. Use assigned_to_id, assigned_to_email, or unassign=true.",
      inputSchema: {
        ticket_slug: z.string().min(1).describe("Conversation slug."),
        assigned_to_id: z.string().uuid().optional().describe("Team member ID to assign."),
        assigned_to_email: z.string().email().optional().describe("Team member email to assign."),
        unassign: z.boolean().default(false).describe("Set true to clear the human assignee."),
        assigned_to_ai: z.boolean().optional().describe("Enable or disable AI auto-response for this ticket."),
        reason: z.string().optional().describe("Optional audit reason recorded on the ticket event."),
        response_format: RESPONSE_FORMAT,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ assigned_to_ai, assigned_to_email, assigned_to_id, reason, response_format, ticket_slug, unassign }) =>
      handleWithFormatting(
        () =>
          service.assignTicket({
            ticketSlug: ticket_slug,
            assignedToId: assigned_to_id,
            assignedToEmail: assigned_to_email,
            unassign,
            assignedToAI: assigned_to_ai,
            reason,
          }),
        response_format,
        (result) => formatTicketMutation("Assignment updated.", result),
      ),
  );

  server.registerTool(
    "helper_add_internal_note",
    {
      title: "Add Internal Note",
      description: "Add an internal note to a conversation. Notes are team-only.",
      inputSchema: {
        ticket_slug: z.string().min(1).describe("Conversation slug."),
        note: z.string().min(1).describe("Internal note body."),
        response_format: RESPONSE_FORMAT,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    ({ note, response_format, ticket_slug }) =>
      handleWithFormatting(
        () =>
          service.addInternalNote({
            ticketSlug: ticket_slug,
            note,
          }),
        response_format,
        (result) => formatTicketMutation("Internal note added.", result),
      ),
  );
};

export const createHelperMcpServer = async () => {
  const service = await HelperMcpService.create();
  const server = new McpServer({
    name: "helper-mcp-server",
    version: "0.1.0",
  });

  registerTools(server, service);

  return server;
};

export const startHelperMcpServer = async () => {
  const server = await createHelperMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
};
