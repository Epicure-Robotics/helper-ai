import { TRPCError, TRPCRouterRecord } from "@trpc/server";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { assertDefined } from "@/components/utils/assert";
import { db } from "@/db/client";
import { pushSubscriptions, userProfiles, webNotifications } from "@/db/schema";
import { authUsers } from "@/db/supabaseSchema/auth";
import { setupMailboxForNewUser } from "@/lib/auth/authService";
import { cacheFor } from "@/lib/cache";
import OtpEmail from "@/lib/emails/otp";
import { isSmtpConfigured, sendEmail } from "@/lib/emails/sendEmail";
import { env } from "@/lib/env";
import { captureExceptionAndLog } from "@/lib/shared/sentry";
import { createAdminClient } from "@/lib/supabase/server";
import { protectedProcedure, publicProcedure } from "../trpc";

// Local development (never a production build). In dev we surface the OTP directly so login
// works even when SMTP is misconfigured/unavailable; this stays off in any production deploy.
const isLocalDevEnv = process.env.NODE_ENV !== "production" && !env.VERCEL;
const safeToSendBackOTP = !env.VERCEL && (env.AUTH_URL === "https://helperai.dev" || isLocalDevEnv);

export const userRouter = {
  startSignIn: publicProcedure.input(z.object({ email: z.string() })).mutation(async ({ input }) => {
    const [user] = await db
      .select({ id: authUsers.id, email: authUsers.email, deletedAt: userProfiles.deletedAt })
      .from(authUsers)
      .innerJoin(userProfiles, eq(authUsers.id, userProfiles.id))
      .where(and(eq(authUsers.email, input.email), isNull(userProfiles.deletedAt)));

    if (!user) {
      if (isSignupPossible(input.email)) {
        return { signupPossible: true };
      }

      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "User not found",
      });
    }

    const { data, error } = await createAdminClient().auth.admin.generateLink({
      type: "recovery",
      email: user.email ?? "",
    });
    if (error) {
      captureExceptionAndLog(error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Failed to generate OTP: ${error.message}`,
      });
    }

    if (isSmtpConfigured()) {
      try {
        await sendEmail({
          to: assertDefined(user.email),
          subject: "Your Epicure Assist sign-in code",
          react: OtpEmail({ otp: data.properties.email_otp }),
        });
        return { email: true };
      } catch (error) {
        captureExceptionAndLog(error);
        // In production a failed OTP email is fatal. In local dev, fall through to the
        // cache + dashboard-link path (and safeToSendBackOTP) so broken SMTP doesn't block login.
        if (!isLocalDevEnv) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Failed to send OTP: ${error instanceof Error ? error.message : "Unknown error"}`,
          });
        }
      }
    }

    await cacheFor<string>(`otp:${user.id}`).set(data.properties.email_otp.toString(), 60 * 5);
    let dashboardUrl: string | null = null;
    const [_, projectId] = /https:\/\/([a-zA-Z0-9_-]+)\.supabase\.co/.exec(env.NEXT_PUBLIC_SUPABASE_URL) ?? [];
    if (projectId) {
      const {
        rows: [cacheTable],
      } = await db.execute(sql`
        SELECT c.oid AS id
        FROM pg_class c
        JOIN pg_namespace nc ON nc.oid = c.relnamespace
        WHERE c.relname = 'cache' AND nc.nspname = 'public'
      `);
      dashboardUrl = `https://supabase.com/dashboard/project/${projectId}/editor/${cacheTable?.id}?filter=key:eq:otp:${user.id}`;
    }
    return { email: false, dashboardUrl, otp: safeToSendBackOTP ? data.properties.email_otp : undefined };
  }),
  createUser: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        displayName: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      if (!isSignupPossible(input.email)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Signup is not possible for this email domain",
        });
      }

      const supabase = createAdminClient();
      const { error } = await supabase.auth.admin.createUser({
        email: input.email,
        user_metadata: {
          display_name: input.displayName,
        },
      });
      if (error) throw error;

      return { success: true };
    }),
  onboard: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        displayName: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const existingMailbox = await db.query.mailboxes.findFirst({
        columns: { id: true },
      });

      if (existingMailbox) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A mailbox already exists. Please use the login form instead.",
        });
      }

      const supabase = createAdminClient();
      const { data: userData, error: createUserError } = await supabase.auth.admin.createUser({
        email: input.email,
        user_metadata: {
          display_name: input.displayName,
          permissions: "admin",
        },
        email_confirm: true,
      });

      if (createUserError) throw createUserError;
      if (!userData.user) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create user",
        });
      }

      await setupMailboxForNewUser(userData.user);

      const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
        type: "recovery",
        email: userData.user.email ?? "",
      });

      if (linkError) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to generate OTP",
        });
      }

      return {
        otp: linkData.properties.email_otp,
      };
    }),

  currentUser: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.user) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    const userId = ctx.user.id;

    const [user] = await db
      .select({
        id: authUsers.id,
        email: authUsers.email,
        displayName: userProfiles.displayName,
        permissions: userProfiles.permissions,
        preferences: userProfiles.preferences,
      })
      .from(authUsers)
      .innerJoin(userProfiles, eq(authUsers.id, userProfiles.id))
      .where(eq(authUsers.id, userId));

    if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });
    return user;
  }),

  update: protectedProcedure
    .input(
      z.object({
        preferences: z
          .object({
            autoAssignOnReply: z.boolean().optional(),
            disableEmailSignature: z.boolean().optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      const [currentProfile] = await db.select().from(userProfiles).where(eq(userProfiles.id, ctx.user.id));
      if (!currentProfile) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User profile not found" });
      }

      await db
        .update(userProfiles)
        .set({ preferences: { ...currentProfile.preferences, ...input.preferences } })
        .where(eq(userProfiles.id, ctx.user.id));
    }),

  // Push notification subscription management
  subscribeToPush: protectedProcedure
    .input(
      z.object({
        endpoint: z.string(),
        p256dh: z.string(),
        auth: z.string(),
        userAgent: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });

      const [subscription] = await db
        .insert(pushSubscriptions)
        .values({
          userId: ctx.user.id,
          endpoint: input.endpoint,
          p256dh: input.p256dh,
          auth: input.auth,
          userAgent: input.userAgent,
          lastUsedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [pushSubscriptions.userId, pushSubscriptions.endpoint],
          set: {
            p256dh: input.p256dh,
            auth: input.auth,
            userAgent: input.userAgent,
            lastUsedAt: new Date(),
            updatedAt: new Date(),
          },
        })
        .returning();

      if (!subscription) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create subscription" });
      }

      return { success: true, subscriptionId: subscription.id };
    }),

  unsubscribeFromPush: protectedProcedure.input(z.object({ endpoint: z.string() })).mutation(async ({ ctx, input }) => {
    if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });

    await db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, ctx.user.id), eq(pushSubscriptions.endpoint, input.endpoint)));

    return { success: true };
  }),

  listPushSubscriptions: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });

    const subscriptions = await db
      .select({
        id: pushSubscriptions.id,
        endpoint: pushSubscriptions.endpoint,
        userAgent: pushSubscriptions.userAgent,
        createdAt: pushSubscriptions.createdAt,
        lastUsedAt: pushSubscriptions.lastUsedAt,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, ctx.user.id))
      .orderBy(desc(pushSubscriptions.createdAt));

    return { subscriptions };
  }),

  // Web notification history
  getWebNotifications: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        unreadOnly: z.boolean().default(false),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });

      const notifications = await db
        .select()
        .from(webNotifications)
        .where(
          and(eq(webNotifications.userId, ctx.user.id), input.unreadOnly ? isNull(webNotifications.readAt) : undefined),
        )
        .orderBy(desc(webNotifications.sentAt))
        .limit(input.limit);

      return { notifications };
    }),

  getUnreadNotificationCount: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });

    const [result] = await db
      .select({ count: sql<number>`count(*)` })
      .from(webNotifications)
      .where(and(eq(webNotifications.userId, ctx.user.id), isNull(webNotifications.readAt)));

    return { count: result?.count || 0 };
  }),

  markNotificationRead: protectedProcedure
    .input(z.object({ notificationId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });

      await db
        .update(webNotifications)
        .set({ readAt: new Date() })
        .where(and(eq(webNotifications.id, input.notificationId), eq(webNotifications.userId, ctx.user.id)));

      return { success: true };
    }),

  markAllNotificationsRead: protectedProcedure.mutation(async ({ ctx }) => {
    if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });

    const result = await db
      .update(webNotifications)
      .set({ readAt: new Date() })
      .where(and(eq(webNotifications.userId, ctx.user.id), isNull(webNotifications.readAt)))
      .returning({ id: webNotifications.id });

    return { count: result.length };
  }),

  // Notification preferences
  updateNotificationPreferences: protectedProcedure
    .input(
      z.object({
        webPushEnabled: z.boolean().optional(),
        inAppToastEnabled: z.boolean().optional(),
        notifyOnNewMessage: z.boolean().optional(),
        notifyOnAssignment: z.boolean().optional(),
        notifyOnNote: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });

      const [currentProfile] = await db.select().from(userProfiles).where(eq(userProfiles.id, ctx.user.id));
      if (!currentProfile) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User profile not found" });
      }

      const currentPrefs = currentProfile.preferences as any;
      const updatedNotificationPrefs = {
        ...currentPrefs?.notifications,
        ...input,
      };

      await db
        .update(userProfiles)
        .set({
          preferences: {
            ...currentPrefs,
            notifications: updatedNotificationPrefs,
          },
        })
        .where(eq(userProfiles.id, ctx.user.id));

      return { success: true };
    }),
} satisfies TRPCRouterRecord;

const isSignupPossible = (email: string) => {
  const [_, emailDomain] = email.split("@");
  if (!emailDomain) return false;
  // "*" allows signup from any email domain (staff sign in with personal emails, not a shared company domain).
  if (env.EMAIL_SIGNUP_DOMAINS.includes("*")) return true;
  if (env.EMAIL_SIGNUP_DOMAINS.some((domain) => domain === emailDomain)) return true;
  return false;
};
