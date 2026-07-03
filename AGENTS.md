# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Project Overview

Epicure Assist is an AI-assisted team inbox for Epicure Robotics: email (Gmail) and a customizable chat widget, built on Next.js 15 (App Router) with real-time updates and background jobs.

## Development Commands

```bash
pnpm install
pnpm run local:prod
pnpm run db:generate
```

### Build & Quality

```bash
# Type checking
pnpm tc               # Quick tsc check
pnpm tc:w             # Watch mode

# Linting & Formatting
pnpm lint             # Run ESLint on all packages
pnpm format           # Check Prettier formatting
```

## Architecture

### Tech Stack

- **Framework**: Next.js 15 (App Router, React Server Components, Server Actions)
- **Database**: Supabase (managed PostgreSQL) with Drizzle ORM — plan on one Supabase project per environment
- **API Layer**: tRPC for type-safe APIs + Next.js Route Handlers for webhooks
- **Styling**: Tailwind CSS 4 with Radix UI components
- **AI**: OpenAI & Fireworks AI (via Vercel AI SDK)
- **Real-time**: Supabase Realtime for live updates
- **Background Jobs**: Custom job system in `/jobs` directory
- **Testing**: Vitest (unit), Playwright (E2E), Evalite (AI evals)
- **Monitoring**: Sentry, OpenTelemetry

### Key Directories

```
app/                      # Next.js App Router
├── (dashboard)/          # Main authenticated app routes
│   ├── [category]/       # Ticket views (inbox, mine, closed, etc.)
│   │   ├── conversation/ # Ticket detail & reply components
│   │   ├── list/         # Ticket list & filters
│   │   └── ticketCommandBar/ # Command palette for tickets
│   ├── settings/         # Settings pages (team, integrations, tools, knowledge)
│   ├── saved-replies/    # Saved reply templates
│   └── sessions/         # Widget session recordings
├── api/                  # REST API endpoints & webhooks
│   ├── chat/             # Widget chat API (public)
│   ├── guide/            # Interactive guide/onboarding API
│   ├── webhooks/         # Gmail, GitHub, Firecrawl webhooks
│   └── connect/          # OAuth callbacks (Google, GitHub)
├── login/                # Authentication & onboarding
└── widget/               # Embeddable chat widget routes

components/               # Shared React components
├── ui/                   # Base UI components (shadcn/ui pattern)
├── widget/               # Widget-specific components
└── tiptap/               # Rich text editor components

db/                       # Database layer
├── schema/               # Drizzle ORM schema definitions
├── drizzle/              # Generated migrations
├── seeds/                # Database seed scripts
└── drizzle.config.ts     # Drizzle configuration

jobs/                     # Background job definitions
├── trigger.ts            # Job scheduler/runner
└── *.ts                  # Individual job handlers (Gmail sync, embeddings, auto-assign, etc.)

lib/                      # Shared business logic
├── ai/                   # AI/LLM integrations & prompts
├── data/                 # Data access layer (DB queries)
├── auth/                 # Authentication utilities
├── gmail/                # Gmail API client
├── github/               # GitHub integration
├── supabase/             # Supabase client (server & client)
├── realtime/             # Realtime pub/sub
└── emails.ts             # Email utilities

trpc/                     # tRPC API
├── router/               # tRPC routers (organization, user, etc.)
└── trpc.ts               # tRPC initialization & procedures

packages/                 # Publishable packages (monorepo)
├── client/               # @helperai/client - API client SDK
├── react/                # @helperai/react - React components SDK
└── sdk/                  # @helperai/sdk - Core SDK types

tests/                    # Test files
├── e2e/                  # Playwright E2E tests
├── evals/                # AI evaluation tests
└── support/              # Test utilities & setup
```

### Database Architecture (Drizzle ORM)

Schema located in `db/schema/`. Key tables:

- **conversations**: Support tickets/conversations
- **conversationMessages**: Messages within conversations
- **userProfiles**: Team member profiles
- **mailboxes**: Organization/workspace settings
- **platformCustomers**: End-user customers
- **gmailSupportEmails**: Connected Gmail accounts
- **storedTools**: User-defined API tools for AI
- **savedReplies**: Template responses
- **notes**: Internal ticket notes
- **aiUsageEvents**: AI usage tracking
- **issueGroups**: Common issue categorization
- **websites**: Crawled knowledge base content

All queries use Drizzle ORM. Migrations auto-generated with `pnpm db:generate`.

### tRPC Architecture

tRPC provides type-safe APIs for the dashboard. Routers in `trpc/router/`.

- **publicProcedure**: Unauthenticated (can access user if logged in)
- **protectedProcedure**: Requires authentication

### API Routes

Next.js Route Handlers handle external integrations:

- `/api/chat/*` - Widget chat API (public, HMAC authenticated)
- `/api/webhooks/*` - External service webhooks
- `/api/connect/*` - OAuth flow handlers
- `/api/guide/*` - Interactive guide system

### Background Jobs

Jobs in `/jobs/` handle async work:

- Gmail sync (`handleGmailWebhookEvent`, `importGmailThreads`)
- AI embeddings (`embeddingConversation`, `embeddingFaq`)
- Auto-assignment & auto-response (`autoAssignConversation`, `handleAutoResponse`)
- Notifications (`notifyVipMessage`, `createWebNotificationForAssignee`)
- Email archiving (`archiveGmailThread`)
- Website crawling (`crawlWebsite`, `scheduledWebsiteCrawl`)

Triggered via `/api/job` endpoint or scheduled via Supabase pg_cron.

### AI Integration

AI functionality in `lib/ai/`:

- **prompts.ts**: System prompts for customer support
- **chat.ts**: Main chat completion logic
- **tools.ts**: AI function calling tools
- **core.ts**: Core AI utilities
- **guide.ts**: Interactive guide logic

Uses Vercel AI SDK with OpenAI and Fireworks models.

### Widget Architecture

Customer-facing chat widget:

- Entry point: `app/widget/[name]/route.tsx` serves `public/sdk.js`
- Widget frontend: `packages/client/` and `packages/react/`
- Backend: `app/api/chat/` handles messages
- Sessions: Recorded in `guideSession` table, viewable at `/sessions`

### Environment Variables

Required for local development (see [`.env.example`](.env.example); copy to `.env.local`). **Plan on Supabase only:** each environment is one Supabase project (PostgreSQL + Auth API).

- `OPENAI_API_KEY` - OpenAI API key (required)
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` - Supabase Dashboard → API
- `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING` - Supabase Dashboard → Database (pooler + direct/session strings)
- `AUTH_URL` - Public URL of this app (matches Supabase Auth redirect configuration)

Optional integrations (can use placeholders initially):

- Gmail, GitHub, Firecrawl

Use `pnpm with-dev-env <command>` to run commands with dev environment variables loaded.

## Development Workflow

### Making Schema Changes

1. Edit schema files in `db/schema/`
2. Generate migration: `pnpm db:generate`
3. Review generated SQL in `db/drizzle/`
4. Apply migration: `pnpm db:migrate`

### Running Tests

- Unit tests use Vitest with test containers for isolated PostgreSQL
- E2E tests use Playwright against local dev server
- AI evals use Evalite framework in `tests/evals/`

### Local SSL Setup

The app uses local SSL certificates for `helperai.dev` by default (upstream local hostname; set `AUTH_URL` / `NEXT_PUBLIC_DEV_HOST` for your deployment).

- Auto-generated on first `pnpm dev`
- Uses mkcert (must be installed, see README)
- Served via nginx proxy in Docker

### Working with Packages

Monorepo uses pnpm workspaces:

- `packages/client/` - API client
- `packages/react/` - React components
- `packages/sdk/` - Shared types

Changes to packages require rebuild: `pnpm build` (or auto-rebuilt on `pnpm dev`).

### Email Development

Preview emails at http://localhost:3060 when running `pnpm dev:email`.
Email templates in `lib/emails/`.

## Code Patterns

### Data Fetching

- Server Components: Direct database queries via `lib/data/`
- Client Components: tRPC hooks or fetch via Route Handlers
- Real-time updates: Supabase Realtime in `lib/realtime/`

### Styling

- Tailwind CSS 4 (uses `@import` in CSS files)
- Component library: Radix UI primitives in `components/ui/`
- Follow existing patterns for consistency

### Error Handling

- Use Sentry for error tracking (auto-configured)
- tRPC errors throw `TRPCError` with appropriate codes
- Route Handlers return `NextResponse` with proper status codes

## Important Notes

- **React Server Conditions**: Some scripts use `--conditions=react-server` to properly load server-only modules
- **Supabase Network**: Local Supabase runs in Docker network `supabase_network_helper`
- **Turbopack**: Dev server uses Turbopack for faster builds
- **pnpm**: This project requires pnpm (not npm/yarn)
- **Build Order**: Packages must build before main app (`pnpm run-on-packages build`)
