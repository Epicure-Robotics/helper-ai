import { eq, getTableColumns, isNull } from "drizzle-orm";
import { cache } from "react";
import { takeUniqueOrThrow } from "@/components/utils/arrays";
import { db } from "@/db/client";
import { FullUserProfile, userProfiles } from "@/db/schema/userProfiles";
import { authUsers } from "@/db/supabaseSchema/auth";
import type { LeadRoutingRole } from "@/lib/leads/inboundTriage";
import { createAdminClient } from "@/lib/supabase/server";
import { getFirstName, getFullName } from "../auth/authUtils";

/** Assignment presence: active members receive auto-assign; away members do not. Legacy `core` / `nonCore` normalize to active. */
export type UserPresence = "active" | "afk";

export const UserPresence = {
  ACTIVE: "active" as const,
  AFK: "afk" as const,
};

type AccessRow = NonNullable<(typeof userProfiles.$inferSelect)["access"]>;

export const normalizeMailboxPresence = (raw: string | undefined): UserPresence => {
  if (raw === UserPresence.AFK) return UserPresence.AFK;
  return UserPresence.ACTIVE;
};

export const normalizeRoutingRoles = (access: AccessRow | null | undefined): LeadRoutingRole[] => {
  if (!access) return [];
  if (access.routingRoles?.length) {
    return [...new Set(access.routingRoles)];
  }
  if (access.routingRole) {
    return [access.routingRole];
  }
  return [];
};

export const memberMatchesInboundTarget = (
  member: { permissions: string; routingRoles: LeadRoutingRole[] },
  target: LeadRoutingRole,
): boolean => {
  if (member.permissions === "admin") return true;
  return member.routingRoles.includes(target);
};

export type UserWithMailboxAccessData = {
  id: string;
  displayName: string;
  email: string | undefined;
  /** Active = eligible for assignment; away = excluded. */
  role: UserPresence;
  keywords: string[];
  routingRoles: LeadRoutingRole[];
  permissions: string;
  emailOnAssignment: boolean;
};

const rowToMember = (user: {
  id: string;
  displayName: string | null;
  email: string | null;
  permissions: string | null;
  access: AccessRow | null;
  preferences: (typeof userProfiles.$inferSelect)["preferences"];
}): UserWithMailboxAccessData => {
  const access = user.access ?? { keywords: [] };
  const permissions = user.permissions ?? "member";

  return {
    id: user.id,
    displayName: getFullName({ displayName: user.displayName, email: user.email }),
    email: user.email ?? undefined,
    role: normalizeMailboxPresence(access.role),
    keywords: access.keywords ?? [],
    routingRoles: normalizeRoutingRoles(access),
    permissions,
    emailOnAssignment: user.preferences?.notifications?.emailOnAssignment ?? false,
  };
};

export const getProfile = cache(
  async (userId: string) => await db.query.userProfiles.findFirst({ where: eq(userProfiles.id, userId) }),
);

export const getBasicProfileById = cache(async (userId: string) => {
  const [user] = await db
    .select({ id: userProfiles.id, displayName: userProfiles.displayName, email: authUsers.email })
    .from(userProfiles)
    .innerJoin(authUsers, eq(userProfiles.id, authUsers.id))
    .where(eq(userProfiles.id, userId));
  return user ?? null;
});

export const getBasicProfileByEmail = cache(async (email: string) => {
  const [user] = await db
    .select({ id: userProfiles.id, displayName: userProfiles.displayName, email: authUsers.email })
    .from(userProfiles)
    .innerJoin(authUsers, eq(userProfiles.id, authUsers.id))
    .where(eq(authUsers.email, email));
  return user ?? null;
});

export const getFullProfileById = cache(async (userId: string): Promise<FullUserProfile | null> => {
  const [user] = await db
    .select({ ...getTableColumns(userProfiles), email: authUsers.email })
    .from(userProfiles)
    .innerJoin(authUsers, eq(userProfiles.id, authUsers.id))
    .where(eq(userProfiles.id, userId));
  return user ?? null;
});

export const getFullProfileByEmail = cache(async (email: string): Promise<FullUserProfile | null> => {
  const [user] = await db
    .select({ ...getTableColumns(userProfiles), email: authUsers.email })
    .from(userProfiles)
    .innerJoin(authUsers, eq(userProfiles.id, authUsers.id))
    .where(eq(authUsers.email, email));
  return user ?? null;
});

export const isAdmin = (profile?: typeof userProfiles.$inferSelect) => profile?.permissions === "admin";

export const addUser = async (
  inviterUserId: string,
  emailAddress: string,
  displayName: string,
  permission?: string,
) => {
  const supabase = createAdminClient();
  const { error } = await supabase.auth.admin.createUser({
    email: emailAddress,
    user_metadata: {
      inviter_user_id: inviterUserId,
      display_name: displayName,
      permissions: permission ?? "member",
    },
  });
  if (error) throw error;
};

export const banUser = async (userId: string) => {
  await db
    .update(userProfiles)
    .set({
      deletedAt: new Date(),
    })
    .where(eq(userProfiles.id, userId));
};

export const getUsersWithMailboxAccess = async (): Promise<UserWithMailboxAccessData[]> => {
  const users = await db
    .select({
      id: userProfiles.id,
      email: authUsers.email,
      displayName: userProfiles.displayName,
      permissions: userProfiles.permissions,
      access: userProfiles.access,
      preferences: userProfiles.preferences,
    })
    .from(authUsers)
    .innerJoin(userProfiles, eq(authUsers.id, userProfiles.id))
    .where(isNull(userProfiles.deletedAt));

  return users.map(rowToMember);
};

export const updateUserMailboxData = async (
  userId: string,
  updates: {
    displayName?: string;
    role?: UserPresence;
    keywords?: string[];
    routingRoles?: LeadRoutingRole[];
    permissions?: string;
    emailOnAssignment?: boolean;
  },
): Promise<UserWithMailboxAccessData> => {
  const currentUser = await db.query.userProfiles.findFirst({
    where: eq(userProfiles.id, userId),
    columns: {
      access: true,
      preferences: true,
    },
  });

  const currentAccess = currentUser?.access ?? { keywords: [] };
  const currentPreferences = currentUser?.preferences ?? {};

  const updateData: Record<string, unknown> = {};

  if (updates.displayName !== undefined) {
    updateData.displayName = updates.displayName;
  }

  if (updates.role !== undefined || updates.keywords !== undefined || updates.routingRoles !== undefined) {
    updateData.access = {
      ...currentAccess,
      ...(updates.role !== undefined ? { role: updates.role } : {}),
      ...(updates.keywords !== undefined ? { keywords: updates.keywords } : {}),
      ...(updates.routingRoles !== undefined ? { routingRoles: updates.routingRoles, routingRole: null } : {}),
    };
  }

  if (updates.permissions !== undefined) {
    updateData.permissions = updates.permissions;
  }

  if (updates.emailOnAssignment !== undefined) {
    const currentNotifications = currentPreferences.notifications ?? {};
    updateData.preferences = {
      ...currentPreferences,
      notifications: {
        ...currentNotifications,
        emailOnAssignment: updates.emailOnAssignment,
      },
    };
  }

  await db.update(userProfiles).set(updateData).where(eq(userProfiles.id, userId));

  const updatedProfile = await db
    .select({
      id: userProfiles.id,
      displayName: userProfiles.displayName,
      access: userProfiles.access,
      permissions: userProfiles.permissions,
      preferences: userProfiles.preferences,
      email: authUsers.email,
    })
    .from(userProfiles)
    .innerJoin(authUsers, eq(userProfiles.id, authUsers.id))
    .where(eq(userProfiles.id, userId))
    .then(takeUniqueOrThrow);

  return rowToMember(updatedProfile);
};

export const getStaffName = async (userId: string | null) => {
  if (!userId) return null;
  const user = await getBasicProfileById(userId);
  return user ? getFirstName(user) : null;
};
