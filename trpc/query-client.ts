import { defaultShouldDehydrateQuery, QueryClient } from "@tanstack/react-query";
import SuperJSON from "superjson";

/**
 * Determines appropriate staleTime based on query key and data mutability
 * More static data can be cached longer to reduce database load
 */
const getStaleTime = (queryKey: readonly unknown[]): number => {
  const key = JSON.stringify(queryKey);

  // Very static data - changes rarely, can cache for 15 minutes
  if (
    key.includes('"user"') ||
    key.includes('"preferences"') ||
    key.includes('"mailbox","get"') ||
    key.includes('"sampleQuestions"')
  ) {
    return 15 * 60 * 1000; // 15 minutes
  }

  // Mostly static data - changes occasionally, cache for 10 minutes
  if (
    key.includes('"savedReplies"') ||
    key.includes('"faqs"') ||
    key.includes('"websites"') ||
    key.includes('"tools"')
  ) {
    return 10 * 60 * 1000; // 10 minutes
  }

  // Rarely changing data - cache for 5 minutes
  if (key.includes('"members"') || key.includes('"issueGroups"') || key.includes('"customers"')) {
    return 5 * 60 * 1000; // 5 minutes
  }

  // Dynamic data - shorter cache for conversations, counts, messages
  // Default 30 seconds for conversation lists, counts, and messages
  return 30 * 1000; // 30 seconds
};

export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        // With SSR, we usually want to set some default staleTime
        // above 0 to avoid refetching immediately on the client
        staleTime: (query) => getStaleTime(query.queryKey),
      },
      dehydrate: {
        serializeData: SuperJSON.serialize,
        shouldDehydrateQuery: (query) => defaultShouldDehydrateQuery(query) || query.state.status === "pending",
      },
      hydrate: {
        deserializeData: SuperJSON.deserialize,
      },
    },
  });
