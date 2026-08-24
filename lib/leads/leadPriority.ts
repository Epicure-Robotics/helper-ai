/**
 * Presentation for the priority stamped on a lead by triage. Kept apart from `leadCategory.ts`
 * so client components can import it without pulling the whole triage module into the bundle.
 */
export const LEAD_PRIORITY_ORDER = ["high", "med", "low"] as const;

export type LeadPriorityValue = (typeof LEAD_PRIORITY_ORDER)[number];

export const LEAD_PRIORITY_LABELS: Record<LeadPriorityValue, string> = {
  high: "High",
  med: "Medium",
  low: "Low",
};

/** Only high and medium earn a badge — a pill on every row is noise, not signal. */
export const LEAD_PRIORITY_BADGE_STYLES: Record<LeadPriorityValue, string | null> = {
  high: "bg-red-500/15 text-red-600 border-red-500/30 dark:text-red-400",
  med: "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-400",
  low: null,
};

export const isLeadPriority = (value: unknown): value is LeadPriorityValue =>
  typeof value === "string" && (LEAD_PRIORITY_ORDER as readonly string[]).includes(value);
