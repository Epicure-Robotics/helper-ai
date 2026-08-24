import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { conversationMessages, conversations, jobRuns } from "@/db/schema";

const SLUG = "d7ead95047e4283920a9955bd46bfa3f";

const conversation = await db.query.conversations.findFirst({
  where: eq(conversations.slug, SLUG),
});

if (!conversation) {
  console.log("❌ Conversation not found for slug:", SLUG);
  process.exit(1);
}

console.log("\n=== CONVERSATION ===");
console.log("  id:                   ", conversation.id);
console.log("  status:               ", conversation.status);
console.log("  conversation_provider:", conversation.conversationProvider);
console.log("  email_from:           ", conversation.emailFrom);

const messages = await db.query.conversationMessages.findMany({
  where: eq(conversationMessages.conversationId, conversation.id),
  columns: {
    id: true,
    role: true,
    status: true,
    gmailThreadId: true,
    gmailMessageId: true,
    createdAt: true,
    deletedAt: true,
  },
  orderBy: (m, { desc }) => [desc(m.createdAt)],
});

console.log("\n=== MESSAGES (newest first) ===");
for (const m of messages) {
  console.log(
    `  [${m.id}] role=${m.role} status=${m.status} gmailThreadId=${m.gmailThreadId ?? "null"} deletedAt=${m.deletedAt ?? "null"} createdAt=${m.createdAt}`,
  );
}

const archiveJobs = await db.query.jobRuns.findMany({
  where: eq(jobRuns.job, "archiveGmailThreadJob"),
  orderBy: (j, { desc }) => [desc(j.createdAt)],
  limit: 10,
});

const relevantArchiveJobs = archiveJobs.filter((j) => {
  const data = j.data as any;
  return data?.conversationId === conversation.id;
});

console.log(`\n=== archiveGmailThreadJob runs for conversation ${conversation.id} ===`);
if (relevantArchiveJobs.length === 0) {
  console.log("  ⚠️  No archive job runs found — job was never queued for this conversation");
} else {
  for (const j of relevantArchiveJobs) {
    console.log(
      `  [${j.id}] status=${j.status} createdAt=${j.createdAt} result=${JSON.stringify(j.result)} error=${j.error ?? "null"}`,
    );
  }
}

const postEmailJobs = await db
  .select({
    id: jobRuns.id,
    status: jobRuns.status,
    createdAt: jobRuns.createdAt,
    result: jobRuns.result,
    error: jobRuns.error,
    data: jobRuns.data,
  })
  .from(jobRuns)
  .where(eq(jobRuns.job, "postEmailToGmail"))
  .orderBy(jobRuns.createdAt);

const relevantPostEmailJobs = postEmailJobs.filter((j) => {
  const data = j.data as any;
  const messageId = data?.messageId ?? data?.json?.messageId;
  return messages.some((m) => m.id === messageId);
});

console.log(`\n=== postEmailToGmail runs for conversation ${conversation.id} ===`);
if (relevantPostEmailJobs.length === 0) {
  console.log("  ⚠️  No postEmailToGmail job runs found for this conversation's messages");
} else {
  for (const j of relevantPostEmailJobs) {
    console.log(
      `  [${j.id}] status=${j.status} createdAt=${j.createdAt} result=${JSON.stringify(j.result)} error=${j.error ?? "null"} data=${JSON.stringify(j.data)}`,
    );
  }
}

console.log("\n=== DIAGNOSIS ===");
if (conversation.conversationProvider !== "gmail") {
  console.log("❌ conversationProvider is not 'gmail' — archive will never trigger");
} else if (relevantArchiveJobs.length === 0) {
  console.log("❌ Archive job was never queued — check if postEmailToGmail ran and if updateConversation triggered it");
} else {
  const failed = relevantArchiveJobs.filter((j) => j.status === "error");
  const succeeded = relevantArchiveJobs.filter((j) => j.status === "success");
  if (succeeded.length > 0) {
    console.log("✅ Archive job ran successfully");
  } else if (failed.length > 0) {
    console.log("❌ Archive job failed:", failed[0]?.error);
  } else {
    console.log("⏳ Archive job is pending/running");
  }
}
