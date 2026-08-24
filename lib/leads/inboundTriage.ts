import { z } from "zod";
import { leadCategoryKeys, type LeadCategoryKey, type LeadCategorySource } from "./leadCategory";

/** Fixed taxonomy the model should prefer; it may instead propose a new label with confidence. */
export const starterInboundCategoryKeys = [
  "business_lead",
  "vendor_manufacturer_pitch",
  "partnership_distributor",
  "hiring_career",
  "press_media_investor",
  "generic_info_spam",
] as const;

export type StarterInboundCategoryKey = (typeof starterInboundCategoryKeys)[number];

export const STARTER_INBOUND_CATEGORY_LABELS: Record<StarterInboundCategoryKey, string> = {
  business_lead: "Business lead (factory / office / gym / operator wanting equipment or a quote)",
  vendor_manufacturer_pitch: "Vendor / manufacturer pitch (selling parts, services, or outsourcing to you)",
  partnership_distributor: "Partnership / distributor (resellers, channel, territory)",
  hiring_career: "Hiring / career (applications, agencies, recruiting)",
  press_media_investor: "Press / media / investor",
  generic_info_spam: "Generic info / spam / low-signal cold outreach",
};

export type InboundCategoryResolution =
  | { source: "starter"; key: StarterInboundCategoryKey; confidence: number }
  | { source: "proposed"; key: string; label: string; confidence: number };

export type InboundTriage = {
  category: InboundCategoryResolution;
  /** Priority. Set from the website form category when present, otherwise inferred by the model. */
  importance: "low" | "med" | "high";
  geography: string | null;
  summaryLine: string;
  reasoning?: string;
  matchedIssueGroupId?: number | null;
  /** Set when the message resolved to one of the six lead categories, from either channel. */
  leadCategoryKey?: LeadCategoryKey | null;
  /** Category text as received, kept verbatim so new website dropdown options are visible. */
  leadCategoryLabel?: string | null;
  /** Which channel produced the category — the form states it, the model guesses it. */
  leadCategorySource?: LeadCategorySource | null;
  /** 1 for the form; the model's own confidence when inferred from a plain email. */
  leadCategoryConfidence?: number | null;
  /** Bypasses the bucket+importance routing table; used by the lead category map. */
  routingRoleOverride?: LeadRoutingRole | null;
};

/** Core-only routing inboxes (set on team members → Settings → Team). */
export const leadRoutingRoleSchema = z.enum([
  "founder_sales",
  "sales_digest",
  "procurement_cto",
  "hr",
  "founders",
  "general",
]);

export type LeadRoutingRole = z.infer<typeof leadRoutingRoleSchema>;

export const LEAD_ROUTING_ROLE_LABELS: Record<LeadRoutingRole, string> = {
  founder_sales: "Founder / sales lead (high-intent business)",
  sales_digest: "Sales — digest / templated tier (medium-low business)",
  procurement_cto: "Procurement / CTO (vendor pitches)",
  hr: "HR / hiring",
  founders: "Founders — press & partnerships",
  general: "General — core round-robin",
};

export const LEAD_ROUTING_ROLE_ORDER: LeadRoutingRole[] = [
  "founder_sales",
  "sales_digest",
  "procurement_cto",
  "hr",
  "founders",
  "general",
];

function inferStarterBucketFromProposed(category: { key: string; label: string }): StarterInboundCategoryKey | null {
  const t = `${category.key} ${category.label}`.toLowerCase();
  if (/\bspam\b|scam|unsolicited|seo\s+services|guest\s+post/i.test(t)) return "generic_info_spam";
  if (/hiring|career|job\s+application|\bresume\b|\bcv\b|recruit|staffing/i.test(t)) return "hiring_career";
  if (/vendor|supplier|manufactur|oem|outsource|\bpitch\b.*(?:our|we offer)|component\s+vendor/i.test(t)) {
    return "vendor_manufacturer_pitch";
  }
  if (/partner|distribut|reseller|territory|channel\s+partner|dealership/i.test(t)) {
    return "partnership_distributor";
  }
  if (/press|media|journalist|investor|podcast|pr\b|interview/i.test(t)) return "press_media_investor";
  if (
    /factory|office|gym|vending|cafeteria|food\s*service|quote|\brfq\b|pilot|equipment|buy|purchase|deploy|\blead\b/i.test(
      t,
    )
  ) {
    return "business_lead";
  }
  return null;
}

/** Map triage to one of the starter buckets for routing rules. */
export function effectiveInboundBucket(triage: InboundTriage): StarterInboundCategoryKey {
  if (triage.category.source === "starter") {
    return triage.category.key;
  }
  return inferStarterBucketFromProposed(triage.category) ?? "generic_info_spam";
}

/**
 * Route to team members who have this inbox category on their profile (or any admin).
 * - routingRoleOverride (website form category) wins outright
 * - Business + high → founder_sales (human, no auto-reply)
 * - Business + low/med → sales_digest (templated / AI-friendly)
 * - Vendor pitch → procurement_cto
 * - Hiring → hr
 * - Partnership / press / investor → founders
 * - Generic / spam / unknown → general
 */
export function routingTargetFromTriage(triage: InboundTriage): LeadRoutingRole {
  if (triage.routingRoleOverride) return triage.routingRoleOverride;

  const bucket = effectiveInboundBucket(triage);
  const { importance } = triage;

  switch (bucket) {
    case "business_lead":
      return importance === "high" ? "founder_sales" : "sales_digest";
    case "vendor_manufacturer_pitch":
      return "procurement_cto";
    case "partnership_distributor":
    case "press_media_investor":
      return "founders";
    case "hiring_career":
      return "hr";
    case "generic_info_spam":
    default:
      return "general";
  }
}

/** Importance + category drives AI auto-reply vs human queue. */
export function assignedToAiFromTriage(triage: InboundTriage): boolean {
  const bucket = effectiveInboundBucket(triage);
  if (bucket === "business_lead") {
    return triage.importance !== "high";
  }
  return false;
}

/**
 * Flat object, deliberately NOT a z.discriminatedUnion: a union compiles to a top-level `anyOf`,
 * and the OpenAI tool-call schema must be `type: "object"`.
 *
 * There is also no `categorySource` discriminator. It used to exist and the model kept filling it
 * with the category itself (`"categorySource": "generic_info_spam"`) instead of "starter" or
 * "proposed", failing validation and killing the job. The source is now inferred from which fields
 * came back, so there is nothing to get wrong: fill `starterKey`, or the `proposed*` fields, or
 * neither.
 *
 * Every field is nullish. A model that omits a field it considers inapplicable should not cost us
 * a lead — `inboundTriageFromAi` normalises whatever arrives.
 */
export const inboundTriageAISchema = z.object({
  starterKey: z
    .enum(starterInboundCategoryKeys)
    .nullish()
    .describe("Closest starter category. Null only when none of them fit at all."),
  starterMatchConfidence: z.number().min(0).max(1).nullish(),
  proposedKey: z.string().nullish().describe("Only when no starter fits: snake_case key for a new category"),
  proposedLabel: z.string().nullish().describe("Human-readable name for the proposed category"),
  proposedConfidence: z.number().min(0).max(1).nullish(),
  importance: z.enum(["low", "med", "high"]),
  geography: z.string().nullish(),
  /** No max length here — a long summary is not worth failing a triage over; it is truncated below. */
  summaryLine: z.string().nullish(),
  reasoning: z.string().nullish(),
  matchedIssueGroupId: z.number().nullish(),
  /**
   * Which of the six lead categories this message is, when it is a lead at all. Null for vendor
   * pitches, hiring, press, and spam. Drives priority and routing exactly as the website form
   * dropdown does, so an emailed franchise enquiry is handled like a form-submitted one.
   */
  leadCategoryKey: z.enum(leadCategoryKeys).nullable(),
  leadCategoryConfidence: z.number().min(0).max(1).describe("0-1 confidence in leadCategoryKey; 0 when null"),
});

export type InboundTriageAIResult = z.infer<typeof inboundTriageAISchema>;

export function inboundTriageFromAi(ai: InboundTriageAIResult): InboundTriage {
  const shared = {
    importance: ai.importance,
    geography: ai.geography ?? null,
    summaryLine: (ai.summaryLine ?? "").slice(0, 400),
    reasoning: ai.reasoning ?? undefined,
    matchedIssueGroupId: ai.matchedIssueGroupId ?? null,
    leadCategoryKey: ai.leadCategoryKey,
    leadCategoryConfidence: ai.leadCategoryConfidence,
    leadCategorySource: ai.leadCategoryKey ? ("ai_inferred" as const) : null,
  };

  // A validated starter key wins over a free-text proposal when the model sends both.
  if (ai.starterKey) {
    return {
      category: { source: "starter", key: ai.starterKey, confidence: ai.starterMatchConfidence ?? 0 },
      ...shared,
    };
  }

  if (ai.proposedKey && ai.proposedLabel) {
    return {
      category: {
        source: "proposed",
        key: ai.proposedKey,
        label: ai.proposedLabel,
        confidence: ai.proposedConfidence ?? 0,
      },
      ...shared,
    };
  }

  // Nothing usable came back. Treat as low-signal rather than guessing a bucket: that keeps it off
  // the AI-reply path and in the general queue, where a human decides.
  return {
    category: { source: "starter", key: "generic_info_spam", confidence: 0 },
    ...shared,
  };
}
