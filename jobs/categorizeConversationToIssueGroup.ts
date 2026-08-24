import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { conversationMessages } from "@/db/schema/conversationMessages";
import { conversations } from "@/db/schema/conversations";
import { issueGroups } from "@/db/schema/issueGroups";
import { runAIObjectQuery } from "@/lib/ai";
import { DRAFT_MODEL } from "@/lib/ai/core";
import { getMailbox } from "@/lib/data/mailbox";
import {
  assignedToAiFromTriage,
  inboundTriageAISchema,
  inboundTriageFromAi,
  STARTER_INBOUND_CATEGORY_LABELS,
  starterInboundCategoryKeys,
  type InboundTriage,
} from "@/lib/leads/inboundTriage";
import {
  LEAD_CATEGORY_MIN_CONFIDENCE,
  LEAD_CATEGORY_SPECS,
  leadCategoryAiMenu,
  leadCategorySpec,
  leadCategoryTriage,
  parseWebsiteLeadSubject,
} from "@/lib/leads/leadCategory";
import { captureExceptionAndLog } from "@/lib/shared/sentry";
import { triggerEvent } from "./trigger";
import { assertDefinedOrRaiseNonRetriableError } from "./utils";

const getConversationContent = (conversationData: {
  messages?: {
    role: string;
    cleanedUpText?: string | null;
  }[];
  subject?: string | null;
}): string => {
  if (!conversationData?.messages || conversationData.messages.length === 0) {
    return conversationData.subject || "";
  }

  const userMessages = conversationData.messages
    .filter((msg) => msg.role === "user")
    .map((msg) => {
      if (!msg.cleanedUpText) return "";
      return msg.cleanedUpText;
    })
    .filter(Boolean);

  const contentParts = [];
  if (conversationData.subject) {
    contentParts.push(conversationData.subject);
  }
  contentParts.push(...userMessages);

  return contentParts.join(" ");
};

const triageWithAi = async (
  conversationContent: string,
  availableIssueGroups: { id: number; title: string; description: string | null }[],
  mailbox: NonNullable<Awaited<ReturnType<typeof getMailbox>>>,
) => {
  const starterSection = starterInboundCategoryKeys
    .map((k) => `- **${k}**: ${STARTER_INBOUND_CATEGORY_LABELS[k]}`)
    .join("\n");

  const groupsSection =
    availableIssueGroups.length === 0
      ? "No saved issue groups for this mailbox. Set matchedIssueGroupId to null."
      : `OPTIONAL issue groups (use matchedIssueGroupId only with high confidence):\n${availableIssueGroups
          .map((g) => `ID ${g.id}: ${g.title}${g.description ? ` — ${g.description}` : ""}`)
          .join("\n")}`;

  const result = await runAIObjectQuery({
    mailbox,
    model: DRAFT_MODEL,
    functionId: "inbound-triage-and-issue-group",
    queryType: "auto_assign_conversation",
    schema: inboundTriageAISchema,
    system: `You triage inbound messages for Epicure Robotics (fresh food robotic kiosks operated at offices, tech parks, gyms, and coworking; PARK platform; service-led deployments — not capital-equipment sales by default).

STARTER categories — pick the closest starter when it reasonably fits:
${starterSection}

If none of the starters fit well, set categorySource to "proposed" and fill proposedKey (snake_case), proposedLabel, and proposedConfidence.

Fill exactly one group and null the other: categorySource "starter" → starterKey + starterMatchConfidence, with proposedKey/proposedLabel/proposedConfidence null. categorySource "proposed" → the proposed fields, with starterKey/starterMatchConfidence null.

Always output:
- importance: "low" | "med" | "high" using company/org size signals, specificity (e.g. named site, volumes, budget), urgency, and buying intent. Business leads from large or strategic accounts skew "high".
- geography: country/region string or null if unknown.
- summaryLine: one line (under ~200 characters).
- reasoning: short internal rationale.

LEAD CATEGORY — set leadCategoryKey when, and only when, this is a genuine lead or customer enquiry (i.e. you chose business_lead above). Pick from:
${leadCategoryAiMenu()}

Website form submissions already state their category and never reach you; you only see plain email, so judge from what the sender actually says. Set leadCategoryKey to null and leadCategoryConfidence to 0 for vendor pitches, job applications, press, investors, and spam — those are handled by the bucket alone. Be honest with leadCategoryConfidence: below ${LEAD_CATEGORY_MIN_CONFIDENCE} the lead is routed to a human with no automated reply, which is the right outcome when you are unsure.

Optional matchedIssueGroupId: only from the provided ID list when the thread clearly belongs in that group; otherwise null. Do not invent IDs. The list deliberately excludes the "Lead — …" category groups; those are assigned from leadCategoryKey, not by you.

Routing intent (for your reasoning; do not output separate fields):
- Business + high importance → priority human / founder-sales path; not for generic auto-reply.
- Business + low/med → suitable for templated or AI-first reply.
- Vendor pitch → procurement / technical evaluation.
- Hiring → HR.
- Press, partnership, investor-style → founders / leadership.
- Generic / spam → low-touch or core round-robin.`,
    messages: [
      {
        role: "user",
        content: `MESSAGE / THREAD (subject + body):\n${conversationContent.slice(0, 24_000)}\n\n${groupsSection}`,
      },
    ],
    temperature: 0.1,
  });

  return result;
};

/** Persists the triage and kicks off assignment, whichever path produced it. */
const applyTriage = async (
  conversationId: number,
  triage: InboundTriage,
  resolvedGroupId: number | null,
  assignedToAI: boolean,
  messageId: number,
) => {
  await db
    .update(conversations)
    .set({
      inboundTriage: { ...triage, matchedIssueGroupId: resolvedGroupId },
      issueGroupId: resolvedGroupId,
      assignedToAI,
    })
    .where(eq(conversations.id, conversationId));

  const conversationBeforeAssign = await db.query.conversations.findFirst({
    where: eq(conversations.id, conversationId),
    columns: { assignedToId: true },
  });

  if (!conversationBeforeAssign?.assignedToId) {
    await triggerEvent("conversations/issue-group.assigned", { conversationId, messageId });
  }
};

export const categorizeConversationToIssueGroup = async ({ messageId }: { messageId: number }) => {
  const message = await db.query.conversationMessages.findFirst({
    where: eq(conversationMessages.id, messageId),
    columns: {
      conversationId: true,
    },
  });

  if (!message) {
    throw new Error(`Message with id ${messageId} not found`);
  }

  const conversation = assertDefinedOrRaiseNonRetriableError(
    await db.query.conversations.findFirst({
      where: eq(conversations.id, message.conversationId),
      columns: {
        id: true,
        subject: true,
        issueGroupId: true,
        inboundTriage: true,
      },
      with: {
        messages: {
          columns: {
            role: true,
            cleanedUpText: true,
          },
        },
      },
    }),
  );

  if (conversation.inboundTriage) {
    return {
      message: "Conversation already triaged",
      conversationId: conversation.id,
    };
  }

  if (conversation.issueGroupId) {
    return {
      message: "Conversation already assigned to an issue group",
      conversationId: conversation.id,
      currentIssueGroupId: conversation.issueGroupId,
    };
  }

  const mailbox = assertDefinedOrRaiseNonRetriableError(await getMailbox());

  const allIssueGroups = await db
    .select({
      id: issueGroups.id,
      title: issueGroups.title,
      description: issueGroups.description,
    })
    .from(issueGroups);

  const groupIdByTitle = new Map(allIssueGroups.map((g) => [g.title, g.id]));
  const leadCategoryGroupTitles = new Set(LEAD_CATEGORY_SPECS.map((spec) => spec.issueGroupTitle));

  /**
   * The lead category groups are reachable only through leadCategoryKey. Offering them for
   * free-form matching lets an unrelated email (a vendor pitch, a job application) land in a
   * category group and collect its lead template.
   */
  const availableIssueGroups = allIssueGroups.filter((g) => !leadCategoryGroupTitles.has(g.title));

  const conversationContent = getConversationContent(conversation);

  /**
   * The website form stamps the category the lead picked into the subject
   * (`New Lead [Franchise / machine purchase]: ...`). When it is there, take it at face value:
   * it is the lead's own answer, so a model guess can only be worse — and it costs a call.
   */
  const websiteLead = parseWebsiteLeadSubject(conversation.subject);

  /**
   * The website stated a category we have never seen — most likely a new option was added to the
   * dropdown. The lead still gets triaged by the model below, but this needs a human to add the
   * category to LEAD_CATEGORY_SPECS, so make some noise rather than degrading quietly.
   */
  if (websiteLead?.rawLabel && !websiteLead.spec) {
    captureExceptionAndLog(
      new Error(`Unrecognised website lead category: "${websiteLead.rawLabel}" — add it to LEAD_CATEGORY_SPECS`),
      { extra: { conversationId: conversation.id, subject: conversation.subject } },
    );
  }

  if (websiteLead?.spec) {
    const { spec } = websiteLead;
    const formGroupId = groupIdByTitle.get(spec.issueGroupTitle) ?? null;
    if (formGroupId == null) {
      console.warn(
        `[Triage] No issue group titled "${spec.issueGroupTitle}" — run pnpm sync:epicure-issue-groups. Falling back to AI triage.`,
      );
    } else {
      const triage = leadCategoryTriage({
        spec,
        source: "website_form",
        confidence: 1,
        rawLabel: websiteLead.rawLabel,
        leadName: websiteLead.leadName,
        issueGroupId: formGroupId,
      });

      await applyTriage(conversation.id, triage, formGroupId, assignedToAiFromTriage(triage), messageId);

      return {
        message: `Triage from website form category: ${spec.label} (priority ${spec.priority})`,
        conversationId: conversation.id,
        assignedIssueGroupId: formGroupId,
        issueGroupTitle: spec.issueGroupTitle,
        triageSummary: triage.summaryLine,
        assignedToAI: assignedToAiFromTriage(triage),
        source: "website_form_category",
        priority: spec.priority,
        routedTo: spec.routingRole,
      };
    }
  }

  if (!conversationContent.trim()) {
    return {
      message: "Skipped: conversation has no content to analyze",
      conversationId: conversation.id,
    };
  }

  const aiRaw = await triageWithAi(conversationContent, availableIssueGroups, mailbox);
  let triage = inboundTriageFromAi(aiRaw);

  const allowedIds = new Set(availableIssueGroups.map((g) => g.id));
  let resolvedGroupId =
    triage.matchedIssueGroupId != null && allowedIds.has(triage.matchedIssueGroupId)
      ? triage.matchedIssueGroupId
      : null;

  /**
   * A lead that arrived as plain email gets the same category map as a form submission, so
   * priority and routing do not depend on which channel the lead happened to use.
   *
   * Below the confidence bar we keep the model's own bucket and importance rather than commit to a
   * category, so the lead never lands in a category group on a guess. The triage still records
   * that the model guessed one, which is what makes `leadCategoryAutoReplyAllowed` withhold the
   * automated reply at send time.
   */
  const aiCategory =
    triage.leadCategoryKey && (triage.leadCategoryConfidence ?? 0) >= LEAD_CATEGORY_MIN_CONFIDENCE
      ? leadCategorySpec(triage.leadCategoryKey)
      : null;

  if (aiCategory) {
    const categoryGroupId = groupIdByTitle.get(aiCategory.issueGroupTitle) ?? null;
    if (categoryGroupId == null) {
      console.warn(
        `[Triage] No issue group titled "${aiCategory.issueGroupTitle}" — run pnpm sync:epicure-issue-groups. Keeping the model's own group match.`,
      );
    } else {
      resolvedGroupId = categoryGroupId;
      triage = leadCategoryTriage({
        spec: aiCategory,
        source: "ai_inferred",
        confidence: triage.leadCategoryConfidence ?? 0,
        rawLabel: null,
        leadName: null,
        issueGroupId: categoryGroupId,
        geography: triage.geography,
        summaryLine: triage.summaryLine,
        reasoning: triage.reasoning,
      });
    }
  }

  const assignedToAI = assignedToAiFromTriage(triage);

  await applyTriage(conversation.id, triage, resolvedGroupId, assignedToAI, messageId);

  const matchedTitle = resolvedGroupId ? allIssueGroups.find((g) => g.id === resolvedGroupId)?.title : undefined;

  return {
    message: resolvedGroupId
      ? `Triage complete; matched issue group: ${matchedTitle ?? resolvedGroupId}`
      : "Triage complete (no issue group match)",
    conversationId: conversation.id,
    assignedIssueGroupId: resolvedGroupId,
    issueGroupTitle: matchedTitle,
    triageSummary: triage.summaryLine,
    assignedToAI,
  };
};
