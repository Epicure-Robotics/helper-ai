import { TRPCError, TRPCRouterRecord } from "@trpc/server";
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { takeUniqueOrThrow } from "@/components/utils/arrays";
import { db } from "@/db/client";
import {
  conversations,
  issueGroupConditions,
  issueGroups,
  issueSubgroups,
  mailboxes,
  platformCustomers,
  savedReplies,
  userProfiles,
} from "@/db/schema";
import { evaluateCondition } from "@/lib/ai/conditionChecker";
import { getRandomIssueColor } from "@/lib/issueColors";
import { mailboxProcedure } from "./procedure";

export const issueGroupsRouter = {
  list: mailboxProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(200).default(100),
        offset: z.number().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { limit, offset } = input;

      const now = new Date();
      const startOfLast30Days = new Date(now);
      startOfLast30Days.setDate(startOfLast30Days.getDate() - 30);
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startOfWeek = new Date(startOfToday);
      startOfWeek.setDate(startOfToday.getDate() - startOfToday.getDay());
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      const groupsWithCounts = await db
        .select({
          id: issueGroups.id,
          title: issueGroups.title,
          description: issueGroups.description,
          color: issueGroups.color,
          createdAt: issueGroups.createdAt,
          updatedAt: issueGroups.updatedAt,
          openCount: sql<number>`COUNT(${conversations.id})::int`,
          todayCount: sql<number>`COUNT(CASE WHEN ${conversations.createdAt} >= ${startOfToday}::timestamp THEN 1 END)::int`,
          weekCount: sql<number>`COUNT(CASE WHEN ${conversations.createdAt} >= ${startOfWeek}::timestamp THEN 1 END)::int`,
          monthCount: sql<number>`COUNT(CASE WHEN ${conversations.createdAt} >= ${startOfMonth}::timestamp THEN 1 END)::int`,
          vipCount: sql<number>`COUNT(CASE WHEN ${platformCustomers.value} >= COALESCE(${mailboxes.vipThreshold}, 999999) * 100 THEN 1 END)::int`,
          autoResponseEnabled: issueGroups.autoResponseEnabled,
          standardAnswer: issueGroups.standardAnswer,
          defaultSavedReplyId: issueGroups.defaultSavedReplyId,
        })
        .from(issueGroups)
        .leftJoin(
          conversations,
          and(
            eq(issueGroups.id, conversations.issueGroupId),
            eq(conversations.status, "open"),
            isNull(conversations.mergedIntoId),
          ),
        )
        .leftJoin(platformCustomers, eq(conversations.emailFrom, platformCustomers.email))
        .leftJoin(mailboxes, eq(mailboxes.id, ctx.mailbox.id))
        .groupBy(
          issueGroups.id,
          issueGroups.title,
          issueGroups.description,
          issueGroups.color,
          issueGroups.createdAt,
          issueGroups.updatedAt,
          issueGroups.autoResponseEnabled,
          issueGroups.standardAnswer,
          issueGroups.defaultSavedReplyId,
        )
        .orderBy(desc(issueGroups.createdAt))
        .limit(limit)
        .offset(offset);

      const groups = groupsWithCounts.map((group) => ({
        ...group,
        openCount: Number(group.openCount || 0),
        todayCount: Number(group.todayCount || 0),
        weekCount: Number(group.weekCount || 0),
        monthCount: Number(group.monthCount || 0),
        vipCount: Number(group.vipCount || 0),
      }));

      const subgroupCounts = await db
        .select({
          id: issueSubgroups.id,
          issueGroupId: issueSubgroups.issueGroupId,
          title: issueSubgroups.title,
          periodCount: sql<number>`COUNT(CASE WHEN ${conversations.createdAt} >= ${startOfLast30Days.toISOString()} THEN 1 END)::int`,
        })
        .from(issueSubgroups)
        .leftJoin(
          conversations,
          and(eq(conversations.issueSubgroupId, issueSubgroups.id), isNull(conversations.mergedIntoId)),
        )
        .where(eq(issueSubgroups.isArchived, false))
        .groupBy(issueSubgroups.id, issueSubgroups.issueGroupId, issueSubgroups.title);

      const subgroupMap = subgroupCounts.reduce<
        Map<number, { id: number; title: string; periodCount: number; sharePercent: number }[]>
      >((acc, subgroup) => {
        const list = acc.get(subgroup.issueGroupId) ?? [];
        list.push({
          id: subgroup.id,
          title: subgroup.title,
          periodCount: Number(subgroup.periodCount || 0),
          sharePercent: 0,
        });
        acc.set(subgroup.issueGroupId, list);
        return acc;
      }, new Map());

      return {
        groups: groups.map((group) => {
          const subcategories = (subgroupMap.get(group.id) ?? []).sort((a, b) => b.periodCount - a.periodCount);
          const periodTotal = subcategories.reduce((sum, subcategory) => sum + subcategory.periodCount, 0);
          const topSubcategories = subcategories.slice(0, 3).map((subcategory) => ({
            ...subcategory,
            sharePercent: periodTotal > 0 ? (subcategory.periodCount / periodTotal) * 100 : 0,
          }));

          return {
            ...group,
            topSubcategories,
          };
        }),
      };
    }),

  listAll: mailboxProcedure.query(async () => {
    const groups = await db
      .select({
        id: issueGroups.id,
        title: issueGroups.title,
        description: issueGroups.description,
        color: issueGroups.color,
        createdAt: issueGroups.createdAt,
        updatedAt: issueGroups.updatedAt,
        assignees: issueGroups.assignees,
        customPrompt: issueGroups.customPrompt,
        autoResponseEnabled: issueGroups.autoResponseEnabled,
        standardAnswer: issueGroups.standardAnswer,
        defaultSavedReplyId: issueGroups.defaultSavedReplyId,
        conversationCount: sql<number>`COUNT(${conversations.id})::int`,
      })
      .from(issueGroups)
      .leftJoin(
        conversations,
        and(
          eq(issueGroups.id, conversations.issueGroupId),
          eq(conversations.status, "open"),
          isNull(conversations.mergedIntoId),
        ),
      )
      .groupBy(
        issueGroups.id,
        issueGroups.title,
        issueGroups.description,
        issueGroups.color,
        issueGroups.createdAt,
        issueGroups.updatedAt,
        issueGroups.assignees,
        issueGroups.customPrompt,
        issueGroups.autoResponseEnabled,
        issueGroups.standardAnswer,
        issueGroups.defaultSavedReplyId,
      )
      .orderBy(desc(issueGroups.createdAt));

    return { groups };
  }),

  get: mailboxProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const group = await db.query.issueGroups.findFirst({
      where: eq(issueGroups.id, input.id),
      with: {
        conversations: {
          columns: {
            id: true,
            slug: true,
            subject: true,
            emailFrom: true,
            status: true,
            createdAt: true,
            assignedToId: true,
          },
        },
      },
    });

    if (!group) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Category not found" });
    }

    return group;
  }),

  create: mailboxProcedure
    .input(
      z.object({
        title: z.string().min(1).max(200),
        description: z.string().max(1000).optional(),
        customPrompt: z.string().optional().nullable(),
        standardAnswer: z.string().max(4000).optional().nullable(),
        autoResponseEnabled: z.boolean().optional(),
        defaultSavedReplyId: z.number().optional().nullable(),
      }),
    )
    .mutation(async ({ input }) => {
      const { title, description, customPrompt, standardAnswer, autoResponseEnabled, defaultSavedReplyId } = input;
      const newGroup = await db
        .insert(issueGroups)
        .values({
          title,
          description,
          customPrompt,
          standardAnswer,
          autoResponseEnabled: autoResponseEnabled ? 1 : 0,
          defaultSavedReplyId,
          color: getRandomIssueColor(),
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning()
        .then(takeUniqueOrThrow);

      return newGroup;
    }),

  update: mailboxProcedure
    .input(
      z.object({
        id: z.number(),
        title: z.string().min(1).max(200),
        description: z.string().max(1000).optional(),
        color: z.string().optional(),
        customPrompt: z.string().optional().nullable(),
        standardAnswer: z.string().max(4000).optional().nullable(),
        autoResponseEnabled: z.boolean().optional(),
        defaultSavedReplyId: z.number().optional().nullable(),
      }),
    )
    .mutation(async ({ input }) => {
      const { id, title, description, color, customPrompt, standardAnswer, autoResponseEnabled, defaultSavedReplyId } =
        input;

      const existingGroup = await db.query.issueGroups.findFirst({
        where: eq(issueGroups.id, id),
      });

      if (!existingGroup) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Category not found" });
      }

      const updatedGroup = await db
        .update(issueGroups)
        .set({
          title,
          description,
          color,
          customPrompt,
          standardAnswer,
          autoResponseEnabled: autoResponseEnabled !== undefined ? (autoResponseEnabled ? 1 : 0) : undefined,
          defaultSavedReplyId,
          updatedAt: new Date(),
        })
        .where(eq(issueGroups.id, id))
        .returning()
        .then(takeUniqueOrThrow);

      return updatedGroup;
    }),

  updateAssignees: mailboxProcedure
    .input(
      z.object({
        id: z.number(),
        assignees: z.array(z.string()),
      }),
    )
    .mutation(async ({ input }) => {
      const { id, assignees } = input;

      const existingGroup = await db.query.issueGroups.findFirst({
        where: eq(issueGroups.id, id),
      });

      if (!existingGroup) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Category not found" });
      }

      const updatedGroup = await db
        .update(issueGroups)
        .set({
          assignees,
          updatedAt: new Date(),
        })
        .where(eq(issueGroups.id, id))
        .returning()
        .then(takeUniqueOrThrow);

      return updatedGroup;
    }),

  delete: mailboxProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    const group = await db.query.issueGroups.findFirst({
      where: eq(issueGroups.id, input.id),
      with: {
        conversations: {
          columns: { id: true },
        },
      },
    });

    if (!group) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Category not found" });
    }

    await db.transaction(async (tx) => {
      if (group.conversations.length > 0) {
        await tx.update(conversations).set({ issueGroupId: null }).where(eq(conversations.issueGroupId, input.id));
      }

      await tx.delete(issueGroups).where(eq(issueGroups.id, input.id));
    });

    return { success: true, unassignedConversations: group.conversations.length };
  }),

  assignConversation: mailboxProcedure
    .input(
      z.object({
        conversationId: z.number(),
        issueGroupId: z.number().nullable(),
      }),
    )
    .mutation(async ({ input }) => {
      const conversation = await db.query.conversations.findFirst({
        where: eq(conversations.id, input.conversationId),
      });

      if (!conversation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }

      if (input.issueGroupId) {
        const issueGroup = await db.query.issueGroups.findFirst({
          where: eq(issueGroups.id, input.issueGroupId),
        });

        if (!issueGroup) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Category not found" });
        }
      }

      await db
        .update(conversations)
        .set({ issueGroupId: input.issueGroupId })
        .where(eq(conversations.id, input.conversationId));

      return { success: true };
    }),

  pinnedList: mailboxProcedure.query(async ({ ctx }) => {
    const userProfile = await db.query.userProfiles.findFirst({
      where: eq(userProfiles.id, ctx.user.id),
    });

    if (
      !userProfile?.pinnedIssueGroupIds ||
      !Array.isArray(userProfile.pinnedIssueGroupIds) ||
      userProfile.pinnedIssueGroupIds.length === 0
    ) {
      return { groups: [] };
    }

    const pinnedIds = userProfile.pinnedIssueGroupIds;

    const pinnedGroups = await db
      .select({
        id: issueGroups.id,
        title: issueGroups.title,
        description: issueGroups.description,
        color: issueGroups.color,
        openCount: count(conversations.id),
      })
      .from(issueGroups)
      .leftJoin(
        conversations,
        and(
          eq(issueGroups.id, conversations.issueGroupId),
          eq(conversations.status, "open"),
          isNull(conversations.mergedIntoId),
        ),
      )
      .where(inArray(issueGroups.id, pinnedIds))
      .groupBy(issueGroups.id, issueGroups.title, issueGroups.description, issueGroups.color)
      .orderBy(desc(issueGroups.id))
      .limit(10);

    return { groups: pinnedGroups };
  }),

  pin: mailboxProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const group = await db.query.issueGroups.findFirst({
      where: eq(issueGroups.id, input.id),
    });

    if (!group) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Category not found" });
    }

    const userProfile = await db.query.userProfiles.findFirst({
      where: eq(userProfiles.id, ctx.user.id),
    });

    const currentPinned = Array.isArray(userProfile?.pinnedIssueGroupIds) ? userProfile.pinnedIssueGroupIds : [];

    if (!currentPinned.includes(input.id)) {
      await db
        .update(userProfiles)
        .set({
          pinnedIssueGroupIds: [...currentPinned, input.id],
        })
        .where(eq(userProfiles.id, ctx.user.id));
    }

    return { success: true };
  }),

  unpin: mailboxProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const userProfile = await db.query.userProfiles.findFirst({
      where: eq(userProfiles.id, ctx.user.id),
    });

    const currentPinned = Array.isArray(userProfile?.pinnedIssueGroupIds) ? userProfile.pinnedIssueGroupIds : [];

    const updatedPinned = currentPinned.filter((id) => id !== input.id);

    await db
      .update(userProfiles)
      .set({
        pinnedIssueGroupIds: updatedPinned,
      })
      .where(eq(userProfiles.id, ctx.user.id));

    return { success: true };
  }),

  generateSuggestions: mailboxProcedure.mutation(async ({ ctx }) => {
    const { generateCommonIssuesSuggestions } = await import("@/lib/ai/generateCommonIssues");

    const result = await generateCommonIssuesSuggestions(ctx.mailbox);

    if (result.issues.length === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "No categories could be generated from existing conversations",
      });
    }

    return result;
  }),

  bulkCreate: mailboxProcedure
    .input(
      z.object({
        items: z.array(
          z.object({
            title: z.string(),
            description: z.string().optional(),
            customPrompt: z.string().optional(),
            autoResponseEnabled: z.boolean().optional(),
            defaultSavedReplyId: z.number().optional(),
          }),
        ),
      }),
    )
    .mutation(async ({ input }) => {
      const createdIssues = await Promise.all(
        input.items.map((item) =>
          db
            .insert(issueGroups)
            .values({
              title: item.title,
              description: item.description,
              customPrompt: item.customPrompt,
              autoResponseEnabled: item.autoResponseEnabled ? 1 : 0,
              defaultSavedReplyId: item.defaultSavedReplyId,
              color: getRandomIssueColor(),
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .returning()
            .then(takeUniqueOrThrow),
        ),
      );

      return {
        createdIssues: createdIssues.length,
        issues: createdIssues.map((issue) => ({
          id: issue.id,
          title: issue.title,
          description: issue.description,
          color: issue.color,
        })),
      };
    }),

  subgroupStats: mailboxProcedure
    .input(
      z.object({
        issueGroupId: z.number(),
        days: z.number().min(1).max(365).default(30),
        topN: z.number().min(1).max(50).default(10),
      }),
    )
    .query(async ({ input }) => {
      const now = new Date();
      const startDate = new Date(now.getTime() - input.days * 24 * 60 * 60 * 1000);
      const previousStartDate = new Date(startDate.getTime() - input.days * 24 * 60 * 60 * 1000);

      const rows = await db
        .select({
          id: issueSubgroups.id,
          title: issueSubgroups.title,
          description: issueSubgroups.description,
          openCount: sql<number>`COUNT(CASE WHEN ${conversations.status} = 'open' THEN 1 END)::int`,
          closedCount: sql<number>`COUNT(CASE WHEN ${conversations.status} = 'closed' THEN 1 END)::int`,
          totalCount: sql<number>`COUNT(${conversations.id})::int`,
          periodCount: sql<number>`COUNT(CASE WHEN ${conversations.createdAt} >= ${startDate.toISOString()} THEN 1 END)::int`,
          previousPeriodCount: sql<number>`COUNT(CASE WHEN ${conversations.createdAt} >= ${previousStartDate.toISOString()} AND ${conversations.createdAt} < ${startDate.toISOString()} THEN 1 END)::int`,
        })
        .from(issueSubgroups)
        .leftJoin(conversations, eq(conversations.issueSubgroupId, issueSubgroups.id))
        .where(and(eq(issueSubgroups.issueGroupId, input.issueGroupId), eq(issueSubgroups.isArchived, false)))
        .groupBy(issueSubgroups.id, issueSubgroups.title, issueSubgroups.description)
        .orderBy(desc(sql`COUNT(CASE WHEN ${conversations.createdAt} >= ${startDate.toISOString()} THEN 1 END)::int`));

      const totalConversations = rows.reduce((sum, row) => sum + Number(row.totalCount || 0), 0);
      const mapped = rows.map((row) => {
        const periodCount = Number(row.periodCount || 0);
        const previousPeriodCount = Number(row.previousPeriodCount || 0);
        const trendPercent =
          previousPeriodCount === 0 ? null : ((periodCount - previousPeriodCount) / previousPeriodCount) * 100;

        return {
          id: row.id,
          title: row.title,
          description: row.description,
          openCount: Number(row.openCount || 0),
          closedCount: Number(row.closedCount || 0),
          totalCount: Number(row.totalCount || 0),
          periodCount,
          previousPeriodCount,
          trendPercent,
          sharePercent: totalConversations > 0 ? (Number(row.totalCount || 0) / totalConversations) * 100 : 0,
        };
      });

      const topSubgroups = mapped.slice(0, input.topN);
      const otherSubgroups = mapped.slice(input.topN);

      return {
        issueGroupId: input.issueGroupId,
        totalConversations,
        periodDays: input.days,
        topSubgroups,
        otherCount: otherSubgroups.reduce((sum, row) => sum + row.totalCount, 0),
      };
    }),

  // Condition CRUD operations
  listConditions: mailboxProcedure.input(z.object({ issueGroupId: z.number() })).query(async ({ input }) => {
    const conditions = await db
      .select({
        id: issueGroupConditions.id,
        issueGroupId: issueGroupConditions.issueGroupId,
        savedReplyId: issueGroupConditions.savedReplyId,
        condition: issueGroupConditions.condition,
        isActive: issueGroupConditions.isActive,
        createdAt: issueGroupConditions.createdAt,
        savedReplyName: savedReplies.name,
      })
      .from(issueGroupConditions)
      .leftJoin(savedReplies, eq(issueGroupConditions.savedReplyId, savedReplies.id))
      .where(eq(issueGroupConditions.issueGroupId, input.issueGroupId))
      .orderBy(desc(issueGroupConditions.createdAt));

    return { conditions };
  }),

  addCondition: mailboxProcedure
    .input(
      z.object({
        issueGroupId: z.number(),
        savedReplyId: z.number(),
        condition: z.string().min(1).max(1000),
      }),
    )
    .mutation(async ({ input }) => {
      // Verify issue group exists
      const issueGroup = await db.query.issueGroups.findFirst({
        where: eq(issueGroups.id, input.issueGroupId),
      });
      if (!issueGroup) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Category not found" });
      }

      // Verify saved reply exists
      const savedReply = await db.query.savedReplies.findFirst({
        where: eq(savedReplies.id, input.savedReplyId),
      });
      if (!savedReply) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Saved reply not found" });
      }

      const newCondition = await db
        .insert(issueGroupConditions)
        .values({
          issueGroupId: input.issueGroupId,
          savedReplyId: input.savedReplyId,
          condition: input.condition,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning()
        .then(takeUniqueOrThrow);

      return newCondition;
    }),

  updateCondition: mailboxProcedure
    .input(
      z.object({
        id: z.number(),
        condition: z.string().min(1).max(1000).optional(),
        savedReplyId: z.number().optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const existingCondition = await db.query.issueGroupConditions.findFirst({
        where: eq(issueGroupConditions.id, input.id),
      });

      if (!existingCondition) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Condition not found" });
      }

      if (input.savedReplyId) {
        const savedReply = await db.query.savedReplies.findFirst({
          where: eq(savedReplies.id, input.savedReplyId),
        });
        if (!savedReply) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Saved reply not found" });
        }
      }

      const updateData: Partial<typeof issueGroupConditions.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (input.condition !== undefined) updateData.condition = input.condition;
      if (input.savedReplyId !== undefined) updateData.savedReplyId = input.savedReplyId;
      if (input.isActive !== undefined) updateData.isActive = input.isActive;

      const updatedCondition = await db
        .update(issueGroupConditions)
        .set(updateData)
        .where(eq(issueGroupConditions.id, input.id))
        .returning()
        .then(takeUniqueOrThrow);

      return updatedCondition;
    }),

  deleteCondition: mailboxProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    const existingCondition = await db.query.issueGroupConditions.findFirst({
      where: eq(issueGroupConditions.id, input.id),
    });

    if (!existingCondition) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Condition not found" });
    }

    await db.delete(issueGroupConditions).where(eq(issueGroupConditions.id, input.id));

    return { success: true };
  }),

  testCondition: mailboxProcedure
    .input(
      z.object({
        condition: z.string().min(1).max(1000),
        testEmail: z.string().email(),
      }),
    )
    .mutation(async ({ input }) => {
      const result = await evaluateCondition({
        conditionText: input.condition,
        email: input.testEmail,
        conversationSubject: null,
      });

      return result;
    }),
} satisfies TRPCRouterRecord;
