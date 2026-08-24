/**
 * Canonical Epicure inbox issue groups + default saved-reply bodies.
 * Used by db seed and by scripts/sync-epicure-issue-groups.ts to refresh copy without re-seeding.
 */
/**
 * Template variables use SINGLE braces: `{name}`, not `{{name}}`.
 * lib/utils/templateVariables.ts matches /\{(\w+)\}/, so a doubled brace has its inner pair
 * substituted and the outer pair left behind — customers received "Hi {Jane Doe},".
 */
export type EpicureIssueGroupSpec = {
  title: string;
  description: string;
  color: string;
  templateName: string;
  templateBody: string;
  /**
   * Seeds `issue_groups.auto_response_enabled` — the "Enable AI Auto-Response" switch in
   * Settings → Common Issues. Off means the lead goes straight to a human with no automated mail.
   */
  autoResponseEnabled: boolean;
};

export const EPICURE_ISSUE_GROUP_SPECS: EpicureIssueGroupSpec[] = [
  {
    title: "Business Lead",
    description:
      "Venue hosting interest, site partnerships, pilots, or general commercial conversations — not capital-equipment purchase quotes unless published.",
    color: "#2563eb",
    templateName: "Epicure reply — Business lead",
    templateBody: `Hi {name},

Thank you for reaching out about {specific_use_case}. We're glad to learn more about what you're building.

Regarding scale and scope ({deal_size_hint}), our team can recommend the right next step. Could you share your timeline and location?

Best regards,
Epicure Robotics`,
    autoResponseEnabled: false,
  },
  {
    title: "Vendor / Manufacturer Pitch",
    description:
      "Suppliers or manufacturers pitching components, contract manufacturing, or lower-cost alternatives — not a site user or venue hosting inquiry.",
    color: "#7c3aed",
    templateName: "Epicure reply — Vendor pitch",
    templateBody: `Hi {name},

Thanks for your note on {specific_use_case}. We review vendor and manufacturing partnerships carefully.

Please share capability summary, certifications, and any {deal_size_hint} context.

Best,
Epicure Robotics`,
    autoResponseEnabled: false,
  },
  {
    title: "Partnership / Distributor",
    description: "Distribution, reseller, or strategic partnership inquiries.",
    color: "#059669",
    templateName: "Epicure reply — Partnership",
    templateBody: `Hi {name},

We appreciate your interest in partnership around {specific_use_case}.

To route this internally, could you outline regions covered, existing customer base, and {deal_size_hint}?

Best,
Epicure Robotics`,
    autoResponseEnabled: false,
  },
  {
    title: "Hiring",
    description: "Careers, recruiting, and talent outreach.",
    color: "#d97706",
    templateName: "Epicure reply — Hiring",
    templateBody: `Hi {name},

Thanks for connecting regarding {specific_use_case}. For hiring and people-related topics we’ll get you to the right contact.

Please share role or opportunity details and {deal_size_hint} if relevant.

Best,
Epicure Robotics`,
    autoResponseEnabled: false,
  },
  {
    title: "Press / Media",
    description: "Journalists, podcasts, events, and PR.",
    color: "#db2777",
    templateName: "Epicure reply — Press",
    templateBody: `Hi {name},

Thank you for reaching out about {specific_use_case}. We’ll review press and media requests as schedules allow.

If there’s a deadline or outlet detail ({deal_size_hint}), please note it here.

Best,
Epicure Robotics`,
    autoResponseEnabled: false,
  },
  {
    title: "Other",
    description: "Catch-all for messages that do not fit other groups.",
    color: "#64748b",
    templateName: "Epicure reply — General",
    templateBody: `Hi {name},

Thanks for your message about {specific_use_case}. We’ve logged your note and will follow up.

If helpful, any extra context ({deal_size_hint}) speeds routing.

Best,
Epicure Robotics`,
    autoResponseEnabled: false,
  },
];

/**
 * One group per lead category, keyed by `LEAD_CATEGORY_SPECS[].issueGroupTitle`. Both channels
 * file here: website form leads deterministically from their subject tag, plain email leads from
 * the model's leadCategoryKey (only above LEAD_CATEGORY_MIN_CONFIDENCE).
 *
 * Only the two high-priority categories ship with auto-response ON, and only to acknowledge —
 * the substantive reply is the assigned human's. Everything else ships OFF and is turned on
 * deliberately in Settings → Common Issues → Enable AI Auto-Response.
 *
 * `autoResponseEnabled` here seeds new rows only; the sync script never overwrites the switch on
 * an existing group, so the team's choice always wins.
 */
export const EPICURE_LEAD_CATEGORY_ISSUE_GROUP_SPECS: EpicureIssueGroupSpec[] = [
  {
    title: "Lead — Franchise / Purchase",
    description:
      "Franchise enquiries, dealerships, and outright machine purchases, from the website form or plain email. Highest-value inbound — routes to founder / sales, human owns the reply.",
    color: "#dc2626",
    templateName: "Epicure reply — Lead: franchise / purchase",
    templateBody: `Hi {name},

Thanks for your interest in {specific_use_case} with Epicure Robotics. Franchise and machine purchase enquiries are handled directly by our founding team.

We have your details and someone will be in touch shortly to talk through options and next steps.

Best regards,
Epicure Robotics`,
    autoResponseEnabled: true,
  },
  {
    title: "Lead — Placement (Bengaluru)",
    description:
      "Wants to host a kiosk at their own site in or around Bengaluru. Our home market — high priority, routed to founder / sales.",
    color: "#ea580c",
    templateName: "Epicure reply — Lead: placement (Bengaluru)",
    templateBody: `Hi {name},

Thank you for asking about hosting an Epicure kiosk at {specific_use_case}. Bengaluru is our home market, so we can usually move quickly here.

Our team will reach out to confirm site details and schedule a walkthrough.

Best regards,
Epicure Robotics`,
    autoResponseEnabled: true,
  },
  {
    title: "Lead — Placement (outside Bengaluru)",
    description:
      "Wants to host a kiosk at a site outside Bengaluru. Medium priority — sales tier, templated first reply.",
    color: "#ca8a04",
    templateName: "Epicure reply — Lead: placement (outside Bengaluru)",
    templateBody: `Hi {name},

Thanks for your interest in hosting an Epicure kiosk at {specific_use_case}.

We are expanding beyond Bengaluru in phases. To see where your site fits, could you share the city, expected daily footfall, and your timeline ({deal_size_hint})?

Best regards,
Epicure Robotics`,
    autoResponseEnabled: false,
  },
  {
    title: "Lead — Events & Bulk",
    description: "Events, exhibitions, and bulk serving requirements. Short-lead-time, date-driven requests.",
    color: "#0891b2",
    templateName: "Epicure reply — Lead: events & bulk",
    templateBody: `Hi {name},

Thanks for reaching out about {specific_use_case}.

So we can check availability, could you confirm the event date, venue, and expected number of servings ({deal_size_hint})? Event slots are booked on a first-come basis.

Best regards,
Epicure Robotics`,
    autoResponseEnabled: false,
  },
  {
    title: "Lead — Product Enquiry",
    description: "How the kiosks work, specs, footprint, demos. Informational — answerable from the knowledge base.",
    color: "#2563eb",
    templateName: "Epicure reply — Lead: product enquiry",
    templateBody: `Hi {name},

Thanks for your question about {specific_use_case}.

{answer}

If you would like to see a kiosk in action, our demos are at https://epicurerobotics.com/demos.

Best regards,
Epicure Robotics`,
    autoResponseEnabled: false,
  },
  {
    title: "Lead — Other enquiry",
    description: "A genuine lead or enquiry fitting no other category. Catch-all — core round-robin.",
    color: "#64748b",
    templateName: "Epicure reply — Lead: other",
    templateBody: `Hi {name},

Thanks for getting in touch about {specific_use_case}. We have logged your message and will route it to the right person.

If there is anything time-sensitive we should know ({deal_size_hint}), just reply here.

Best regards,
Epicure Robotics`,
    autoResponseEnabled: false,
  },
];

/** Everything the seed and the sync script manage. */
export const ALL_EPICURE_ISSUE_GROUP_SPECS: EpicureIssueGroupSpec[] = [
  ...EPICURE_ISSUE_GROUP_SPECS,
  ...EPICURE_LEAD_CATEGORY_ISSUE_GROUP_SPECS,
];
