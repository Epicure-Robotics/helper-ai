import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { takeUniqueOrThrow } from "@/components/utils/arrays";
import { assertDefined } from "@/components/utils/assert";
import { db } from "@/db/client";
import { toolApis, tools as toolsTable } from "@/db/schema";
import { fetchOpenApiSpec, importToolsFromSpec } from "@/lib/data/tools";
import { captureExceptionAndLog } from "@/lib/shared/sentry";
import { parseToolsFromOpenAPISpec } from "@/lib/tools/openApiParser";
import type { ToolFormatted } from "@/types/tools";
import { mailboxProcedure } from "./procedure";

export const toolsRouter = {
  list: mailboxProcedure.query(async ({ ctx }) => {
    try {
      const apis = await db.query.toolApis.findMany({
        columns: {
          id: true,
          name: true,
          baseUrl: true,
        },
        with: {
          tools: {
            columns: {
              id: true,
              name: true,
              description: true,
              url: true,
              requestMethod: true,
              enabled: true,
              slug: true,
              availableInChat: true,
              availableInAnonymousChat: true,
              customerEmailParameter: true,
              parameters: true,
              toolApiId: true,
            },
            orderBy: [desc(toolsTable.enabled), asc(toolsTable.id)],
          },
        },
      });

      return apis.map((api) => ({
        id: api.id,
        name: api.name,
        baseUrl: api.baseUrl,
        tools: api.tools.map(
          (tool) =>
            ({
              ...tool,
              path: tool.url
                .split(/\/\/[^/]+/)
                .pop()!
                .replace(/^\/+|\/+$/g, ""),
              toolApiId: api.id,
              unused_mailboxId: ctx.mailbox.id,
            }) satisfies ToolFormatted,
        ),
      }));
    } catch (error) {
      captureExceptionAndLog(error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: error instanceof Error ? error.message : "Failed to fetch APIs",
      });
    }
  }),

  import: mailboxProcedure
    .input(
      z.object({
        url: z.string().url().optional(),
        schema: z.string().optional(),
        apiKey: z.string(),
        name: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      if (!input.url && !input.schema) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Either URL or schema must be provided",
        });
      }

      try {
        let openApiSpec: string;
        try {
          openApiSpec = input.url ? await fetchOpenApiSpec(input.url, input.apiKey) : (input.schema ?? "");
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              error instanceof Error
                ? error.message
                : "Could not download the OpenAPI URL. Check the URL and try again.",
          });
        }

        if (!openApiSpec.trim()) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "OpenAPI spec is empty",
          });
        }

        let preparsedTools;
        try {
          preparsedTools = await parseToolsFromOpenAPISpec(openApiSpec, input.apiKey);
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: error instanceof Error ? error.message : "Could not parse OpenAPI document",
          });
        }

        const toolApi = await db
          .insert(toolApis)
          .values({
            name: input.name,
            baseUrl: input.url,
            schema: input.schema,
            authenticationToken: input.apiKey,
          })
          .returning()
          .then(takeUniqueOrThrow);

        await importToolsFromSpec({
          toolApiId: toolApi.id,
          openApiSpec,
          apiKey: input.apiKey,
          preparsedTools,
        });

        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        captureExceptionAndLog(error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to import API spec",
        });
      }
    }),
  update: mailboxProcedure
    .input(
      z.object({
        toolId: z.number(),
        settings: z.object({
          availableInChat: z.boolean(),
          availableInAnonymousChat: z.boolean(),
          enabled: z.boolean(),
          customerEmailParameter: z.string().nullable(),
        }),
      }),
    )
    .mutation(async ({ input }) => {
      const { toolId, settings } = input;

      const tool = await db.query.tools.findFirst({
        where: eq(toolsTable.id, toolId),
      });

      if (!tool) throw new TRPCError({ code: "NOT_FOUND", message: "Tool not found" });

      await db
        .update(toolsTable)
        .set({
          availableInChat: settings.enabled ? settings.availableInChat : false,
          availableInAnonymousChat: settings.enabled ? settings.availableInAnonymousChat : false,
          enabled: settings.enabled,
          customerEmailParameter:
            tool.parameters?.find((param) => param.name === settings.customerEmailParameter)?.name ?? null,
        })
        .where(and(eq(toolsTable.id, toolId)));

      return { success: true };
    }),

  deleteApi: mailboxProcedure
    .input(
      z.object({
        apiId: z.number(),
      }),
    )
    .mutation(async ({ input }) => {
      const { apiId } = input;

      await db.transaction(async (tx) => {
        await tx.delete(toolsTable).where(eq(toolsTable.toolApiId, apiId));
        await tx.delete(toolApis).where(and(eq(toolApis.id, apiId)));
      });

      return { success: true };
    }),

  refreshApi: mailboxProcedure
    .input(
      z.object({
        apiId: z.number(),
        schema: z.string().optional(),
      }),
    )
    .mutation(async ({ input: { apiId, schema } }) => {
      const api = await db.query.toolApis.findFirst({
        where: eq(toolApis.id, apiId),
      });

      if (!api) throw new TRPCError({ code: "NOT_FOUND", message: "API not found" });
      if (schema && !api.schema) throw new TRPCError({ code: "BAD_REQUEST", message: "API is not schema-based" });

      try {
        let openApiSpec: string;
        try {
          openApiSpec = api.baseUrl
            ? await fetchOpenApiSpec(api.baseUrl, api.authenticationToken)
            : assertDefined(schema);
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              error instanceof Error
                ? error.message
                : "Could not refresh the OpenAPI URL. Check the stored URL and token.",
          });
        }

        let preparsedTools;
        try {
          preparsedTools = await parseToolsFromOpenAPISpec(openApiSpec, api.authenticationToken ?? "");
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: error instanceof Error ? error.message : "Could not parse OpenAPI document",
          });
        }

        await importToolsFromSpec({
          toolApiId: api.id,
          openApiSpec,
          apiKey: api.authenticationToken ?? "",
          preparsedTools,
        });

        if (schema) {
          await db.update(toolApis).set({ schema }).where(eq(toolApis.id, api.id));
        }

        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        captureExceptionAndLog(error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to refresh API spec",
        });
      }
    }),
};
