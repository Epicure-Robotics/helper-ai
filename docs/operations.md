# Operations

Running, deploying, and debugging Epicure Assist.

## ⚠️ `.env.local` points at the real database

Every "local" script resolves env as `.env.production` → `.env.development.local` → `.env.local`
(see `with-dev-env` in `package.json`). On the current setup `.env.local` holds a **remote Supabase
pooler URL**, so these run against the live database despite their names:

| Command | What it actually does |
| --- | --- |
| `pnpm db:migrate` | Migrates the remote database |
| `pnpm db:seed` | Seeds the remote database |
| `pnpm db:reset` | **Drops and recreates the remote database** |

`db:reset` is the dangerous one. It deletes the mailbox row, `saved_replies` cascade with it, and
`issue_groups.default_saved_reply_id` has no foreign key — so the groups survive pointing at dead
templates and replies stop with no error. Check where `POSTGRES_URL` points before running any of
these:

```bash
grep -E "^POSTGRES_URL=" .env.local | sed -E 's|://[^:]*:[^@]*@|://<redacted>@|'
```

## Local development

```bash
pnpm install
pnpm dev              # full stack: Supabase + nginx + Next (needs Docker)
pnpm next dev -p 3010 # just the app, against whatever POSTGRES_URL resolves to
```

`pnpm dev` starts a local Supabase and an nginx TLS proxy via Docker. Without Docker, run Next
directly — but see the warning above about which database you are then using.

## Testing

```bash
pnpm test:pure    # 133 pure-function tests. No Docker, no database. Runs in CI
pnpm test:unit    # full suite — boots a Postgres container via testcontainers
pnpm tc           # typecheck
pnpm lint
```

**`pnpm test:pure` is the suite CI gates on** (`.github/workflows/test.yml`). Add logic tests there;
anything needing real rows belongs in the main suite. Two files are excluded in
`vitest.pure.config.mts` for pre-existing failures — the comment there says which and why.

> `tests/support/factories` was deleted by accident in `45bc6da` (May 2026), which broke 41 test
> files *and* `db/seeds/seedDatabase.ts` for four months. It has been restored from history. If the
> whole suite suddenly stops compiling, check that directory still exists.

## Deploying

Push to `main`. [`deploy-aws.yml`](../.github/workflows/deploy-aws.yml) builds an image, pushes to
ECR, **runs `drizzle-kit migrate`**, and triggers App Runner. Takes about 10 minutes.

Do not run `db:prod:migrate` by hand — the pipeline does it.

Verify a deploy landed by watching `job_runs` rather than trusting the workflow badge:

```sql
select created_at, job, status, error from job_runs
order by created_at desc limit 20;
```

A deploy that "succeeded" while jobs keep failing on old behaviour means the container has not
swapped yet.

## Scripts

All are **dry-run by default**; pass `--apply` to write.

| Command | Purpose |
| --- | --- |
| `pnpm sync:epicure-issue-groups` | Upsert the 12 issue groups and their reply templates. Creates missing ones; **never overwrites `autoResponseEnabled`** on existing rows — that toggle is the team's |
| `pnpm team:default-roles` | Give members sensible routing roles. `--activate` also clears "away" presence |
| `pnpm backfill:lead-categories` | Re-file existing website-form leads onto the category map |
| `pnpm migrate:auto-ignored` | Move auto-ignored conversations from `closed` to `ignored` |
| `pnpm retriage:ignored` | Re-queue triage for ignored mail so the lead rescue can reopen leads. `--days=N` bounds it |
| `pnpm import:epicure-website-leads` | Enqueue a Gmail backlog import |

## First-time setup

Order matters — **deploy before seeding groups.** Creating issue groups while an older container is
running can hand its template responder everything it needs to start emailing customers.

1. Deploy (migrations run automatically).
2. `pnpm sync:epicure-issue-groups`
3. `pnpm team:default-roles --apply`
4. Settings → Integrations → **Connect Gmail**. This also subscribes the push watch and imports
   recent threads — no separate steps.
5. Settings → Common Issues → write a **Standard answer** for any category whose auto-reply is on.
6. Send a test submission through the website form and confirm the category, priority, and assignee.

### Changing the connected mailbox

Disconnect and reconnect in Settings → Integrations. **Nothing needs redoing.** Issue groups are not
scoped to a mailbox, saved replies hang off the mailbox row (which is not deleted), and routing roles
live on user profiles. Only the Gmail row is replaced.

## Debugging

**Mail isn't appearing.** Check the sort control first — the inbox defaults to **oldest-first**, so
the newest conversation is at the *bottom*. Then check whether it was auto-ignored:

```sql
select status, count(*) from conversations_conversation group by status;

select reason, count(*) from conversations_conversationevent
where type = 'email_auto_ignored' group by reason;
```

Mail sent *from* the connected address is skipped by design — the app's own sign-in codes never
become tickets.

**Nothing is being categorised.** Look for `categorizeConversationToIssueGroup` in `job_runs`. Two
historical failures both silently disabled all triage:

- `Invalid schema for function 'json': ... got 'type: "None"'` — the AI schema is not a flat object.
- `No object generated: response did not match schema` — the model returned a shape zod rejects.

**Leads aren't being assigned.** Two quiet gates, both in `autoAssignConversation`:

- Everyone is marked **away** → no assignable members at all.
- Nobody holds the routing role → falls back to round-robin. High-priority leads now report this to
  Sentry; lower priorities only warn.

`pnpm team:default-roles` shows both.

**Auto-replies aren't sending.** Walk the gates in order: is it the first message (drafts don't
count), is `autoResponseEnabled` on for that group, is an AI-inferred category above 0.7, does the
template contain `{variables}`. See [lead-pipeline.md](./lead-pipeline.md#auto-reply-gates).

**Replies look broken.** `Hi {Jane Doe},` means a template used `{{name}}` instead of `{name}`.

## Known gaps

- The **priority badge and filter have not been verified in a browser**. They typecheck, build, and
  render server-side without error, but nobody has clicked them.
- The **Gmail → webhook leg is unproven with a real website form submission**; every test so far has
  injected conversations directly.
- Two pure tests are excluded from CI for pre-existing failures (see `vitest.pure.config.mts`).
