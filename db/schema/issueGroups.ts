import { relations } from "drizzle-orm";
import { bigint, index, integer, jsonb, pgTable, text, vector } from "drizzle-orm/pg-core";
import { withTimestamps } from "../lib/with-timestamps";
import { conversations } from "./conversations";
import { issueGroupConditions } from "./issueGroupConditions";
import { issueSubgroups } from "./issueSubgroups";

export const issueGroups = pgTable(
  "issue_groups",
  {
    ...withTimestamps,
    id: bigint({ mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    title: text().notNull(),
    description: text(),
    embedding: vector({ dimensions: 1536 }),
    assignees: jsonb().$type<string[]>().default([]),
    lastAssignedIndex: integer().default(0),
    color: text(),
    customPrompt: text(),
    /**
     * Founder-written answer for this category. When set, automated replies are built from this
     * text instead of the AI answering from the knowledge base; empty falls back to the AI.
     */
    standardAnswer: text("standard_answer"),
    autoResponseEnabled: integer().default(0).notNull(),
    defaultSavedReplyId: bigint({ mode: "number" }),
  },
  (table) => [
    index("issue_groups_created_at_idx").on(table.createdAt),
    index("issue_groups_embedding_idx").using("hnsw", table.embedding.asc().nullsLast().op("vector_cosine_ops")),
  ],
).enableRLS();

export const issueGroupsRelations = relations(issueGroups, ({ many }) => ({
  conversations: many(conversations),
  conditions: many(issueGroupConditions),
  subgroups: many(issueSubgroups),
}));
