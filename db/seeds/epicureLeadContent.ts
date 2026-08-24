import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { faqs, issueGroups, mailboxes, savedReplies } from "@/db/schema";
import { ALL_EPICURE_ISSUE_GROUP_SPECS } from "@/lib/epicure/issueGroupSpecs";

const EPICURE_FAQS = [
  "Commercial and pricing questions: Do not share manufacturing cost, unit price, revenue, or other internal financial figures in this assistant. Direct people to contact Epicure via https://epicurerobotics.com/ for quotes and commercial discussions.",
  "What floor space / footprint is required for Smoothie Bar 2.0, Zoe, or other kiosk formats?",
  "What are typical lead times from order to deployment? (Give ranges only if in the knowledge base; otherwise route to the team.)",
  "Which regions or countries does Epicure serve and support today?",
  "What training and documentation ship with a kiosk deployment?",
  "What warranty and field service options are available?",
  "Can kiosks integrate with our existing payments, loyalty, or building systems?",
  "What utilities (power, water, network, drainage) are required on site?",
  "How do software updates, remote monitoring, and diagnostics work across a fleet?",
  "Where can I watch product demos or see PARK (Platform for Automated Robotic Kiosks) explained? Point to https://epicurerobotics.com/ and official YouTube links when present in the knowledge base.",
];

/**
 * Idempotent Epicure defaults: issue groups (AI triage + one per website form category),
 * their saved-reply templates, and FAQ stubs.
 * Run with mailbox already created. Assignees stay empty—set Clerk user IDs in Settings.
 */
export async function seedEpicureLeadContent() {
  const mailbox = await db.query.mailboxes.findFirst({ orderBy: (m, { asc: a }) => [a(m.id)] });
  if (!mailbox) {
    console.warn("seedEpicureLeadContent: no mailbox, skipping");
    return;
  }

  const existing = await db.query.issueGroups.findFirst({ where: eq(issueGroups.title, "Business Lead") });
  if (existing) {
    console.log("seedEpicureLeadContent: already seeded (Business Lead exists), skipping");
    return;
  }

  const savedReplyIds: number[] = [];

  for (const spec of ALL_EPICURE_ISSUE_GROUP_SPECS) {
    const [row] = await db
      .insert(savedReplies)
      .values({
        name: spec.templateName,
        content: spec.templateBody,
        templateType: "rich_text",
        unused_mailboxId: mailbox.id,
        isActive: true,
      })
      .returning({ id: savedReplies.id });
    if (row) savedReplyIds.push(row.id);
  }

  if (savedReplyIds.length !== ALL_EPICURE_ISSUE_GROUP_SPECS.length) {
    throw new Error("seedEpicureLeadContent: failed to insert all saved replies");
  }

  for (let i = 0; i < ALL_EPICURE_ISSUE_GROUP_SPECS.length; i++) {
    const spec = ALL_EPICURE_ISSUE_GROUP_SPECS[i]!;
    await db.insert(issueGroups).values({
      title: spec.title,
      description: spec.description,
      color: spec.color,
      assignees: [],
      autoResponseEnabled: spec.autoResponseEnabled ? 1 : 0,
      defaultSavedReplyId: savedReplyIds[i]!,
    });
  }

  for (const content of EPICURE_FAQS) {
    await db.insert(faqs).values({
      content,
      unused_mailboxId: mailbox.id,
      enabled: true,
      suggested: false,
    });
  }

  await db
    .update(mailboxes)
    .set({
      weekendAutoReplyEnabled: false,
      holidayAutoReplyEnabled: false,
      preferences: {
        ...(mailbox.preferences ?? {}),
        autoRespondEmailToChat: "draft",
      },
    })
    .where(eq(mailboxes.id, mailbox.id));

  console.log("seedEpicureLeadContent: issue groups, saved replies, FAQs, and draft-only mailbox preferences applied");
}
