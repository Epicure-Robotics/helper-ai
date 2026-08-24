/**
 * Gives team members sensible lead-routing defaults so inbound routing works without clicking
 * through Settings → Team for every person.
 *
 * Two things gate routing, and both fail quietly:
 *  - `getAssignableMembers` only considers members whose presence is "active"; if everyone is away,
 *    auto-assign finds nobody and the lead sits unassigned with only a console line to say so.
 *  - `memberMatchesInboundTarget` matches admins on every role, so admins need no explicit roles —
 *    but a non-admin with an empty list matches nothing and is skipped.
 *
 * Assigns every routing role to admins (explicit, so the UI reflects what actually happens) and
 * `general` to members, and reports anyone marked away.
 *
 * Usage:
 *   pnpm team:default-roles              # dry run
 *   pnpm team:default-roles --apply
 *   pnpm team:default-roles --apply --activate   # also clear "away" presence
 */

import { eq, isNull } from "drizzle-orm";
import { userProfiles } from "@/db/schema";
import { LEAD_ROUTING_ROLE_ORDER } from "@/lib/leads/inboundTriage";
import { scriptDb, scriptPool } from "./lib/dbOnly";

async function main() {
  const apply = process.argv.includes("--apply");
  const activate = process.argv.includes("--activate");

  const members = await scriptDb
    .select({
      id: userProfiles.id,
      name: userProfiles.displayName,
      perms: userProfiles.permissions,
      access: userProfiles.access,
    })
    .from(userProfiles)
    .where(isNull(userProfiles.deletedAt));

  if (members.length === 0) {
    console.log("No team members found.");
    return;
  }

  let changed = 0;
  for (const m of members) {
    const access = m.access ?? { role: "active" as const, keywords: [], routingRoles: [] };
    const isAdmin = m.perms === "admin";
    const current = access.routingRoles ?? (access.routingRole ? [access.routingRole] : []);
    const desired =
      current.length > 0 ? current : isAdmin ? [...LEAD_ROUTING_ROLE_ORDER] : (["general"] as const).slice();
    const away = access.role === "afk";
    const nextPresence = away && activate ? "active" : (access.role ?? "active");

    const rolesChange = desired.length !== current.length;
    const presenceChange = nextPresence !== access.role;
    const label = `${m.name || "(no name)"} [${m.perms}]`;

    if (!rolesChange && !presenceChange) {
      console.log(`  unchanged  ${label} roles=${current.join(",") || "none"} presence=${access.role ?? "active"}`);
      continue;
    }

    console.log(
      `  ${apply ? "update   " : "would set"}  ${label} roles=${desired.join(",")}${presenceChange ? `  presence=${access.role} → ${nextPresence}` : ""}`,
    );
    if (away && !activate) {
      console.log(
        `             ↳ still marked away, so auto-assign will skip them. Re-run with --activate to clear it.`,
      );
    }

    if (apply) {
      await scriptDb
        .update(userProfiles)
        .set({ access: { ...access, role: nextPresence, keywords: access.keywords ?? [], routingRoles: desired } })
        .where(eq(userProfiles.id, m.id));
      changed++;
    }
  }

  console.log(apply ? `\nUpdated ${changed} member(s).` : "\nDry run — nothing written. Re-run with --apply.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => scriptPool.end());
