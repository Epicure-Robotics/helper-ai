import { desc, type SQL } from "drizzle-orm";
import { conversationMessages } from "@/db/schema";
import { findTicketMatches } from "./ticketSearch";

const MAX_SEARCH_RESULTS = 1000;

export async function searchEmailsByKeywords(
  keywords: string,
  filters: SQL[] = [],
  orderBy: SQL[] = [desc(conversationMessages.id)],
) {
  const result = await findTicketMatches({
    query: keywords,
    filters,
    limit: MAX_SEARCH_RESULTS,
    messageOrderBy: orderBy,
  });

  const uniqueConversationMatches = new Map<number, (typeof result.matches)[number]>();
  for (const match of result.matches) {
    const existing = uniqueConversationMatches.get(match.conversationId);
    if (!existing || existing.score < match.score) {
      uniqueConversationMatches.set(match.conversationId, match);
    }
  }

  return Array.from(uniqueConversationMatches.values()).map((match) => ({
    id: match.itemId ?? match.conversationId,
    conversationId: match.conversationId,
    cleanedUpText: match.snippet ?? match.matchedText ?? match.conversationSubject ?? null,
  }));
}

export { findTicketMatches } from "./ticketSearch";
export type {
  FindTicketMatchesResult,
  ParsedTicketSearchQuery,
  TicketMatchField,
  TicketSearchMatch,
} from "./ticketSearch";
