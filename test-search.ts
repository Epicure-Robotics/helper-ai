import { ilike } from "drizzle-orm";
import { db } from "./db/client";
import { conversations } from "./db/schema";
import { searchConversations } from "./lib/data/conversation/search";
import { getMailbox } from "./lib/data/mailbox";

async function testSearch() {
  console.log("Testing search functionality...\n");

  // 1. Search for website form leads in subject
  console.log("1. Direct database query for subject:");
  const directResults = await db
    .select({
      id: conversations.id,
      slug: conversations.slug,
      subject: conversations.subject,
      status: conversations.status,
    })
    .from(conversations)
    .where(ilike(conversations.subject, "%New Lead%"))
    .limit(5);

  console.log(`Found ${directResults.length} results via direct query:`);
  directResults.forEach((r) => {
    console.log(`  - #${r.id} (${r.slug}): ${r.subject} [${r.status}]`);
  });

  // 2. Test the search function
  console.log("\n2. Using searchConversations with search parameter:");
  const mailbox = await getMailbox();
  if (!mailbox) {
    console.log("  ERROR: No mailbox found");
    return;
  }

  const searchResult = await searchConversations(mailbox, {
    search: "vending",
    limit: 10,
  });

  const { results } = await searchResult.list;
  console.log(`Found ${results.length} results via search function:`);
  results.forEach((r) => {
    console.log(`  - #${r.id} (${r.slug}): ${r.subject} [${r.status}]`);
  });

  // 3. Try with different keywords
  console.log("\n3. Searching with 'factory':");
  const searchResult2 = await searchConversations(mailbox, {
    search: "factory",
    limit: 10,
  });

  const { results: results2 } = await searchResult2.list;
  console.log(`Found ${results2.length} results:`);
  results2.forEach((r) => {
    console.log(`  - #${r.id} (${r.slug}): ${r.subject} [${r.status}]`);
  });

  // 4. Try searching closed tickets specifically
  console.log("\n4. Searching closed tickets with 'Epicure':");
  const searchResult3 = await searchConversations(mailbox, {
    search: "Epicure",
    status: ["closed"],
    limit: 10,
  });

  const { results: results3 } = await searchResult3.list;
  console.log(`Found ${results3.length} closed tickets:`);
  results3.forEach((r) => {
    console.log(`  - #${r.id} (${r.slug}): ${r.subject} [${r.status}]`);
  });
}

testSearch()
  .then(() => {
    console.log("\nTest complete!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
