# Epicure Assist MCP server

Local stdio MCP server for [Epicure Assist](https://epicurerobotics.com). It uses the app’s data and mutation layer so conversation reads and writes behave like the dashboard, including side effects such as event logs, notifications, notes, and reply queueing.

Tool names keep the `helper_*` prefix for compatibility with existing MCP client configs.

## Included tools

- `helper_get_current_user`
- `helper_list_team_members`
- `helper_list_tickets`
- `helper_get_ticket`
- `helper_reply_to_ticket`
- `helper_set_ticket_status`
- `helper_assign_ticket`
- `helper_add_internal_note`

`helper_list_tickets` defaults to active tickets sorted newest-first. It also supports first-class MCP views like `active`, `mine`, `open_unread`, `unassigned_open`, and `awaiting_customer`, plus sort aliases like `latest`, `created_desc`, and `updated_desc`.

## Acting user

The server always acts as a real team member in your Epicure Assist workspace.

Selection order:

1. `HELPER_MCP_USER_ID`
2. `HELPER_MCP_USER_EMAIL`
3. The only active user account, if there is exactly one
4. The only active admin user, if there is exactly one

If none of those resolve cleanly, startup fails with an actionable error.

In workspaces with multiple active users, set `HELPER_MCP_USER_EMAIL` or `HELPER_MCP_USER_ID` explicitly.

## Run locally

From the repo root:

```bash
pnpm mcp:helper
```

This loads local env files and runs with `react-server` conditions.

## Run as Streamable HTTP

To expose the MCP server over HTTP instead of stdio:

```bash
HELPER_MCP_USER_EMAIL="support@example.com" \
HELPER_MCP_BEARER_TOKEN="replace-with-a-secret" \
pnpm mcp:helper:http
```

Defaults:

- Host: `127.0.0.1`
- Port: `3334`
- MCP endpoint: `http://127.0.0.1:3334/mcp`
- Health endpoint: `http://127.0.0.1:3334/health`

Optional env vars:

- `HELPER_MCP_HOST`
- `HELPER_MCP_PORT`
- `HELPER_MCP_BEARER_TOKEN`

## Example MCP config

### URL mode for Codex

```bash
codex mcp add epicure-assist \
  --url http://127.0.0.1:3334/mcp \
  --bearer-token-env-var HELPER_MCP_BEARER_TOKEN
```

Start the HTTP server first with `pnpm mcp:helper:http`.

### stdio mode

```json
{
  "mcpServers": {
    "epicure-assist": {
      "command": "pnpm",
      "args": ["mcp:helper"],
      "cwd": "/path/to/epicure-assist",
      "env": {
        "HELPER_MCP_USER_EMAIL": "support@example.com"
      }
    }
  }
}
```

## Notes

- This server uses stdio transport, so it redirects `console.log`/`console.info`/`console.debug` to stderr before loading app modules.
- The HTTP server uses session-based Streamable HTTP, which works well with URL-based MCP registration.
- When `HELPER_MCP_BEARER_TOKEN` is set, HTTP requests must include `Authorization: Bearer <token>`.
- Ticket timelines expose both `html_body` and normalized `body_text` for message reading and draft generation.
- All tools accept `response_format` with `markdown` or `json`.
- File uploads are not exposed yet. Reply and note tools currently operate without attachments.
