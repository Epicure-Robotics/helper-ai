import type { InboundTriage, LeadRoutingRole, StarterInboundCategoryKey } from "./inboundTriage";

/**
 * The one lead taxonomy, used by both inbound channels:
 *  - the website contact form, which states the category outright in the subject
 *    (`New Lead [Franchise / machine purchase]: Tanmay Aggarwal - Epicure Robotics`)
 *  - plain email straight to the mailbox, where the model infers the category instead
 *
 * Keys mirror the `value` the website form posts. Website copy and subject copy already drift
 * (dropdown says "Franchise or machine purchase", subject says "Franchise / machine purchase"),
 * so never match labels exactly — match on `keywords`.
 */
export const leadCategoryKeys = [
  "franchise",
  "placement_bengaluru",
  "placement_outside",
  "how_it_works",
  "events",
  "other",
] as const;

export type LeadCategoryKey = (typeof leadCategoryKeys)[number];

/** Priority stamped on the lead from its category alone — no model call, no guessing. */
export type LeadPriority = "high" | "med" | "low";

export type LeadCategorySpec = {
  key: LeadCategoryKey;
  /** Canonical label we display, normalised across website copy variants. */
  label: string;
  priority: LeadPriority;
  routingRole: LeadRoutingRole;
  /** Bucket used by the rest of the triage plumbing (reporting, fallbacks). */
  bucket: StarterInboundCategoryKey;
  /** `issue_groups.title` this category files into — must match a row in EPICURE_ISSUE_GROUP_SPECS. */
  issueGroupTitle: string;
  /**
   * Matched against the bracket text (and any category row in the body); first spec with a hit
   * wins, so order matters. Keep every alternative \b-anchored — an unanchored /other/ matches
   * "Brother", and an unanchored /purchase/ matches "Repurchase".
   */
  keywords: RegExp;
  /** How the category is described to the model when it has to infer it from a plain email. */
  aiHint: string;
};

/**
 * Ordered most-specific first: "Machine placement - within Bengaluru" also contains "machine",
 * so the placement rows have to be tested before the franchise row.
 */
export const LEAD_CATEGORY_SPECS: LeadCategorySpec[] = [
  {
    key: "placement_bengaluru",
    label: "Machine placement - within Bengaluru",
    priority: "high",
    routingRole: "founder_sales",
    bucket: "business_lead",
    issueGroupTitle: "Lead — Placement (Bengaluru)",
    keywords: /placement.*(?:within|in)\s*(?:bengaluru|bangalore|blr)|(?:bengaluru|bangalore|blr).*placement/i,
    aiHint:
      "Wants an Epicure kiosk installed at their own site — office, tech park, gym, cafeteria, coworking — and the site is in or around Bengaluru. They host it; they are not buying the machine.",
  },
  {
    key: "placement_outside",
    label: "Machine placement - outside Bengaluru",
    priority: "med",
    routingRole: "sales_digest",
    bucket: "business_lead",
    issueGroupTitle: "Lead — Placement (outside Bengaluru)",
    keywords: /placement.*outside\s*(?:bengaluru|bangalore|blr)|outside.*(?:bengaluru|bangalore|blr)/i,
    aiHint: "Same as placement, but the site is outside Bengaluru (another Indian city, or overseas).",
  },
  {
    key: "franchise",
    label: "Franchise / machine purchase",
    priority: "high",
    routingRole: "founder_sales",
    bucket: "business_lead",
    issueGroupTitle: "Lead — Franchise / Purchase",
    keywords: /\bfranchis|\bpurchas(?:e|es|ing)\b|\bbuy(?:ing)?\b|\bdealership\b/i,
    aiHint:
      "Wants to own the machine or the business: franchise enquiry, dealership, buying units outright, asking for a purchase quote or unit price.",
  },
  {
    key: "events",
    label: "Events & bulk requirements",
    priority: "med",
    routingRole: "sales_digest",
    bucket: "business_lead",
    issueGroupTitle: "Lead — Events & Bulk",
    keywords: /\bevents?\b|\bbulk\b|catering/i,
    aiHint:
      "A one-off or short-run need tied to a date: an event, exhibition, wedding, conference, or a bulk order of servings.",
  },
  {
    key: "how_it_works",
    label: "General product enquiry",
    priority: "low",
    routingRole: "sales_digest",
    bucket: "business_lead",
    issueGroupTitle: "Lead — Product Enquiry",
    keywords: /general\s*(?:product\s*)?(?:enquiry|inquiry)|how\s*it\s*works|product\s*(?:enquiry|inquiry)/i,
    aiHint:
      "Informational only — how the kiosk works, what it serves, specs, footprint, utilities, demos. No stated intent to host or buy yet.",
  },
  {
    key: "other",
    label: "Other enquiry",
    priority: "low",
    routingRole: "general",
    bucket: "business_lead",
    issueGroupTitle: "Lead — Other enquiry",
    keywords: /\bother\b/i,
    aiHint:
      "A genuine lead or enquiry that fits none of the above. Do NOT use for vendor pitches, job applications, press, or spam — those are separate top-level buckets.",
  },
];

const SPEC_BY_KEY = new Map(LEAD_CATEGORY_SPECS.map((s) => [s.key, s]));

export const leadCategorySpec = (key: LeadCategoryKey): LeadCategorySpec =>
  SPEC_BY_KEY.get(key) ?? LEAD_CATEGORY_SPECS[LEAD_CATEGORY_SPECS.length - 1]!;

/** Triage importance uses "med"; keep the two vocabularies aligned in one place. */
export const priorityToImportance = (priority: LeadPriority): "low" | "med" | "high" => priority;

/**
 * Resolves free text (a subject bracket, or a labelled row in the email body) to a category.
 * Accepts the raw posted `value` too, so a website change that stamps `franchise` instead of the
 * label still lands correctly.
 */
export function matchLeadCategory(rawLabel: string | null | undefined): LeadCategorySpec | null {
  const text = rawLabel?.replace(/\s+/g, " ").trim();
  if (!text) return null;

  const asKey = text.toLowerCase().replace(/[\s-]+/g, "_");
  if ((leadCategoryKeys as readonly string[]).includes(asKey)) {
    return leadCategorySpec(asKey as LeadCategoryKey);
  }

  return LEAD_CATEGORY_SPECS.find((spec) => spec.keywords.test(text)) ?? null;
}

export type ParsedWebsiteLeadSubject = {
  /** null when the subject is a lead notification but carries no recognisable category. */
  spec: LeadCategorySpec | null;
  /** Bracket text exactly as the website sent it, for display and for spotting new options. */
  rawLabel: string | null;
  leadName: string | null;
};

const COMPANY_SUFFIX = /\s*[-–—]\s*Epicure Robotics\s*$/i;
const LEAD_SUBJECT = /new\s+lead\b\s*(?:\[([^\]]*)\])?\s*:?\s*(.*)$/i;

/**
 * Parses both the current and legacy website subjects:
 *   `New Lead [Franchise / machine purchase]: Tanmay Aggarwal - Epicure Robotics`
 *   `🚀 New Lead: Hardik Gupta - Epicure Robotics`
 * Returns null when the subject is not a website lead notification at all.
 */
export function parseWebsiteLeadSubject(subject: string | null | undefined): ParsedWebsiteLeadSubject | null {
  const normalized = subject?.replace(/\s+/g, " ").trim();
  if (!normalized) return null;

  const match = LEAD_SUBJECT.exec(normalized);
  if (!match) return null;

  const rawLabel = match[1]?.trim() || null;
  const leadName = match[2]?.replace(COMPANY_SUFFIX, "").trim() || null;

  return {
    spec: matchLeadCategory(rawLabel),
    rawLabel,
    leadName,
  };
}

/** Rebuilds the inbox subject so the category survives into the conversation list. */
export function buildLeadSubject(name: string, rawLabel: string | null): string {
  const spec = matchLeadCategory(rawLabel);
  const label = spec?.label ?? rawLabel;
  return label ? `🚀 New Lead [${label}]: ${name}` : `🚀 New Lead: ${name}`;
}

/**
 * Confidence below which an AI-inferred category is not trusted to file the lead into a category
 * group. The form path is always 1 — the lead picked the category themselves.
 */
export const LEAD_CATEGORY_MIN_CONFIDENCE = 0.7;

/** Only the form knows the category for certain; the model is guessing from prose. */
export type LeadCategorySource = "website_form" | "ai_inferred";

/**
 * Builds a triage from a resolved category. Both channels land here so an emailed franchise
 * enquiry and a form-submitted one get the same priority, routing, and template.
 *
 * `source` is recorded rather than acted on here — it is what lets the auto-reply step hold
 * AI-inferred categories to a higher bar than ones the lead stated outright.
 */
export function leadCategoryTriage(params: {
  spec: LeadCategorySpec;
  source: LeadCategorySource;
  confidence: number;
  rawLabel: string | null;
  leadName: string | null;
  issueGroupId: number | null;
  geography?: string | null;
  summaryLine?: string | null;
  reasoning?: string | null;
}): InboundTriage {
  const { spec, source, confidence, rawLabel, leadName, issueGroupId } = params;
  const fromForm = source === "website_form";
  const who = leadName ? `${leadName}: ` : "";
  const channel = fromForm ? "website form" : "email";

  return {
    category: { source: "starter", key: spec.bucket, confidence },
    importance: priorityToImportance(spec.priority),
    geography: params.geography ?? (spec.key === "placement_bengaluru" ? "Bengaluru, IN" : null),
    summaryLine: params.summaryLine?.trim() || `${who}${channel} — ${spec.label}`,
    reasoning:
      params.reasoning?.trim() ||
      (fromForm
        ? `Category taken verbatim from the website form dropdown (${rawLabel ?? spec.key}); priority ${spec.priority} per the lead category map.`
        : `Category inferred from the email body (confidence ${confidence}); priority ${spec.priority} per the lead category map.`),
    matchedIssueGroupId: issueGroupId,
    leadCategoryKey: spec.key,
    leadCategoryLabel: rawLabel ?? spec.label,
    leadCategorySource: source,
    leadCategoryConfidence: confidence,
    routingRoleOverride: spec.routingRole,
  };
}

/**
 * Whether an automated reply may go out for this triage. The per-issue-group "Enable AI
 * Auto-Response" switch still governs on top of this — this only blocks the case where we are
 * not confident enough about the category to stand behind its template.
 *
 * Anything not categorised by the lead-category map (plain AI triage, vendor pitches, hiring)
 * keeps the old behaviour: the group toggle alone decides.
 */
export function leadCategoryAutoReplyAllowed(triage: {
  leadCategorySource?: LeadCategorySource | null;
  leadCategoryConfidence?: number | null;
}): boolean {
  if (triage.leadCategorySource === "ai_inferred") {
    return (triage.leadCategoryConfidence ?? 0) >= LEAD_CATEGORY_MIN_CONFIDENCE;
  }
  return true;
}

/** Category menu handed to the model when it has to infer the category from a plain email. */
export const leadCategoryAiMenu = (): string =>
  LEAD_CATEGORY_SPECS.map((s) => `- **${s.key}** (${s.label}): ${s.aiHint}`).join("\n");
