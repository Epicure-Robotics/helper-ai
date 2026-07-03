import { and, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import {
  conversationEvents,
  conversationMessages,
  conversations,
  issueGroups,
  notes,
  platformCustomers,
} from "@/db/schema";
import { extractHashedWordsFromEmail } from "./extractHashedWordsFromEmail";

const MAX_SOURCE_RESULTS = 120;
const MAX_RETURNED_MATCHES = 200;
const SEARCHABLE_STATUSES = ["open", "waiting_on_customer", "closed", "spam", "check_back_later", "ignored"] as const;

type ConversationStatus = (typeof SEARCHABLE_STATUSES)[number];
type MatchSource = "conversation" | "message" | "note" | "event";
export type TicketMatchField =
  | "conversation_id"
  | "slug"
  | "customer"
  | "customer_name"
  | "subject"
  | "message"
  | "note"
  | "event"
  | "issue_group"
  | "tracking"
  | "carrier"
  | "country";

type TicketSearchOperators = {
  from: string[];
  subject: string[];
  status: ConversationStatus[];
  tracking: string[];
  carrier: string[];
  country: string[];
  id: number[];
  slug: string[];
};

export type ParsedTicketSearchQuery = {
  raw: string;
  freeText: string;
  operators: TicketSearchOperators;
  broadenedQueries: string[];
};

export type TicketSearchMatch = {
  conversationId: number;
  conversationSlug: string;
  conversationStatus: ConversationStatus | null;
  conversationSubject: string | null;
  customerEmail: string | null;
  customerName: string | null;
  assignedToId: string | null;
  updatedAt: string | null;
  issueGroupId: number | null;
  issueGroupTitle: string | null;
  source: MatchSource;
  matchedField: TicketMatchField;
  itemId: number | null;
  role: string | null;
  createdAt: string | null;
  snippet: string | null;
  matchedText: string | null;
  score: number;
  exact: boolean;
  metadata: Record<string, string | number | boolean | null>;
};

export type FindTicketMatchesOptions = {
  query: string;
  filters?: SQL[];
  limit?: number;
  messageOrderBy?: SQL[];
};

export type FindTicketMatchesResult = {
  parsedQuery: ParsedTicketSearchQuery;
  matches: TicketSearchMatch[];
};

type ConversationRow = {
  conversationId: number;
  conversationSlug: string;
  conversationStatus: ConversationStatus | null;
  conversationSubject: string | null;
  customerEmail: string | null;
  customerName: string | null;
  assignedToId: string | null;
  updatedAt: Date | string | null;
  createdAt?: Date | string | null;
  issueGroupId: number | null;
  issueGroupTitle: string | null;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const SLUG_PATTERN = /^[a-f0-9]{32}$/i;
const TRACKING_PATTERN = /\b(?=[A-Z0-9-]{8,}\b)(?=.*[A-Z])(?=.*\d)[A-Z0-9-]+\b/g;
const OPERATOR_ALIASES: Record<string, keyof TicketSearchOperators> = {
  from: "from",
  customer: "from",
  email: "from",
  subject: "subject",
  status: "status",
  tracking: "tracking",
  carrier: "carrier",
  country: "country",
  id: "id",
  slug: "slug",
};
const BROADENING_RULES: Array<{ needle: RegExp; replacements: string[] }> = [
  { needle: /\brough eta\b/gi, replacements: ["delivery estimate", "estimated arrival"] },
  { needle: /\beta\b/gi, replacements: ["delivery estimate", "estimated arrival", "arrival"] },
  { needle: /\bnot arrived\b/gi, replacements: ["not delivered", "delayed", "in transit"] },
  { needle: /\btracking\b/gi, replacements: ["shipment", "carrier"] },
  { needle: /\broyalmail\b/gi, replacements: ["royal mail"] },
  { needle: /\bgooglemail\.com\b/gi, replacements: ["gmail.com"] },
];

const unique = <T>(values: T[]) => Array.from(new Set(values));

const andAll = (...conditions: Array<SQL | undefined>) => {
  const filtered = conditions.filter((condition): condition is SQL => Boolean(condition));
  return filtered.length ? and(...filtered) : undefined;
};

const orAll = (...conditions: Array<SQL | undefined>) => {
  const filtered = conditions.filter((condition): condition is SQL => Boolean(condition));
  return filtered.length ? or(...filtered) : undefined;
};

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();

const normalizeTrackingNumber = (value: string) => value.trim().replace(/\s+/g, "").toUpperCase();

const stripHtml = (value: string) =>
  normalizeWhitespace(
    value
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&"),
  );

const toISOStringOrNull = (value: Date | string | null | undefined) => {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
};

const snippetFromText = (value: string | null | undefined, highlight?: string | null, maxLength = 220) => {
  const normalized = normalizeWhitespace(stripHtml(value ?? ""));
  if (!normalized) return null;

  if (highlight) {
    const index = normalized.toLowerCase().indexOf(highlight.toLowerCase());
    if (index >= 0) {
      const start = Math.max(0, index - 80);
      const end = Math.min(normalized.length, index + highlight.length + 80);
      const prefix = start > 0 ? "…" : "";
      const suffix = end < normalized.length ? "…" : "";
      return `${prefix}${normalized.slice(start, end)}${suffix}`;
    }
  }

  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
};

const daysSince = (value: Date | string | null | undefined) => {
  if (!value) return 365;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 365;
  return Math.max(0, (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
};

const recencyBoost = (value: Date | string | null | undefined) => {
  const ageInDays = daysSince(value);
  return Math.max(0, 20 - Math.min(ageInDays, 20));
};

const baseFieldScore: Record<TicketMatchField, number> = {
  conversation_id: 160,
  slug: 155,
  customer: 130,
  customer_name: 110,
  subject: 125,
  message: 100,
  note: 90,
  event: 80,
  issue_group: 95,
  tracking: 175,
  carrier: 85,
  country: 80,
};

const scoreMatch = ({
  field,
  exact,
  updatedAt,
}: {
  field: TicketMatchField;
  exact: boolean;
  updatedAt: Date | string | null | undefined;
}) => {
  let score = baseFieldScore[field] + recencyBoost(updatedAt);
  if (exact) score += 40;
  return score;
};

const buildBroadenedQueries = (freeText: string) => {
  const normalized = normalizeWhitespace(freeText);
  if (!normalized) return [];

  const broadened = new Set<string>([normalized]);
  for (const rule of BROADENING_RULES) {
    if (!rule.needle.test(normalized)) continue;
    for (const replacement of rule.replacements) {
      broadened.add(normalized.replace(rule.needle, replacement));
    }
  }

  return Array.from(broadened).filter(Boolean);
};

const parseStatusList = (raw: string) =>
  raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry): entry is ConversationStatus => SEARCHABLE_STATUSES.includes(entry as ConversationStatus));

const extractPotentialTrackingNumbers = (value: string) =>
  unique(
    Array.from(value.toUpperCase().matchAll(TRACKING_PATTERN))
      .map((match) => normalizeTrackingNumber(match[0]))
      .filter((tracking) => tracking.length >= 8),
  );

export const parseTicketSearchQuery = (rawQuery: string): ParsedTicketSearchQuery => {
  const operators: TicketSearchOperators = {
    from: [],
    subject: [],
    status: [],
    tracking: [],
    carrier: [],
    country: [],
    id: [],
    slug: [],
  };

  const consumed = new Set<string>();
  const operatorPattern = /(\b[a-z_]+):(?:"([^"]+)"|(\S+))/gi;
  let match: RegExpExecArray | null = null;

  while ((match = operatorPattern.exec(rawQuery)) !== null) {
    const key = match[1]?.toLowerCase();
    const value = normalizeWhitespace(match[2] ?? match[3] ?? "");
    if (!key || !value) continue;

    const alias = OPERATOR_ALIASES[key];
    if (!alias) continue;

    consumed.add(match[0]);

    if (alias === "status") {
      operators.status.push(...parseStatusList(value));
    } else if (alias === "id") {
      const id = Number.parseInt(value, 10);
      if (Number.isInteger(id) && id > 0) operators.id.push(id);
    } else if (alias === "slug") {
      operators.slug.push(value.toLowerCase());
    } else if (alias === "tracking") {
      operators.tracking.push(normalizeTrackingNumber(value));
    } else if (alias === "from") {
      operators.from.push(value.toLowerCase());
    } else {
      operators[alias].push(value);
    }
  }

  const freeText = normalizeWhitespace(
    rawQuery
      .split(/\s+/)
      .filter((token) => !consumed.has(token))
      .join(" ")
      .replace(operatorPattern, " "),
  );

  if (freeText && EMAIL_PATTERN.test(freeText)) {
    operators.from.push(freeText.toLowerCase());
  }
  if (freeText && SLUG_PATTERN.test(freeText)) {
    operators.slug.push(freeText.toLowerCase());
  }
  if (freeText && /^\d+$/.test(freeText)) {
    const parsedId = Number.parseInt(freeText, 10);
    if (Number.isInteger(parsedId) && parsedId > 0) {
      operators.id.push(parsedId);
    }
  }

  operators.tracking.push(...extractPotentialTrackingNumbers(rawQuery));

  operators.from = unique(operators.from);
  operators.subject = unique(operators.subject);
  operators.status = unique(operators.status);
  operators.tracking = unique(operators.tracking);
  operators.carrier = unique(operators.carrier.map((value) => value.toLowerCase()));
  operators.country = unique(operators.country.map((value) => value.toLowerCase()));
  operators.id = unique(operators.id);
  operators.slug = unique(operators.slug);

  return {
    raw: rawQuery,
    freeText,
    operators,
    broadenedQueries: buildBroadenedQueries(freeText),
  };
};

const conversationSelection = {
  conversationId: conversations.id,
  conversationSlug: conversations.slug,
  conversationStatus: conversations.status,
  conversationSubject: conversations.subject,
  customerEmail: conversations.emailFrom,
  customerName: platformCustomers.name,
  assignedToId: conversations.assignedToId,
  updatedAt: conversations.updatedAt,
  createdAt: conversations.createdAt,
  issueGroupId: conversations.issueGroupId,
  issueGroupTitle: issueGroups.title,
};

const buildConversationMatch = (
  row: ConversationRow,
  {
    source,
    matchedField,
    itemId,
    role,
    createdAt,
    matchedText,
    exact,
    snippet,
    metadata = {},
  }: {
    source: MatchSource;
    matchedField: TicketMatchField;
    itemId: number | null;
    role: string | null;
    createdAt: Date | string | null | undefined;
    matchedText: string | null;
    exact: boolean;
    snippet: string | null;
    metadata?: Record<string, string | number | boolean | null>;
  },
): TicketSearchMatch => ({
  conversationId: row.conversationId,
  conversationSlug: row.conversationSlug,
  conversationStatus: row.conversationStatus,
  conversationSubject: row.conversationSubject,
  customerEmail: row.customerEmail,
  customerName: row.customerName,
  assignedToId: row.assignedToId,
  updatedAt: toISOStringOrNull(row.updatedAt),
  issueGroupId: row.issueGroupId,
  issueGroupTitle: row.issueGroupTitle,
  source,
  matchedField,
  itemId,
  role,
  createdAt: toISOStringOrNull(createdAt),
  snippet,
  matchedText,
  score: scoreMatch({ field: matchedField, exact, updatedAt: row.updatedAt }),
  exact,
  metadata,
});

export async function findTicketMatches({
  query,
  filters = [],
  limit = 20,
  messageOrderBy = [desc(conversationMessages.id)],
}: FindTicketMatchesOptions): Promise<FindTicketMatchesResult> {
  const parsedQuery = parseTicketSearchQuery(query);
  const resultMap = new Map<string, TicketSearchMatch>();

  const baseConversationWhere = andAll(
    isNull(conversations.mergedIntoId),
    ...filters,
    parsedQuery.operators.status.length ? inArray(conversations.status, parsedQuery.operators.status) : undefined,
  );

  const pushMatch = (match: TicketSearchMatch) => {
    const key = [
      match.conversationId,
      match.source,
      match.matchedField,
      match.itemId ?? "conversation",
      match.matchedText ?? "",
    ].join(":");
    const existing = resultMap.get(key);
    if (!existing || existing.score < match.score) {
      resultMap.set(key, match);
    }
  };

  const searchMessageText = async (phrases: string[], matchedField: TicketMatchField) => {
    for (const phrase of unique(phrases.map((value) => normalizeWhitespace(value)).filter(Boolean))) {
      const searchIndex = (await extractHashedWordsFromEmail({ body: phrase })).join(" ");
      const textCondition = orAll(
        searchIndex
          ? sql`string_to_array(${conversationMessages.searchIndex}, ' ') @> string_to_array(${searchIndex}, ' ')`
          : undefined,
        ilike(conversationMessages.cleanedUpText, `%${phrase}%`),
      );
      if (!textCondition) continue;

      const rows = await db
        .select({
          ...conversationSelection,
          itemId: conversationMessages.id,
          role: conversationMessages.role,
          createdAt: conversationMessages.createdAt,
          cleanedUpText: conversationMessages.cleanedUpText,
          body: conversationMessages.body,
        })
        .from(conversationMessages)
        .innerJoin(conversations, eq(conversationMessages.conversationId, conversations.id))
        .leftJoin(platformCustomers, eq(conversations.emailFrom, platformCustomers.email))
        .leftJoin(issueGroups, eq(conversations.issueGroupId, issueGroups.id))
        .where(andAll(baseConversationWhere, isNull(conversationMessages.deletedAt), textCondition))
        .orderBy(...messageOrderBy)
        .limit(MAX_SOURCE_RESULTS);

      for (const row of rows) {
        const exact =
          normalizeWhitespace(row.cleanedUpText ?? "").toLowerCase().includes(phrase.toLowerCase()) ||
          normalizeWhitespace(stripHtml(row.body ?? "")).toLowerCase().includes(phrase.toLowerCase());
        pushMatch(
          buildConversationMatch(row, {
            source: "message",
            matchedField,
            itemId: row.itemId,
            role: row.role,
            createdAt: row.createdAt,
            matchedText: phrase,
            exact,
            snippet: snippetFromText(row.cleanedUpText ?? row.body, phrase),
          }),
        );
      }
    }
  };

  const searchNoteText = async (phrases: string[]) => {
    for (const phrase of unique(phrases.map((value) => normalizeWhitespace(value)).filter(Boolean))) {
      const rows = await db
        .select({
          ...conversationSelection,
          itemId: notes.id,
          role: notes.role,
          createdAt: notes.createdAt,
          body: notes.body,
        })
        .from(notes)
        .innerJoin(conversations, eq(notes.conversationId, conversations.id))
        .leftJoin(platformCustomers, eq(conversations.emailFrom, platformCustomers.email))
        .leftJoin(issueGroups, eq(conversations.issueGroupId, issueGroups.id))
        .where(andAll(baseConversationWhere, ilike(notes.body, `%${phrase}%`)))
        .orderBy(desc(notes.createdAt))
        .limit(MAX_SOURCE_RESULTS);

      for (const row of rows) {
        pushMatch(
          buildConversationMatch(row, {
            source: "note",
            matchedField: "note",
            itemId: row.itemId,
            role: row.role ?? "staff",
            createdAt: row.createdAt,
            matchedText: phrase,
            exact: normalizeWhitespace(row.body ?? "").toLowerCase().includes(phrase.toLowerCase()),
            snippet: snippetFromText(row.body, phrase),
          }),
        );
      }
    }
  };

  const searchEventText = async (phrases: string[]) => {
    for (const phrase of unique(phrases.map((value) => normalizeWhitespace(value)).filter(Boolean))) {
      const rows = await db
        .select({
          ...conversationSelection,
          itemId: conversationEvents.id,
          createdAt: conversationEvents.createdAt,
          eventType: conversationEvents.type,
          reason: conversationEvents.reason,
          changes: conversationEvents.changes,
        })
        .from(conversationEvents)
        .innerJoin(conversations, eq(conversationEvents.conversationId, conversations.id))
        .leftJoin(platformCustomers, eq(conversations.emailFrom, platformCustomers.email))
        .leftJoin(issueGroups, eq(conversations.issueGroupId, issueGroups.id))
        .where(
          andAll(
            baseConversationWhere,
            orAll(
              ilike(conversationEvents.reason, `%${phrase}%`),
              ilike(conversationEvents.type, `%${phrase}%`),
              sql`${conversationEvents.changes}::text ILIKE ${`%${phrase}%`}`,
            ),
          ),
        )
        .orderBy(desc(conversationEvents.createdAt))
        .limit(MAX_SOURCE_RESULTS);

      for (const row of rows) {
        const snippet = snippetFromText(`${row.reason ?? row.eventType} ${JSON.stringify(row.changes ?? {})}`, phrase);
        pushMatch(
          buildConversationMatch(row, {
            source: "event",
            matchedField: "event",
            itemId: row.itemId,
            role: null,
            createdAt: row.createdAt,
            matchedText: phrase,
            exact: snippet?.toLowerCase().includes(phrase.toLowerCase()) ?? false,
            snippet,
          }),
        );
      }
    }
  };

  const searchConversationMetadata = async ({
    phrases,
    matchedField,
    whereFactory,
  }: {
    phrases: string[];
    matchedField: TicketMatchField;
    whereFactory: (phrase: string) => SQL | undefined;
  }) => {
    for (const phrase of unique(phrases.map((value) => normalizeWhitespace(value)).filter(Boolean))) {
      const rows = await db
        .select(conversationSelection)
        .from(conversations)
        .leftJoin(platformCustomers, eq(conversations.emailFrom, platformCustomers.email))
        .leftJoin(issueGroups, eq(conversations.issueGroupId, issueGroups.id))
        .where(andAll(baseConversationWhere, whereFactory(phrase)))
        .orderBy(desc(conversations.updatedAt))
        .limit(MAX_SOURCE_RESULTS);

      for (const row of rows) {
        const matchedText =
          matchedField === "subject"
            ? row.conversationSubject
            : matchedField === "customer"
              ? row.customerEmail
              : matchedField === "customer_name"
                ? row.customerName
                : matchedField === "issue_group"
                  ? row.issueGroupTitle
                  : matchedField === "slug"
                    ? row.conversationSlug
                    : `${row.conversationId}`;
        const exact = matchedText?.toLowerCase() === phrase.toLowerCase() || matchedText?.includes(phrase) || false;
        pushMatch(
          buildConversationMatch(row, {
            source: "conversation",
            matchedField,
            itemId: null,
            role: null,
            createdAt: row.createdAt,
            matchedText,
            exact,
            snippet: snippetFromText(
              matchedField === "subject"
                ? row.conversationSubject
                : matchedField === "customer_name"
                  ? row.customerName
                  : matchedField === "issue_group"
                    ? row.issueGroupTitle
                    : matchedText,
              phrase,
            ),
          }),
        );
      }
    }
  };

  if (parsedQuery.operators.id.length) {
    await searchConversationMetadata({
      phrases: parsedQuery.operators.id.map((id) => `${id}`),
      matchedField: "conversation_id",
      whereFactory: (phrase) => {
        const id = Number.parseInt(phrase, 10);
        return Number.isInteger(id) && id > 0 ? eq(conversations.id, id) : undefined;
      },
    });
  }

  if (parsedQuery.operators.slug.length) {
    await searchConversationMetadata({
      phrases: parsedQuery.operators.slug,
      matchedField: "slug",
      whereFactory: (phrase) => eq(conversations.slug, phrase.toLowerCase()),
    });
  }

  if (parsedQuery.operators.from.length) {
    await searchConversationMetadata({
      phrases: parsedQuery.operators.from,
      matchedField: "customer",
      whereFactory: (phrase) => ilike(conversations.emailFrom, `%${phrase.toLowerCase()}%`),
    });
  }

  if (parsedQuery.operators.subject.length) {
    await searchConversationMetadata({
      phrases: parsedQuery.operators.subject,
      matchedField: "subject",
      whereFactory: (phrase) => ilike(conversations.subject, `%${phrase}%`),
    });
  }

  if (parsedQuery.operators.tracking.length) {
    await searchMessageText(parsedQuery.operators.tracking, "tracking");
  }

  if (parsedQuery.operators.carrier.length) {
    await searchMessageText(parsedQuery.operators.carrier, "carrier");
    await searchConversationMetadata({
      phrases: parsedQuery.operators.carrier,
      matchedField: "subject",
      whereFactory: (phrase) => ilike(conversations.subject, `%${phrase}%`),
    });
  }

  if (parsedQuery.operators.country.length) {
    await searchMessageText(parsedQuery.operators.country, "country");
    await searchConversationMetadata({
      phrases: parsedQuery.operators.country,
      matchedField: "subject",
      whereFactory: (phrase) => ilike(conversations.subject, `%${phrase}%`),
    });
  }

  if (parsedQuery.freeText) {
    const initialQueries = [parsedQuery.freeText];
    await searchConversationMetadata({
      phrases: initialQueries,
      matchedField: "subject",
      whereFactory: (phrase) =>
        orAll(
          ilike(conversations.subject, `%${phrase}%`),
          ilike(conversations.emailFrom, `%${phrase}%`),
          ilike(platformCustomers.name, `%${phrase}%`),
          ilike(issueGroups.title, `%${phrase}%`),
        ),
    });
    await searchMessageText(initialQueries, "message");
    await searchNoteText(initialQueries);
    await searchEventText(initialQueries);
  }

  if (!resultMap.size && parsedQuery.broadenedQueries.length > 1) {
    const broadened = parsedQuery.broadenedQueries.slice(1);
    await searchConversationMetadata({
      phrases: broadened,
      matchedField: "subject",
      whereFactory: (phrase) =>
        orAll(
          ilike(conversations.subject, `%${phrase}%`),
          ilike(conversations.emailFrom, `%${phrase}%`),
          ilike(platformCustomers.name, `%${phrase}%`),
          ilike(issueGroups.title, `%${phrase}%`),
        ),
    });
    await searchMessageText(broadened, "message");
    await searchNoteText(broadened);
    await searchEventText(broadened);
  }

  const matches = Array.from(resultMap.values())
    .sort((left, right) => right.score - left.score || (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""))
    .slice(0, Math.min(Math.max(limit, 1), MAX_RETURNED_MATCHES));

  return {
    parsedQuery,
    matches,
  };
}
