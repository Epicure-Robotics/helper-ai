/**
 * Re-runs triage over auto-ignored mail so the lead rescue in categorizeConversationToIssueGroup
 * can pull genuine enquiries back into the queue.
 *
 * Needed once: triage failed on every message until the AI schema was fixed, so nothing that
 * arrived before then has an inbound_triage to rescue on. Enqueues the normal
 * `conversations/message.created` event rather than calling the model here, so the worker does the
 * work and the path exercised is exactly the live one.
 *
 * Costs one model call per conversation, so it is windowed by default.
 *
 * Usage:
 *   pnpm retriage:ignored                 # dry run, last 30 days
 *   pnpm retriage:ignored --days=90
 *   pnpm retriage:ignored --apply
 */

import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { enqueueEventWithDb } from "@/jobs/enqueueEvent";
import { conversationMessages, conversations } from "@/db/schema";
import { scriptDb, scriptPool } from "./lib/dbOnly";

async function main() {
  const apply = process.argv.includes("--apply");
  const daysArg = process.argv.find((a) => a.startsWith("--days="));
  const days = daysArg ? Number(daysArg.split("=")[1]) : 30;
  if (!Number.isFinite(days) || days <= 0) {
    console.error("--days must be a positive number");
    process.exit(1);
  }
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await scriptDb
    .select({ id: conversations.id, subject: conversations.subject, createdAt: conversations.createdAt })
    .from(conversations)
    .where(
      and(
        eq(conversations.status, "ignored"),
        isNull(conversations.inboundTriage),
        gte(conversations.createdAt, since),
      ),
    )
    .orderBy(desc(conversations.createdAt));

  console.log(`Untriaged ignored conversations in the last ${days} day(s): ${rows.length}`);
  if (rows.length === 0) return;

  let queued = 0;
  for (const c of rows) {
    const message = await scriptDb.query.conversationMessages.findFirst({
      where: and(eq(conversationMessages.conversationId, c.id), eq(conversationMessages.role, "user")),
      orderBy: (m, { asc }) => [asc(m.createdAt)],
      columns: { id: true },
    });
    if (!message) continue;

    console.log(`  ${apply ? "queue" : "would queue"}  ${c.createdAt?.toISOString()}  ${String(c.subject).slice(0, 58)}`);
    if (apply) {
      await enqueueEventWithDb(scriptDb, "conversations/message.created", { messageId: message.id });
    }
    queued++;
  }

  console.log(`\n${apply ? "Queued" : "Would queue"} ${queued} conversation(s) for re-triage.`);
  if (apply) console.log("Leads found will be reopened automatically; everything else stays ignored.");
  else console.log("Dry run — nothing queued. Re-run with --apply.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => scriptPool.end());
