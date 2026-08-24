# Architecture

How Epicure Assist is put together: the stack, the data model, and how work actually gets executed.

## Stack

| Layer | Choice |
| --- | --- |
| App | Next.js 15 (App Router), React 19, TypeScript |
| API | tRPC (`trpc/router/**`) plus REST route handlers under `app/api/**` |
| Database | **Supabase Postgres**, accessed with Drizzle ORM. Not MongoDB |
| Auth | Supabase Auth (email sign-in codes) |
| Background jobs | **pgmq** queues inside the same Postgres, plus `pg_cron` for schedules |
| Mail | Gmail API — OAuth for send/read, Google Pub/Sub push for delivery |
| AI | OpenAI via the Vercel AI SDK (`lib/ai/**`) |
| Hosting | **AWS App Runner**, image from ECR. Deployed by `.github/workflows/deploy-aws.yml` |

> The README used to say Vercel. It doesn't deploy there — `deploy-aws.yml` builds an image, pushes
> to ECR, runs migrations, and calls `aws apprunner start-deployment`.

## Directory map

```
app/(dashboard)/          inbox UI — conversation list, filters, settings pages
app/api/                  REST handlers: chat widget, Gmail webhook, auth callbacks
components/               shared UI (ui/ is the shadcn-style primitive layer)
db/schema/                Drizzle table definitions — the source of truth for the data model
db/drizzle/               generated SQL migrations; never hand-edit a committed one
db/seeds/                 seed data, including the Epicure issue groups and FAQs
jobs/                     every background job, plus eventCatalog.ts and the trigger helpers
lib/ai/                   prompts, model selection, structured-output query helpers
lib/data/                 data access — conversations, users, mailboxes, search
lib/leads/                lead taxonomy, triage types, form parsing   ← see lead-pipeline.md
lib/epicure/              Epicure-specific content: issue groups, reply templates, knowledge
scripts/                  one-off and maintenance scripts (see operations.md)
tests/                    vitest suites; tests/support/factories seeds DB-backed tests
```

## Data model

The tables that matter most:

**`conversations_conversation`** — one row per thread.
- `status`: `open` | `waiting_on_customer` | `closed` | `spam` | `check_back_later` | `ignored`.
  `ignored` is written by the arrival filters; `closed` means a human dealt with it.
- `source`: `email` | `chat` | `form` — chat widget conversations live here too.
- `issueGroupId` — the category it was filed into.
- `inboundTriage` (jsonb) — category, priority, geography, summary, routing override. Written by
  `categorizeConversationToIssueGroup`. See [lead-pipeline.md](./lead-pipeline.md).
- `assignedToAI` — whether the AI may carry the conversation, as opposed to drafting for a human.

**`issue_groups`** — the categories. **Not scoped to a mailbox**, so they survive changing the
connected Gmail account. Holds `autoResponseEnabled` (the Settings toggle), `standardAnswer`, and
`defaultSavedReplyId`.

> `defaultSavedReplyId` has **no foreign key**. `saved_replies` cascade-deletes with the mailbox, so
> deleting the mailbox row leaves groups pointing at dead template IDs and replies stop silently.

**`saved_replies`** — the reply templates. Keyed to a mailbox (`mailbox_id`) with cascade delete.

**`user_profiles`** — team members. `access.routingRoles` decides which lead categories a person
receives; `access.role` is presence (`active` | `afk`). Both gate assignment, and both fail quietly:

- Away members are excluded from assignment entirely.
- **Admins match every routing role**, so an admin needs no explicit roles.

**`mailboxes_gmailsupportemail`** — the Gmail connection: tokens, `historyId`, and the push-watch
expiry. `mailboxes.gmailSupportEmailId` points at it.

## Jobs and events

There is no external queue. `triggerEvent(name, data)` writes to a **pgmq** queue in Postgres; a
worker consumes it and runs every job registered for that event in
[`jobs/eventCatalog.ts`](../jobs/eventCatalog.ts). Results land in `job_runs` — **the first place to
look when something silently doesn't happen.**

```sql
select created_at, job, status, error
from job_runs
where status = 'error'
order by created_at desc
limit 20;
```

Key chains:

| Event | Jobs |
| --- | --- |
| `conversations/message.created` | index, embeddings, publish, **categorizeConversationToIssueGroup**, generateBackgroundDraft |
| `conversations/issue-group.assigned` | **autoAssignConversation**, checkConditionTemplates, subgroup categorisation |
| `conversations/template-response.check` | **handleTemplateResponse** |
| `conversations/auto-response.create` | handleAutoResponse |
| `gmail/webhook.received` | handleGmailWebhookEvent |

Scheduled jobs (`cronJobs` in [`jobs/index.ts`](../jobs/index.ts), installed by `pnpm db:setup-cron`):

| Schedule | Job |
| --- | --- |
| every 5 min | `checkStaleJobs` |
| hourly | `cleanupDanglingFiles`, `closeInactiveConversations` |
| daily 00:00 | `renewMailboxWatches` — keeps the Gmail push subscription alive |
| daily 02:00 | `autoFollowUpTickets` |
| daily 19:00 | `bulkEmbeddingClosedConversations` |
| weekly | `cleanupIssueSubgroups`, `scheduledWebsiteCrawl` |

`checkStaleJobs` running every 5 minutes is the cheapest liveness check for the worker.

## Inbound mail

1. Google Pub/Sub pushes to `app/api/webhooks/gmail`, verified against `GOOGLE_PUBSUB_CLAIM_EMAIL`.
2. `handleGmailWebhookEvent` pulls new messages from the stored `historyId`, parses each one,
   uploads inline images, and creates the conversation and message.
3. Arrival filters decide `ignoreReason`; anything ignored is stored as `status = "ignored"`.
4. `message.created` fires and triage takes over.

Mail sent **from** the connected mailbox is skipped, which is why the app's own sign-in code emails
never become tickets.

## Rendering and auth

Dashboard routes are server components behind Supabase auth; unauthenticated requests 307 to
`/login`. The conversation list is a client component fed by tRPC (`lib/data/conversation/search.ts`
builds the query). Filters are URL state via `nuqs`, so a filtered inbox is a shareable link.

## Where to start reading

- Changing lead handling → [lead-pipeline.md](./lead-pipeline.md)
- Deploying, scripts, debugging → [operations.md](./operations.md)
- Adding a background job → `jobs/eventCatalog.ts`, then register it in `jobs/index.ts`
- Changing the data model → `db/schema/`, then `pnpm db:generate`
