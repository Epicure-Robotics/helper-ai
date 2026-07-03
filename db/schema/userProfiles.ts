import { relations } from "drizzle-orm";
import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { LeadRoutingRole } from "@/lib/leads/inboundTriage";
import { authUsers } from "../supabaseSchema/auth";

/** Legacy JSON may still contain "core" | "nonCore" — normalize to active/afk when reading. */
export type MailboxAccessRole = "active" | "afk" | "core" | "nonCore";

// Created automatically when a user is inserted via a Postgres trigger. See db/drizzle/0101_complete_wraith.sql
export const userProfiles = pgTable("user_profiles", {
  id: uuid()
    .primaryKey()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  displayName: text().default(""),
  permissions: text().notNull().default("member"), // "member" or "admin"
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp().defaultNow(),
  updatedAt: timestamp()
    .defaultNow()
    .$onUpdate(() => new Date()),
  access: jsonb("access")
    .$type<{
      role?: MailboxAccessRole;
      keywords: string[];
      /** @deprecated use routingRoles */
      routingRole?: LeadRoutingRole | null;
      /** Inbox categories this member handles (inbound triage). Admins match all categories regardless. */
      routingRoles?: LeadRoutingRole[];
    }>()
    .default({ role: "active", keywords: [], routingRoles: [] }),
  pinnedIssueGroupIds: jsonb("pinned_issue_group_ids").$type<number[]>().default([]),
  preferences: jsonb()
    .$type<{
      autoAssignOnReply?: boolean;
      disableEmailSignature?: boolean;
      notifications?: {
        webPushEnabled?: boolean;
        inAppToastEnabled?: boolean;
        notifyOnNewMessage?: boolean;
        notifyOnAssignment?: boolean;
        notifyOnNote?: boolean;
        emailOnAssignment?: boolean;
      };
    }>()
    .default({}),
}).enableRLS();

export const userProfilesRelations = relations(userProfiles, ({ one }) => ({
  user: one(authUsers, {
    fields: [userProfiles.id],
    references: [authUsers.id],
  }),
}));

export type BasicUserProfile = { id: string; displayName: string | null; email: string | null };
export type FullUserProfile = typeof userProfiles.$inferSelect & { email: string | null };
