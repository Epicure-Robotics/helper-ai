import * as readline from "readline";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { conversationMessages } from "@/db/schema";
import { getStaffName } from "@/lib/data/user";

/**
 * Get all staff members who have replied in the last 48 hours
 */
const getStaffMembers = async (fortyEightHoursAgo: Date) => {
  const staffWithReplies = await db
    .select({
      userId: conversationMessages.userId,
      replyCount: sql<number>`count(*)::int`,
    })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.role, "staff"),
        gte(conversationMessages.createdAt, fortyEightHoursAgo),
        isNull(conversationMessages.deletedAt),
      ),
    )
    .groupBy(conversationMessages.userId)
    .orderBy(sql`count(*) DESC`);

  // Get staff names
  const staffWithNames = await Promise.all(
    staffWithReplies.map(async (staff) => ({
      userId: staff.userId,
      name: (await getStaffName(staff.userId)) || staff.userId || "Unknown",
      replyCount: staff.replyCount,
    })),
  );

  return staffWithNames;
};

/**
 * Prompt user to select a staff member
 */
const selectStaffMember = (staffMembers: { userId: string | null; name: string; replyCount: number }[]) => {
  return new Promise<string | null>((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log("\n📋 Staff Members (Last 48 Hours):\n");
    console.log("0. All Staff Members");
    staffMembers.forEach((staff, index) => {
      console.log(`${index + 1}. ${staff.name} (${staff.replyCount} replies)`);
    });

    rl.question("\n👉 Select a staff member (enter number): ", (answer) => {
      rl.close();
      const selection = parseInt(answer.trim());

      if (isNaN(selection) || selection < 0 || selection > staffMembers.length) {
        console.log("❌ Invalid selection");
        resolve(null);
      } else if (selection === 0) {
        resolve(null); // null means all staff
      } else {
        resolve(staffMembers[selection - 1]?.userId ?? null);
      }
    });
  });
};

/**
 * Fetches staff replies from the last 48 hours
 */
export const fetchStaffReplies = async (selectedUserId?: string | null) => {
  try {
    console.log("\n🔍 Fetching staff replies from the last 48 hours...\n");

    // Calculate the timestamp for 48 hours ago
    const fortyEightHoursAgo = new Date();
    fortyEightHoursAgo.setHours(fortyEightHoursAgo.getHours() - 48);

    console.log(`📅 Looking for messages since: ${fortyEightHoursAgo.toISOString()}\n`);

    // Build the where clause
    const whereConditions = [
      eq(conversationMessages.role, "staff"),
      gte(conversationMessages.createdAt, fortyEightHoursAgo),
      isNull(conversationMessages.deletedAt),
    ];

    if (selectedUserId) {
      whereConditions.push(eq(conversationMessages.userId, selectedUserId));
    }

    // Query for staff messages from the last 48 hours
    const staffReplies = await db.query.conversationMessages.findMany({
      where: and(...whereConditions),
      orderBy: (messages, { desc }) => [desc(messages.createdAt)],
      columns: {
        id: true,
        conversationId: true,
        body: true,
        htmlBody: true,
        cleanedUpText: true,
        createdAt: true,
        userId: true,
        emailTo: true,
        status: true,
        responseToId: true,
      },
    });

    const selectedStaffName = selectedUserId ? await getStaffName(selectedUserId) : "All Staff";

    console.log(`✅ Found ${staffReplies.length} replies from ${selectedStaffName}\n`);
    console.log("=".repeat(80));

    // Display the results
    for (const [index, reply] of staffReplies.entries()) {
      const staffName = await getStaffName(reply.userId);

      console.log(`\n📧 Reply #${index + 1}`);
      console.log(`   ID: ${reply.id}`);
      console.log(`   Conversation ID: ${reply.conversationId}`);
      console.log(`   Staff: ${staffName || reply.userId || "N/A"}`);
      console.log(`   Created At: ${reply.createdAt.toISOString()}`);
      console.log(`   Status: ${reply.status || "N/A"}`);
      console.log(`   Email To: ${reply.emailTo || "N/A"}`);
      console.log(`   Response To ID: ${reply.responseToId || "N/A"}`);

      // Show a preview of the message body
      const bodyPreview = (reply.cleanedUpText || reply.body || "No content").substring(0, 200).replace(/\n/g, " ");
      console.log(`   Body Preview: ${bodyPreview}${bodyPreview.length >= 200 ? "..." : ""}`);
      console.log("-".repeat(80));
    }

    console.log(`\n📊 Summary:`);
    console.log(`   Staff Member: ${selectedStaffName}`);
    console.log(`   Total replies: ${staffReplies.length}`);
    console.log(`   Time range: Last 48 hours`);
    console.log(`   From: ${fortyEightHoursAgo.toISOString()}`);
    console.log(`   To: ${new Date().toISOString()}`);

    return staffReplies;
  } catch (error) {
    console.error("❌ Error fetching staff replies:", error);
    throw error;
  }
};

// Run the script if executed directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
  (async () => {
    try {
      // Calculate the timestamp for 48 hours ago
      const fortyEightHoursAgo = new Date();
      fortyEightHoursAgo.setHours(fortyEightHoursAgo.getHours() - 48);

      // Get all staff members
      const staffMembers = await getStaffMembers(fortyEightHoursAgo);

      if (staffMembers.length === 0) {
        console.log("❌ No staff replies found in the last 48 hours");
        process.exit(0);
      }

      // Let user select a staff member
      const selectedUserId = await selectStaffMember(staffMembers);

      if (selectedUserId === undefined) {
        console.log("❌ Invalid selection");
        process.exit(1);
      }

      // Fetch replies for the selected staff member
      await fetchStaffReplies(selectedUserId);

      console.log("\n✅ Script completed successfully");
      process.exit(0);
    } catch (error) {
      console.error("\n❌ Script failed:", error);
      process.exit(1);
    }
  })();
}
