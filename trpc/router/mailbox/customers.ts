import { TRPCRouterRecord } from "@trpc/server";
import { and, asc, desc, eq, ilike } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { platformCustomers } from "@/db/schema";
import { getMailbox } from "@/lib/data/mailbox";
import { determineVipStatus, findOrCreatePlatformCustomerByEmail } from "@/lib/data/platformCustomer";
import { mailboxProcedure } from "./procedure";

export const customersRouter = {
  list: mailboxProcedure
    .input(
      z.object({
        search: z.string().optional(),
      }),
    )
    .query(async ({ input }) => {
      return await db.query.platformCustomers.findMany({
        where: and(...(input.search ? [ilike(platformCustomers.email, `%${input.search}%`)] : [])),
        columns: {
          id: true,
          email: true,
        },
        orderBy: asc(platformCustomers.email),
        limit: 20,
      });
    }),
  listAll: mailboxProcedure
    .input(
      z.object({
        search: z.string().optional(),
        limit: z.number().optional().default(50),
      }),
    )
    .query(async ({ input }) => {
      const [customers, mailbox] = await Promise.all([
        db.query.platformCustomers.findMany({
          where: and(...(input.search ? [ilike(platformCustomers.email, `%${input.search}%`)] : [])),
          orderBy: desc(platformCustomers.createdAt),
          limit: input.limit,
        }),
        getMailbox(),
      ]);

      return customers.map((customer) => ({
        ...customer,
        isVip: determineVipStatus(customer.value as number | null, mailbox?.vipThreshold ?? null),
      }));
    }),
  exists: mailboxProcedure
    .input(
      z.object({
        email: z.string().email(),
      }),
    )
    .query(async ({ input }) => {
      const customer = await db.query.platformCustomers.findFirst({
        where: eq(platformCustomers.email, input.email),
        columns: {
          id: true,
          email: true,
        },
      });
      return { exists: !!customer };
    }),
  create: mailboxProcedure
    .input(
      z.object({
        email: z.string().email(),
      }),
    )
    .mutation(async ({ input }) => {
      const customer = await findOrCreatePlatformCustomerByEmail(input.email);
      return customer;
    }),
  update: mailboxProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().optional(),
        value: z.number().nullable().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { id, name, value } = input;
      const updateData: Record<string, unknown> = {};

      if (name !== undefined) updateData.name = name;
      if (value !== undefined) updateData.value = value !== null ? value.toString() : null;

      const [updated] = await db
        .update(platformCustomers)
        .set(updateData)
        .where(eq(platformCustomers.id, id))
        .returning();
      return updated;
    }),
} satisfies TRPCRouterRecord;
