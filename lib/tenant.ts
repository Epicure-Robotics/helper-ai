import { db } from "@/db/client";
import { mailboxes } from "@/db/schema";

/** Reserved for future multi-tenant routing (subdomain, org id, etc.). */
export const DEFAULT_TENANT_ID = 1;

export type MailboxRow = typeof mailboxes.$inferSelect;

export function getCurrentTenant() {
  return { id: DEFAULT_TENANT_ID };
}

/**
 * Single source of truth for the active mailbox in single-tenant mode.
 * Future: pass tenantId and filter when `mailboxes` gains a tenant column.
 */
export async function getCurrentMailbox(tenantId: number = DEFAULT_TENANT_ID): Promise<MailboxRow> {
  void tenantId;
  const mailbox = await db.query.mailboxes.findFirst({
    orderBy: (m, { asc }) => [asc(m.id)],
  });
  if (!mailbox) throw new Error("No mailbox configured");
  return mailbox;
}

/**
 * Loaded relations (e.g. Gmail support email) expose `mailboxes[]`;
 * single-tenant uses the first row.
 */
export function getPrimaryMailboxFromRelation<T>(row: { mailboxes?: T[] | null } | null | undefined): T | null {
  return row?.mailboxes?.[0] ?? null;
}
