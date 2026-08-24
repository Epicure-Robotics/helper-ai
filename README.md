# Epicure Assist

Internal inbox and AI assistant for **Epicure Robotics**. Website contact-form leads and customer
email arrive in Gmail, get **categorised and prioritised**, are routed to the right person, and
receive an acknowledgement — while the substantive reply stays with a human.

Upstream code is MIT-licensed; this deployment is Epicure-only.

## Documentation

| Doc | Read it when |
| --- | --- |
| **[docs/lead-pipeline.md](docs/lead-pipeline.md)** | Changing how leads are categorised, prioritised, routed, or replied to. **Start here** — it has the gotchas |
| **[docs/architecture.md](docs/architecture.md)** | Understanding the stack, data model, jobs, and events |
| **[docs/operations.md](docs/operations.md)** | Deploying, running scripts, or debugging something that isn't happening |

## What it does

**Two lead types**, distinguished by who owns the machine:

- **Franchise / purchase** — they buy it and operate it → **high priority**, straight to founders
- **Placement** — Epicure owns it, they host it at their site → high in Bengaluru, medium elsewhere

Plus events & bulk, general product enquiries, and a catch-all. Six categories, mirroring the
"What's this about?" dropdown on epicurerobotics.com.

**Two inbound channels, one taxonomy.** The website form states its category in the subject
(`New Lead [Franchise / machine purchase]: …`), so it is read directly — no AI call. Plain email is
classified by the model into the *same* six categories, and above a confidence bar gets identical
priority, routing, and templates. Handling never depends on which channel a lead used.

**Priority drives everything** — routing role, whether the AI may reply, and a badge and filter in
the inbox.

## Quick start

```sh
pnpm install
pnpm dev          # Supabase + nginx + Next (needs Docker)
pnpm test:pure    # 133 tests, no Docker
```

> **Check which database you're pointed at first.** Scripts resolve `.env.production` →
> `.env.development.local` → `.env.local`, and `.env.local` currently holds a **remote** Postgres
> URL — so `pnpm db:reset` would drop the live database. See
> [docs/operations.md](docs/operations.md#️-envlocal-points-at-the-real-database).

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) — for local Supabase and the full test suite
- [Node.js](https://nodejs.org/) — version in [`.node-version`](.node-version)
- `mkcert` for local HTTPS: `brew install mkcert nss` (macOS) or `choco install mkcert` (Windows)

### Environment

Copy [`.env.example`](.env.example) to `.env.local` and point it at your own Supabase project. Use
Epicure Gmail OAuth clients — never upstream production credentials.

You need: a Supabase project (API keys + both Postgres URLs), `AUTH_URL`, Google OAuth and Pub/Sub,
`OPENAI_API_KEY`, and a **job worker on the same `POSTGRES_URL`** so pgmq jobs actually run.

## Setting it up

Order matters — **deploy before seeding issue groups**. Full walkthrough in
[docs/operations.md](docs/operations.md#first-time-setup).

```sh
# after deploying
pnpm sync:epicure-issue-groups     # 12 categories + reply templates
pnpm team:default-roles --apply    # routing roles so leads get assigned
```

Then Settings → Integrations → **Connect Gmail** (this also subscribes the push watch and imports
recent threads), and Settings → Common Issues → write a **Standard answer** for any category whose
auto-reply is on.

## Deployment

Push to `main`. [`.github/workflows/deploy-aws.yml`](.github/workflows/deploy-aws.yml) builds an
image, pushes to **ECR**, runs migrations, and deploys to **AWS App Runner** (~10 min).
[`test.yml`](.github/workflows/test.yml) runs `pnpm test:pure` on every push and PR.

Do not run `db:prod:migrate` by hand — the pipeline does it.

## Behaviour worth knowing

- **Draft-first.** `autoRespondEmailToChat: "draft"` means AI output is a draft for review. The
  templated acknowledgement is the one thing that sends on its own, and only for categories with
  auto-response enabled — currently the two high-priority ones.
- **Standard answers.** Set one per category and it becomes the *only* source of facts in that
  category's replies. Leave it empty and the model answers from the knowledge base.
- **Auto-ignore is reversible.** Junk-labelled mail is stored as `ignored`, not `closed`, and triage
  still runs on it — anything identified as a lead is reopened automatically.
- **The inbox sorts oldest-first by default.** The newest conversation is at the bottom.
- **Send throttle:** 30/hour — [`lib/leads/sendThrottle.ts`](lib/leads/sendThrottle.ts).

## License

See [LICENSE.md](LICENSE.md) (MIT; includes upstream copyright).
