import { createEnv } from "@t3-oss/env-nextjs";
import { vercel } from "@t3-oss/env-nextjs/presets";
import { z } from "zod";

/** Dotenv `KEY=` is read as ""; Zod `.optional()` only treats `undefined`. */
function emptyUnsetOptString() {
  return z.preprocess(
    (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().min(1).optional(),
  );
}

function emptyUnsetOptEmail() {
  return z.preprocess(
    (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().email().optional(),
  );
}

function emptyUnsetOptUrl() {
  return z.preprocess(
    (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().url().optional(),
  );
}

const defaultUnlessDeployed = <V extends z.ZodString | z.ZodOptional<z.ZodString>>(value: V, testingDefault: string) =>
  ["preview", "production"].includes(process.env.VERCEL_ENV ?? "") ? value : value.default(testingDefault);

const defaultRootUrl =
  process.env.VERCEL_ENV === "production"
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : `https://${process.env.VERCEL_URL ?? "helperai.dev"}`;

// `next dev` forces NODE_ENV to "development" so we need to use a different environment variable
export const isAIMockingEnabled = process.env.IS_TEST_ENV === "1";

export const env = createEnv({
  extends: [vercel()],
  shared: {
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    CI: z
      .enum(["true", "false", "1", "0"])
      .default("false")
      .transform((v) => v === "true" || v === "1"),
    DISABLE_STRICT_MODE: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
  },
  /**
   * Specify your server-side environment variables schema here.
   * This way you can ensure the app isn't built with invalid env vars.
   */
  server: {
    // Set this for both local development and when deploying
    OPENAI_API_KEY: isAIMockingEnabled ? z.string().min(1).default("mock-openai-api-key") : z.string().min(1), // API key from https://platform.openai.com for AI models
    // Optional — not wired in Epicure inbox; use when adding OpenRouter-backed models.
    OPENROUTER_API_KEY: isAIMockingEnabled
      ? z.string().min(1).default("mock-openrouter-api-key")
      : emptyUnsetOptString(),

    // SMTP for outbound email (OTP codes, follower notifications).
    // Gmail: SMTP_USER is your address, SMTP_PASSWORD is a 16-char App Password
    // (https://myaccount.google.com/apppasswords).
    SMTP_HOST: z.preprocess(
      (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v),
      z.string().min(1).default("smtp.gmail.com"),
    ),
    SMTP_PORT: z.preprocess(
      (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v),
      z.coerce.number().int().positive().default(465),
    ),
    SMTP_USER: emptyUnsetOptString(),
    SMTP_PASSWORD: emptyUnsetOptString(),
    SMTP_FROM_ADDRESS: emptyUnsetOptEmail(),
    GOOGLE_CLIENT_ID: emptyUnsetOptString(), // Google OAuth client credentials from https://console.cloud.google.com for Gmail sync
    GOOGLE_CLIENT_SECRET: emptyUnsetOptString(),
    GOOGLE_PUBSUB_TOPIC_NAME: emptyUnsetOptString(), // Google PubSub for Gmail sync
    GOOGLE_PUBSUB_CLAIM_EMAIL: emptyUnsetOptEmail(),

    // Web Push Notifications (generate keys with: npx web-push generate-vapid-keys)
    VAPID_PRIVATE_KEY: emptyUnsetOptString(), // Private key for web push (server-side only)
    VAPID_MAILTO: emptyUnsetOptString(), // Contact email for web push (can be plain email or mailto: URL)

    // Set these when deploying if you're not using Vercel with the Supabase integration
    AUTH_URL: z.string().url().default(defaultRootUrl), // The root URL of the app; legacy name which was required by next-auth
    // Supabase PostgreSQL: Dashboard → Database → Connection string. Pooler URL for app/worker; non-pooling for migrations when split.
    POSTGRES_URL: defaultUnlessDeployed(
      z.string().url(),
      `postgresql://postgres:postgres@127.0.0.1:${process.env.LOCAL_SUPABASE_DB_PORT}/postgres`,
    ),
    POSTGRES_URL_NON_POOLING: defaultUnlessDeployed(
      z.string().url(),
      // Direct / session URI from Supabase (or same as POSTGRES_URL for local CLI)
      `postgresql://postgres:postgres@127.0.0.1:${process.env.LOCAL_SUPABASE_DB_PORT}/postgres`,
    ),
    // Optional; drizzle-kit uses DATABASE_URL if set, else POSTGRES_URL (see db/drizzle.config.ts)
    DATABASE_URL: emptyUnsetOptUrl(),
    // Based on Supabase's default local development secret ("super-secret-jwt-token-with-at-least-32-characters-long")
    SUPABASE_SERVICE_ROLE_KEY: defaultUnlessDeployed(
      z.string().min(1),
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU",
    ),
    NEXT_RUNTIME: z.enum(["nodejs", "edge"]).default("nodejs"),

    // Other optional integrations

    // GitHub app credentials from https://github.com/apps
    GITHUB_APP_SLUG: emptyUnsetOptString(),
    GITHUB_APP_ID: emptyUnsetOptString(),
    GITHUB_CLIENT_SECRET: emptyUnsetOptString(),
    GITHUB_PRIVATE_KEY: emptyUnsetOptString(),
    // Token from https://jina.ai for the widget to read the current page
    JINA_API_TOKEN: emptyUnsetOptString(),
    // API key from https://www.firecrawl.dev to import help docs from a website
    FIRECRAWL_API_KEY: emptyUnsetOptString(),
    // Proxy assets when rendering email content
    PROXY_URL: emptyUnsetOptUrl(),
    PROXY_SECRET_KEY: emptyUnsetOptString(),
    // Sign in with Apple credentials for integration with the desktop app
    APPLE_APP_ID: emptyUnsetOptString(),
    APPLE_TEAM_ID: emptyUnsetOptString(),
    APPLE_PRIVATE_KEY: emptyUnsetOptString(),
    APPLE_PRIVATE_KEY_IDENTIFIER: emptyUnsetOptString(),
    // Cal.com API integration for webhook handling
    CAL_API_KEY: emptyUnsetOptString(), // API key from https://cal.com for webhook integration

    // Optional configuration

    // Allow automatic signups from specific domains (e.g. your company's email domain)
    EMAIL_SIGNUP_DOMAINS: z
      .string()
      .default("")
      .transform((v) => (v ? v.split(",").map((d) => d.trim()) : [])),

    // Optional Redis URL (e.g. Upstash) — speeds up cacheFor (embeddings, sample questions, chat cache)
    REDIS_URL: emptyUnsetOptUrl(),

    // Log SQL queries to the console
    DRIZZLE_LOGGING: z.string().optional(),
    
    // Simulate network latency in development for testing waterfall detection
    SIMULATE_NETWORK_LATENCY: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    SUBCATEGORY_CLASSIFICATION_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),

    // For running database seeds (comma-separated). Override in production — do not reuse upstream Helper mailboxes.
    INITIAL_USER_EMAILS: z
      .string()
      .default("epicure-seed@example.com")
      .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),

    /**
     * Epicure: which deployment tier this instance is (for logging, docs, future guards).
     * Use a separate Supabase project per tier in production—one `POSTGRES_URL` cannot serve both dev and prod safely.
     */
    EPICURE_DEPLOYMENT: z.enum(["local", "preview", "production"]).default("local"),
    /**
     * Expected primary support Gmail for website form notifications in this environment.
     * Should match the inbox you connect via OAuth (e.g. prod: connect@epicurerobotics.com, dev: your test Gmail).
     */
    EPICURE_PRIMARY_SUPPORT_EMAIL: emptyUnsetOptEmail(),

    /**
     * Optional: public base URL Supabase pg_cron should POST job payloads to (no trailing slash).
     * Use when the app is not reachable at AUTH_URL from the database (rare). Local Docker Supabase
     * uses host.docker.internal automatically when POSTGRES_URL points at localhost.
     */
    JOB_WORKER_URL: emptyUnsetOptUrl(),
  },

  /**
   * Specify your client-side environment variables schema here.
   * For them to be exposed to the client, prefix them with `NEXT_PUBLIC_`.
   */
  client: {
    NEXT_PUBLIC_SUPABASE_URL: defaultUnlessDeployed(z.string().url().min(1), "https://supabase.helperai.dev"),
    // Based on Supabase's default local development secret ("super-secret-jwt-token-with-at-least-32-characters-long")
    NEXT_PUBLIC_SUPABASE_ANON_KEY: defaultUnlessDeployed(
      z.string().min(1),
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0",
    ),

    NEXT_PUBLIC_SENTRY_DSN: z.string().optional(), // Sentry DSN for error tracking

    // Helper host URL configuration - overrides automatic detection in e2e tests
    NEXT_PUBLIC_DEV_HOST: z.preprocess(
      (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v),
      z.string().url().optional().default("https://helperai.dev"),
    ),

    // Web Push Notifications - public VAPID key needs to be exposed to client for push subscriptions
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: emptyUnsetOptString(),
  },
  /**
   * Destructure all variables from `process.env` to make sure they aren't tree-shaken away.
   */
  experimental__runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    CI: process.env.CI,
    DISABLE_STRICT_MODE: process.env.DISABLE_STRICT_MODE,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_DEV_HOST: process.env.NEXT_PUBLIC_DEV_HOST,
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  },
  skipValidation: process.env.npm_lifecycle_event === "lint" || process.env.NODE_ENV === "test",
});
