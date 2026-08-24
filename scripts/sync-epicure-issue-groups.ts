/**
 * Upserts issue_groups + linked saved_replies to match lib/epicure/issueGroupSpecs.ts.
 * Missing groups (e.g. the website form categories) are created with their saved reply.
 *
 * Uses Supabase Postgres only (no full app env)—set POSTGRES_URL or DATABASE_URL for the target project, or local Supabase port.
 *
 * Usage: pnpm sync:epicure-issue-groups
 */

import { eq } from "drizzle-orm";
import { issueGroups, savedReplies } from "@/db/schema";
import { ALL_EPICURE_ISSUE_GROUP_SPECS } from "@/lib/epicure/issueGroupSpecs";
import { scriptDb, scriptPool } from "./lib/dbOnly";

async function main() {
  const mailbox = await scriptDb.query.mailboxes.findFirst({
    columns: { id: true },
    orderBy: (m, { asc }) => [asc(m.id)],
  });

  if (!mailbox) {
    console.error("No mailbox row found; run the db seed first.");
    process.exit(1);
  }

  let updatedGroups = 0;
  let createdGroups = 0;
  let updatedTemplates = 0;

  for (const spec of ALL_EPICURE_ISSUE_GROUP_SPECS) {
    const group = await scriptDb.query.issueGroups.findFirst({
      where: eq(issueGroups.title, spec.title),
      columns: { id: true, defaultSavedReplyId: true },
    });

    if (!group) {
      const [savedReply] = await scriptDb
        .insert(savedReplies)
        .values({
          name: spec.templateName,
          content: spec.templateBody,
          templateType: "rich_text",
          unused_mailboxId: mailbox.id,
          isActive: true,
        })
        .returning({ id: savedReplies.id });

      await scriptDb.insert(issueGroups).values({
        title: spec.title,
        description: spec.description,
        color: spec.color,
        assignees: [],
        autoResponseEnabled: spec.autoResponseEnabled ? 1 : 0,
        defaultSavedReplyId: savedReply?.id ?? null,
      });
      createdGroups++;
      continue;
    }

    // Existing rows keep their autoResponseEnabled — that switch is the team's to own, not the seed's.
    await scriptDb
      .update(issueGroups)
      .set({
        description: spec.description,
        color: spec.color,
        updatedAt: new Date(),
      })
      .where(eq(issueGroups.id, group.id));
    updatedGroups++;

    if (group.defaultSavedReplyId) {
      await scriptDb
        .update(savedReplies)
        .set({
          name: spec.templateName,
          content: spec.templateBody,
          updatedAt: new Date(),
        })
        .where(eq(savedReplies.id, group.defaultSavedReplyId));
      updatedTemplates++;
    }
  }

  console.log(
    `Created ${createdGroups} issue groups; updated ${updatedGroups} groups and ${updatedTemplates} saved-reply templates.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => scriptPool.end());
