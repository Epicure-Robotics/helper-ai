// One-time fix: restore conversationProvider="gmail" for conversations that were
// incorrectly set to "chat" by handleAutoResponse/handleTemplateResponse, but have
// Gmail thread IDs on their messages.
import { inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { conversations } from "@/db/schema";

const DRY_RUN = process.argv.includes("--dry-run");

console.log(DRY_RUN ? "🔍 DRY RUN — no changes will be made\n" : "🔧 LIVE RUN — changes will be applied\n");

// Find conversations marked as "chat" but with at least one message that has a gmailThreadId
const affected = await db.execute(sql`
  SELECT DISTINCT c.id, c.slug, c.conversation_provider, c.status, c.email_from
  FROM conversations_conversation c
  INNER JOIN messages m ON m.conversation_id = c.id
  WHERE c.conversation_provider = 'chat'
    AND m.gmail_thread_id IS NOT NULL
    AND m.deleted_at IS NULL
  ORDER BY c.id
`);

console.log(`Found ${affected.rows.length} affected conversations:\n`);

for (const row of affected.rows as any[]) {
  console.log(`  [${row.id}] slug=${row.slug} status=${row.status} email_from=${row.email_from}`);
}

if (affected.rows.length === 0) {
  console.log("✅ Nothing to fix.");
  process.exit(0);
}

if (DRY_RUN) {
  console.log("\n✅ Dry run complete. Run without --dry-run to apply fixes.");
  process.exit(0);
}

const ids = (affected.rows as any[]).map((r) => r.id as number);

await db.update(conversations).set({ conversationProvider: "gmail" }).where(inArray(conversations.id, ids));

console.log(`\n✅ Fixed ${ids.length} conversations — conversationProvider restored to "gmail".`);
