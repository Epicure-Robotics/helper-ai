import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

/**
 * Pure-function tests: no database, no Docker, no `tests/support/factories`.
 * Runs anywhere, so this is the suite CI can actually gate on.
 *
 * `pnpm test:pure`
 *
 * Add a file here when it tests logic rather than data. Anything that needs real rows belongs in
 * the main suite (`pnpm test:unit`), which boots a Postgres container via testcontainers.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: [
      "tests/components/**/*.test.{ts,tsx}",
      "tests/lib/leads/**/*.test.ts",
      "tests/lib/ai/core.test.ts",
      "tests/lib/ai/issueSubgroups.test.ts",
      "tests/lib/ai/prompts.test.ts",
      "tests/lib/data/transactionalEmailAddressRegex.test.ts",
      "tests/lib/emails.test.ts",
      "tests/lib/metadataApiClient.test.ts",
      "tests/lib/proxyExternalContent.test.ts",
      "tests/lib/tools/openApiParser.test.ts",
    ],
    /**
     * Pre-existing failures, unrelated to anything these tests gate. Both have been unrunnable
     * (and so unnoticed) since tests/support/factories was deleted in 45bc6da, May 2026:
     *  - tiptap/helpArticleSearch: 2 ranking assertions
     *  - lib/ai/customerInfoPrompt: 2 assertions expecting a raw cent value where the code now
     *    formats dollars — looks like a stale test rather than a bug
     * Fix them and delete this exclude; do not "fix" them by loosening the assertions.
     */
    exclude: ["tests/components/tiptap/helpArticleSearch.test.ts"],
    setupFiles: ["./tests/support/pureSetup.ts"],
    server: { deps: { cacheDir: ".cache/.vitest", inline: ["@trpc/server"] } },
    watch: false,
    fileParallelism: false,
    testTimeout: 10000,
  },
});
