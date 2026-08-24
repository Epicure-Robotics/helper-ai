import { describe, expect, it } from "vitest";
import { ALL_EPICURE_ISSUE_GROUP_SPECS } from "@/lib/epicure/issueGroupSpecs";
import { assignedToAiFromTriage, inboundTriageFromAi, routingTargetFromTriage } from "@/lib/leads/inboundTriage";
import {
  buildLeadSubject,
  LEAD_CATEGORY_MIN_CONFIDENCE,
  LEAD_CATEGORY_SPECS,
  leadCategoryAiMenu,
  leadCategoryAutoReplyAllowed,
  leadCategoryKeys,
  leadCategoryTriage,
  matchLeadCategory,
  parseWebsiteLeadSubject,
  type LeadCategorySource,
} from "@/lib/leads/leadCategory";

describe("parseWebsiteLeadSubject", () => {
  it("parses the current bracketed subject", () => {
    const r = parseWebsiteLeadSubject("New Lead [Franchise / machine purchase]: Tanmay Aggarwal - Epicure Robotics");
    expect(r?.spec?.key).toBe("franchise");
    expect(r?.rawLabel).toBe("Franchise / machine purchase");
    expect(r?.leadName).toBe("Tanmay Aggarwal");
  });

  it("parses the legacy unbracketed subject with no category", () => {
    const r = parseWebsiteLeadSubject("🚀 New Lead: Hardik Gupta - Epicure Robotics");
    expect(r).not.toBeNull();
    expect(r?.spec).toBeNull();
    expect(r?.rawLabel).toBeNull();
    expect(r?.leadName).toBe("Hardik Gupta");
  });

  it("survives a subject we already rewrote once", () => {
    const r = parseWebsiteLeadSubject("🚀 New Lead [Events & bulk requirements]: Priya N");
    expect(r?.spec?.key).toBe("events");
    expect(r?.leadName).toBe("Priya N");
  });

  it("returns null for unrelated subjects", () => {
    expect(parseWebsiteLeadSubject("Invoice #4021 is due")).toBeNull();
    expect(parseWebsiteLeadSubject("")).toBeNull();
    expect(parseWebsiteLeadSubject(undefined)).toBeNull();
  });

  it("does not read 'New leadership' as a lead named 'ership'", () => {
    expect(parseWebsiteLeadSubject("New leadership announcement")).toBeNull();
  });

  it("keeps an unrecognised bracket verbatim so new dropdown options are visible", () => {
    const r = parseWebsiteLeadSubject("New Lead [Investor relations]: Sam - Epicure Robotics");
    expect(r?.spec).toBeNull();
    expect(r?.rawLabel).toBe("Investor relations");
  });
});

describe("matchLeadCategory", () => {
  it("matches the website label and the subject label despite the or-vs-slash drift", () => {
    expect(matchLeadCategory("Franchise or machine purchase")?.key).toBe("franchise");
    expect(matchLeadCategory("Franchise / machine purchase")?.key).toBe("franchise");
  });

  it("distinguishes the two placement options", () => {
    expect(matchLeadCategory("Machine placement - within Bengaluru")?.key).toBe("placement_bengaluru");
    expect(matchLeadCategory("Machine placement - outside Bengaluru")?.key).toBe("placement_outside");
  });

  it("accepts the raw posted values", () => {
    for (const key of leadCategoryKeys) {
      expect(matchLeadCategory(key)?.key).toBe(key);
    }
  });

  it("matches the remaining labels", () => {
    expect(matchLeadCategory("General product enquiry")?.key).toBe("how_it_works");
    expect(matchLeadCategory("Events & bulk requirements")?.key).toBe("events");
    expect(matchLeadCategory("Other enquiry")?.key).toBe("other");
  });

  it("returns null rather than guessing", () => {
    expect(matchLeadCategory("Press interview request")).toBeNull();
    expect(matchLeadCategory(null)).toBeNull();
  });

  it("does not match a category word buried inside another word", () => {
    // /other/ matched "Brother"; /purchase/ matched "Repurchase".
    expect(matchLeadCategory("Brother Industries partnership")).toBeNull();
    expect(matchLeadCategory("Another supplier introduction")).toBeNull();
    expect(matchLeadCategory("Repurchase of spare parts")).toBeNull();
  });
});

describe("priority and routing map", () => {
  const triageFor = (label: string, source: LeadCategorySource = "website_form", confidence = 1) => {
    const spec = matchLeadCategory(label)!;
    return leadCategoryTriage({ spec, source, confidence, rawLabel: label, leadName: "Test Lead", issueGroupId: 7 });
  };

  it.each([
    ["Franchise / machine purchase", "high", "founder_sales", false],
    ["Machine placement - within Bengaluru", "high", "founder_sales", false],
    ["Machine placement - outside Bengaluru", "med", "sales_digest", true],
    ["General product enquiry", "low", "sales_digest", true],
    ["Events & bulk requirements", "med", "sales_digest", true],
    ["Other enquiry", "low", "general", true],
  ])("%s → %s priority, routes to %s", (label, importance, role, assignedToAI) => {
    const triage = triageFor(label);
    expect(triage.importance).toBe(importance);
    expect(routingTargetFromTriage(triage)).toBe(role);
    expect(assignedToAiFromTriage(triage)).toBe(assignedToAI);
  });

  it("records where the category came from", () => {
    const triage = triageFor("Franchise / machine purchase");
    expect(triage.leadCategoryKey).toBe("franchise");
    expect(triage.leadCategoryLabel).toBe("Franchise / machine purchase");
    expect(triage.leadCategorySource).toBe("website_form");
    expect(triage.leadCategoryConfidence).toBe(1);
    expect(triage.matchedIssueGroupId).toBe(7);
  });

  it("gives an emailed lead the same priority and routing as a form lead", () => {
    for (const spec of LEAD_CATEGORY_SPECS) {
      const fromForm = triageFor(spec.label, "website_form", 1);
      const fromEmail = triageFor(spec.label, "ai_inferred", 0.9);
      expect(fromEmail.importance, spec.key).toBe(fromForm.importance);
      expect(routingTargetFromTriage(fromEmail), spec.key).toBe(routingTargetFromTriage(fromForm));
      expect(assignedToAiFromTriage(fromEmail), spec.key).toBe(assignedToAiFromTriage(fromForm));
    }
  });
});

describe("leadCategoryAutoReplyAllowed", () => {
  it("always allows a category the lead stated on the form", () => {
    expect(leadCategoryAutoReplyAllowed({ leadCategorySource: "website_form", leadCategoryConfidence: 1 })).toBe(true);
    expect(leadCategoryAutoReplyAllowed({ leadCategorySource: "website_form", leadCategoryConfidence: 0.1 })).toBe(
      true,
    );
  });

  it("allows a confident AI-inferred category", () => {
    expect(
      leadCategoryAutoReplyAllowed({
        leadCategorySource: "ai_inferred",
        leadCategoryConfidence: LEAD_CATEGORY_MIN_CONFIDENCE,
      }),
    ).toBe(true);
  });

  it("withholds the reply when the model was unsure", () => {
    expect(
      leadCategoryAutoReplyAllowed({
        leadCategorySource: "ai_inferred",
        leadCategoryConfidence: LEAD_CATEGORY_MIN_CONFIDENCE - 0.01,
      }),
    ).toBe(false);
    expect(leadCategoryAutoReplyAllowed({ leadCategorySource: "ai_inferred", leadCategoryConfidence: null })).toBe(
      false,
    );
  });

  it("leaves non-lead triage to the issue group toggle alone", () => {
    expect(leadCategoryAutoReplyAllowed({})).toBe(true);
    expect(leadCategoryAutoReplyAllowed({ leadCategorySource: null, leadCategoryConfidence: null })).toBe(true);
  });

  it("fires for a low-confidence guess that inboundTriageFromAi produced", () => {
    // Below the bar the job keeps the model's own triage, so the gate is the only thing
    // standing between an unsure guess and an automated reply.
    const triage = inboundTriageFromAi({
      starterKey: "business_lead",
      starterMatchConfidence: 0.8,
      proposedKey: null,
      proposedLabel: null,
      proposedConfidence: null,
      importance: "high",
      geography: null,
      summaryLine: "Someone vaguely interested in machines",
      reasoning: "unclear",
      matchedIssueGroupId: null,
      leadCategoryKey: "franchise",
      leadCategoryConfidence: 0.4,
    });
    expect(triage.leadCategorySource).toBe("ai_inferred");
    expect(leadCategoryAutoReplyAllowed(triage)).toBe(false);
  });

  it("does not fire when the model saw no lead category at all", () => {
    const triage = inboundTriageFromAi({
      starterKey: "hiring_career",
      starterMatchConfidence: 0.95,
      proposedKey: null,
      proposedLabel: null,
      proposedConfidence: null,
      importance: "low",
      geography: null,
      summaryLine: "Job application",
      reasoning: "resume attached",
      matchedIssueGroupId: null,
      leadCategoryKey: null,
      leadCategoryConfidence: 0,
    });
    expect(triage.leadCategorySource).toBeNull();
    expect(leadCategoryAutoReplyAllowed(triage)).toBe(true);
  });
});

describe("buildLeadSubject", () => {
  it("keeps the category in the inbox subject", () => {
    expect(buildLeadSubject("Tanmay Aggarwal", "Franchise / machine purchase")).toBe(
      "🚀 New Lead [Franchise / machine purchase]: Tanmay Aggarwal",
    );
  });

  it("normalises website copy to our canonical label", () => {
    expect(buildLeadSubject("Priya N", "Franchise or machine purchase")).toBe(
      "🚀 New Lead [Franchise / machine purchase]: Priya N",
    );
  });

  it("passes through an unrecognised category instead of dropping it", () => {
    expect(buildLeadSubject("Sam", "Investor relations")).toBe("🚀 New Lead [Investor relations]: Sam");
  });

  it("falls back to the legacy format when there is no category", () => {
    expect(buildLeadSubject("Hardik Gupta", null)).toBe("🚀 New Lead: Hardik Gupta");
  });
});

describe("issue group wiring", () => {
  it("every category has a matching issue group spec", () => {
    const titles = new Set(ALL_EPICURE_ISSUE_GROUP_SPECS.map((g) => g.title));
    for (const spec of LEAD_CATEGORY_SPECS) {
      expect(titles.has(spec.issueGroupTitle)).toBe(true);
    }
  });

  it("every issue group title is unique", () => {
    const titles = ALL_EPICURE_ISSUE_GROUP_SPECS.map((g) => g.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("no lead category group is offered to the model for free-form matching", () => {
    // categorizeConversationToIssueGroup filters on this prefix; the titles must keep it.
    for (const spec of LEAD_CATEGORY_SPECS) {
      expect(spec.issueGroupTitle.startsWith("Lead — "), spec.key).toBe(true);
    }
  });

  it("describes every category to the model", () => {
    const menu = leadCategoryAiMenu();
    for (const spec of LEAD_CATEGORY_SPECS) {
      expect(menu).toContain(spec.key);
      expect(spec.aiHint.length).toBeGreaterThan(20);
    }
  });

  it("every auto-response template has variables — handleTemplateResponse skips those without", () => {
    for (const group of ALL_EPICURE_ISSUE_GROUP_SPECS.filter((g) => g.autoResponseEnabled)) {
      expect(group.templateBody, group.title).toMatch(/\{\{\w+\}\}/);
    }
  });
});
