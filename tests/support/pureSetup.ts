/**
 * Setup for the pure-function test project (see vitest.pure.config.mts).
 *
 * Deliberately does NOT touch the database: no `inject("TEST_DATABASE_URL")`, no `truncateDb()`,
 * no global setup. That is what lets these tests run anywhere — CI included — without Docker.
 * Tests needing real rows belong in the main suite (`pnpm test:unit`) instead.
 */
import "@testing-library/jest-dom/vitest";
import { afterAll, beforeAll, vi } from "vitest";

beforeAll(() => {
  vi.mock("@/lib/env", () => ({
    isAIMockingEnabled: false,
    env: {
      POSTGRES_URL: "postgresql://test:test@localhost:5432/test",
      CRYPTO_SECRET: "secret",
      AUTH_URL: "http://localhost:1234",
      NODE_ENV: "test",
      GOOGLE_PUBSUB_CLAIM_EMAIL: "service-push-authentication@helper-ai-413611.iam.gserviceaccount.com",
      OPENAI_API_KEY: "test-openai-api-key",
      ADDITIONAL_PAID_ORGANIZATION_IDS: "org_1234567890",
    },
  }));

  vi.stubEnv("OPENAI_API_KEY", "test-openai-api-key");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");

  vi.mock("server-only", () => ({}));

  vi.mock("react", async (importOriginal) => {
    const testCache = <T extends (...args: unknown[]) => unknown>(func: T) => func;
    const originalModule = await importOriginal<typeof import("react")>();
    return { ...originalModule, cache: testCache };
  });
});

afterAll(() => {
  vi.resetAllMocks();
});
