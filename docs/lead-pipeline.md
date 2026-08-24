# Lead pipeline

How an enquiry becomes a categorised, prioritised, assigned conversation — and when it gets an
automated reply.

This is the core of Epicure Assist. Read this before changing anything in `lib/leads/`,
`jobs/categorizeConversationToIssueGroup.ts`, or `jobs/handleTemplateResponse.ts`.

## The two lead types

Everything hangs off one business distinction — **who owns the machine**:

| The lead wants | Meaning | Category |
| --- | --- | --- |
| To buy or franchise a machine | They own and operate it | `franchise` |
| Epicure's machine at their site | Epicure owns it, they host it | `placement_bengaluru` / `placement_outside` |

Getting this wrong is the most expensive classification error in the system, which is why the
category hints in `lib/leads/leadCategory.ts` spell it out for the model.

## The six categories

They mirror the "What's this about?" dropdown on epicurerobotics.com. The website posts a `value`
and stamps a human label into the notification subject.

| Key | Label | Priority | Routes to | Issue group |
| --- | --- | --- | --- | --- |
| `franchise` | Franchise / machine purchase | **high** | `founder_sales` | Lead — Franchise / Purchase |
| `placement_bengaluru` | Machine placement - within Bengaluru | **high** | `founder_sales` | Lead — Placement (Bengaluru) |
| `placement_outside` | Machine placement - outside Bengaluru | med | `sales_digest` | Lead — Placement (outside Bengaluru) |
| `events` | Events & bulk requirements | med | `sales_digest` | Lead — Events & Bulk |
| `how_it_works` | General product enquiry | low | `sales_digest` | Lead — Product Enquiry |
| `other` | Other enquiry | low | `general` | Lead — Other enquiry |

Single source of truth: `LEAD_CATEGORY_SPECS` in [`lib/leads/leadCategory.ts`](../lib/leads/leadCategory.ts).
Change priority or routing there and both inbound channels follow.

### Adding or changing a category

1. Add the spec to `LEAD_CATEGORY_SPECS` (keep the array **most-specific-first** — see Gotchas).
2. Add a matching issue group to `EPICURE_LEAD_CATEGORY_ISSUE_GROUP_SPECS` in
   [`lib/epicure/issueGroupSpecs.ts`](../lib/epicure/issueGroupSpecs.ts) with the same
   `issueGroupTitle`. A test asserts every category has one.
3. Run `pnpm sync:epicure-issue-groups` to create it in the database.

## Two channels, one taxonomy

### Channel A — website form (deterministic, no AI)

The website states the category, so the model is never asked to re-guess it:

```
New Lead [Franchise / machine purchase]: Tanmay Aggarwal - Epicure Robotics
```

`parseWebsiteLeadSubject()` extracts the bracket, `matchLeadCategory()` resolves it to a spec, and
`categorizeConversationToIssueGroup` short-circuits before the AI call. Confidence is `1`.

Matching is **keyword-based, never exact-string**: the dropdown says "Franchise **or** machine
purchase" while the subject says "Franchise **/** machine purchase". Exact matching would silently
break the moment the website's copy drifts again.

An unrecognised bracket (a new dropdown option) is kept verbatim in `leadCategoryLabel`, reported to
Sentry, and falls through to the AI path.

### Channel B — plain email (AI-inferred, confidence-gated)

No subject tag, so the model picks from the same six categories alongside its top-level bucket.

- **Confidence ≥ `LEAD_CATEGORY_MIN_CONFIDENCE` (0.7)** → the category map applies identically to
  Channel A. An emailed franchise enquiry gets the same priority, routing, group, and template as a
  form-submitted one.
- **Below 0.7** → the model's own bucket and importance stand, the lead is *not* filed into a
  category group, and the reply is withheld (see Auto-reply gates).

The `Lead — …` groups are **excluded** from the list of groups offered to the model for free-form
matching. They are reachable only through `leadCategoryKey`, so an unrelated vendor pitch cannot
drift into one and collect its template.

## End-to-end flow

```
Gmail push  →  handleGmailWebhookEvent          creates the conversation
                 │                                (subject rewritten to keep the category)
                 ▼
              conversations/message.created
                 ├── categorizeConversationToIssueGroup   category, priority, issue group
                 └── generateBackgroundDraft              a draft for the human
                 ▼
              conversations/issue-group.assigned
                 └── autoAssignConversation               picks the assignee by routing role
                 ▼
              conversations/template-response.check
                 └── handleTemplateResponse               sends the acknowledgement, if enabled
```

Website chat widget conversations (`source = "chat"`) enter at `message.created` and go through the
same triage — they are leads too, just not email.

## Priority

`inboundTriage.importance` (`high` | `med` | `low`) is set from the category, never guessed, for
both channels. It drives:

- **Routing** — `routingRoleOverride` on the triage wins outright in `routingTargetFromTriage()`.
- **Who replies** — `assignedToAiFromTriage()` returns `false` for high, so a human owns the reply.
- **The inbox** — a HIGH/MED badge on the conversation row, plus a Priority filter. Low gets no
  badge deliberately; a pill on every row is noise.

## Auto-reply gates

An automated reply must clear **all** of these. They are separate on purpose:

| Gate | Where | Meaning |
| --- | --- | --- |
| First message | `handleTemplateResponse` | Nobody has replied yet. **Excludes drafts** |
| `autoResponseEnabled` | `issue_groups` | Settings → Common Issues toggle for that category |
| `leadCategoryAutoReplyAllowed` | `lib/leads/leadCategory.ts` | An AI-inferred category must be ≥ 0.7 |
| Template has variables | `handleTemplateResponse` | A template with no `{slots}` is skipped |

Ships **on** for the two high-priority categories only, and only to acknowledge — the substantive
reply is the assigned human's. Everything else ships off and is enabled deliberately.

### Standard answers

Each issue group has a **Standard answer** (`issue_groups.standard_answer`, edited in
Settings → Common Issues).

- **Set** → it is the only source of facts. The model rephrases it to fit the email and is
  instructed not to add timelines, prices, availability, or commitments that are not in it.
- **Empty** → the model answers from the knowledge base, as before.

Use it for anything that changes: lead times, whether you are onboarding franchises this quarter.
It controls *what the reply says*, never *whether it sends*.

## Auto-ignore and the rescue

Arrival filters run before anything reads the message: staff replies, unparseable form bodies, Gmail
junk labels, transactional senders, AI-detected auto-responses. They keep the queue actionable and
stop the assistant replying to robots.

Auto-ignored mail gets status **`ignored`**, not `closed`, so Closed keeps meaning "a human dealt
with this" and the filter's output stays reviewable in its own tab.

**`CATEGORY_UPDATES` is deliberately in the junk list.** Gmail also applies it to first-contact
business mail, but removing it floods the queue — the transactional-sender check intentionally does
not match `notifications@`, `hello@news…`, `team@mail…`. Instead:

> **Triage still runs on ignored mail.** When it resolves a lead category,
> `applyTriage` flips the conversation back to `open` and logs why.

So mail escapes the filter on **what it says**, not on how Gmail labelled it. A parsed website form
lead is never auto-ignored at all.

## Gotchas

Each of these was a real bug. Please don't reintroduce them.

**Template variables use SINGLE braces.** `lib/utils/templateVariables.ts` matches `/\{(\w+)\}/`.
Writing `{{name}}` substitutes the inner pair and leaves the outer one, so the customer receives
`Hi {Jane Doe},`. A test enforces this.

**Don't count drafts as messages.** `handleTemplateResponse` asks "has anyone replied yet?".
`generateBackgroundDraft` runs on the same event and usually wins the race, so counting every row
made the job skip every time — which silently made the `autoResponseEnabled` toggle decorative.
Inbound user messages carry `status = NULL`, so any draft test must be NULL-safe.

**Keep the AI schema a flat object.** `z.discriminatedUnion` compiles to a top-level `anyOf`, and
the OpenAI tool-call schema must be `type: "object"`. A union there fails *every* call.

**Don't add a discriminator field.** An earlier `categorySource` field was repeatedly filled with
the category itself (`"categorySource": "generic_info_spam"`), failing validation. The source is
inferred from which fields come back instead.

**Required-but-nullable, not optional, for decisions you want made.** When `leadCategoryKey` was
made optional the model quietly omitted it and every email lost its category. Only the
mutually-exclusive `starter*`/`proposed*` pair is optional.

**Anchor every keyword regex with `\b`.** An unanchored `/other/` matched "Brother"; `/purchase/`
matched "Repurchase" and promoted a spare-parts email to a high-priority franchise lead.

**Order `LEAD_CATEGORY_SPECS` most-specific-first.** "Machine placement - within Bengaluru" also
contains "machine", so the placement rows must be tested before `franchise`.

**Template values are substituted mid-sentence.** They must be fragments, not clauses, or you get
"Thanks for your interest in interested in purchasing two machines. with Epicure Robotics". The
prompt in `handleTemplateResponse` shows the model the template and asks for fragments.

## Testing

```bash
pnpm test:pure     # 133 tests, no Docker — includes the whole lead taxonomy
```

The lead logic is pure functions precisely so it can be tested without a database. Keep it that way:
put anything needing real rows in the main suite instead.
