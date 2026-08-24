/**
 * Re-triages leads that are already in the inbox.
 *
 * The live pipeline only categorises new mail: `categorizeConversationToIssueGroup` returns early
 * once a conversation has an `inboundTriage` or an `issueGroupId`, so anything that arrived before
 * the lead category map existed keeps its old (or missing) triage.
 *
 * Only touches conversations whose SUBJECT states the category — the website form path, which is
 * certain. Plain-email leads are deliberately left alone: re-triaging those needs the model, and
 * silently rewriting historical routing on a guess is not worth it.
 *
 * Uses Supabase Postgres only (no OpenAI keys)—set POSTGRES_URL or DATABASE_URL.
 *
 * Usage:
 *   pnpm backfill:lead-categories            # dry run, prints what would change
 *   pnpm backfill:lead-categories --apply    # writes
 */

import { eq, isNull } from "drizzle-orm";
import { conversations, issueGroups } from "@/db/schema";
import { assignedToAiFromTriage } from "@/lib/leads/inboundTriage";
import { leadCategoryTriage, parseWebsiteLeadSubject } from "@/lib/leads/leadCategory";
import { scriptDb, scriptPool } from "./lib/dbOnly";

async function main() {
  const apply = process.argv.includes("--apply");

  const groups = await scriptDb.select({ id: issueGroups.id, title: issueGroups.title }).from(issueGroups);
  const groupIdByTitle = new Map(groups.map((g) => [g.title, g.id]));

  // Already-triaged lead conversations are left alone unless they never got a category.
  const candidates = await scriptDb
    .select({
      id: conversations.id,
      subject: conversations.subject,
      issueGroupId: conversations.issueGroupId,
      inboundTriage: conversations.inboundTriage,
    })
    .from(conversations)
    .where(isNull(conversations.mergedIntoId));

  let matched = 0;
  let skippedAlreadyCategorised = 0;
  let missingGroup = 0;
  const changes: string[] = [];

  for (const conversation of candidates) {
    const parsed = parseWebsiteLeadSubject(conversation.subject);
    if (!parsed?.spec) continue;
    matched++;

    if (conversation.inboundTriage?.leadCategoryKey === parsed.spec.key) {
      skippedAlreadyCategorised++;
      continue;
    }

    const groupId = groupIdByTitle.get(parsed.spec.issueGroupTitle) ?? null;
    if (groupId == null) {
      missingGroup++;
      continue;
    }

    const triage = leadCategoryTriage({
      spec: parsed.spec,
      source: "website_form",
      confidence: 1,
      rawLabel: parsed.rawLabel,
      leadName: parsed.leadName,
      issueGroupId: groupId,
    });

    changes.push(
      `#${conversation.id} → ${parsed.spec.issueGroupTitle} (priority ${parsed.spec.priority}, route ${parsed.spec.routingRole})`,
    );

    if (apply) {
      await scriptDb
        .update(conversations)
        .set({
          inboundTriage: triage,
          issueGroupId: groupId,
          assignedToAI: assignedToAiFromTriage(triage),
        })
        .where(eq(conversations.id, conversation.id));
    }
  }

  console.log(`Scanned ${candidates.length} conversations.`);
  console.log(`Website-form leads found: ${matched}`);
  console.log(`Already on the right category: ${skippedAlreadyCategorised}`);
  if (missingGroup > 0) {
    console.warn(`No matching issue group for ${missingGroup} lead(s) — run pnpm sync:epicure-issue-groups first.`);
  }
  console.log(`${apply ? "Updated" : "Would update"} ${changes.length} conversation(s):`);
  for (const line of changes) console.log(`  ${line}`);

  if (!apply && changes.length > 0) {
    console.log("\nDry run — nothing written. Re-run with --apply to commit these changes.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => scriptPool.end());
