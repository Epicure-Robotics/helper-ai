/**
 * Moves conversations that the arrival filters binned from `closed` to `ignored`.
 *
 * handleGmailWebhookEvent used to write `closed` for auto-ignored mail, which made machine noise
 * indistinguishable from tickets a human actually resolved — the Closed tab filled with vendor
 * newsletters while the Ignored tab (which exists, and has a UI tab and a count) stayed empty
 * because nothing ever wrote that status.
 *
 * Anything triage has since identified as a lead is reopened instead of being marked ignored, so
 * enquiries the filter caught before the rescue logic existed come back into the queue.
 *
 * Usage:
 *   pnpm migrate:auto-ignored            # dry run
 *   pnpm migrate:auto-ignored --apply
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import { conversationEvents, conversations } from "@/db/schema";
import { scriptDb, scriptPool } from "./lib/dbOnly";

async function main() {
  const apply = process.argv.includes("--apply");

  const events = await scriptDb
    .select({ conversationId: conversationEvents.conversationId })
    .from(conversationEvents)
    .where(eq(conversationEvents.type, "email_auto_ignored"));

  const ids = [...new Set(events.map((e) => e.conversationId))];
  if (ids.length === 0) {
    console.log("No auto-ignored conversations found.");
    return;
  }

  const rows = await scriptDb
    .select({
      id: conversations.id,
      subject: conversations.subject,
      emailFrom: conversations.emailFrom,
      createdAt: conversations.createdAt,
      inboundTriage: conversations.inboundTriage,
    })
    .from(conversations)
    .where(and(inArray(conversations.id, ids), eq(conversations.status, "closed")))
    .orderBy(desc(conversations.createdAt));

  const rescue = rows.filter((r) => r.inboundTriage?.leadCategoryKey != null);
  const toIgnored = rows.filter((r) => r.inboundTriage?.leadCategoryKey == null);

  console.log(`Auto-ignored conversations still marked closed: ${rows.length}`);
  console.log(`  → ignored (noise, reviewable in the Ignored tab): ${toIgnored.length}`);
  console.log(`  → open (triage says these are leads):             ${rescue.length}`);
  for (const r of rescue) {
    console.log(
      `      ${r.createdAt?.toISOString()}  [${r.inboundTriage?.leadCategoryKey}]  ${String(r.subject).slice(0, 55)}`,
    );
  }

  if (!apply) {
    console.log("\nDry run — nothing written. Re-run with --apply.");
    return;
  }

  if (toIgnored.length > 0) {
    await scriptDb
      .update(conversations)
      .set({ status: "ignored", closedAt: null })
      .where(
        inArray(
          conversations.id,
          toIgnored.map((r) => r.id),
        ),
      );
  }
  if (rescue.length > 0) {
    await scriptDb
      .update(conversations)
      .set({ status: "open", closedAt: null })
      .where(
        inArray(
          conversations.id,
          rescue.map((r) => r.id),
        ),
      );
  }
  console.log(`\nMoved ${toIgnored.length} to ignored and reopened ${rescue.length}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => scriptPool.end());
