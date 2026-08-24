import { createClient } from "redis";
import { env } from "@/lib/env";
import { captureExceptionAndLog } from "@/lib/shared/sentry";

/**
 * Derived from `createClient` rather than the bare `RedisClientType`: the default generic omits the
 * bundled command modules, so the client `createClient` actually returns is not assignable to it.
 */
type RedisClient = ReturnType<typeof createClient>;

let client: RedisClient | null = null;
let connectPromise: Promise<RedisClient | null> | null = null;

/** Not `async`: the two fast paths return without awaiting, and the slow path hands back the shared connect promise so concurrent callers share one connection. */
export function getRedis(): Promise<RedisClient | null> {
  const url = env.REDIS_URL;
  if (!url) return Promise.resolve(null);

  if (client?.isOpen) return Promise.resolve(client);

  if (!connectPromise) {
    connectPromise = (async () => {
      try {
        const redis = createClient({ url });
        redis.on("error", (error) => captureExceptionAndLog(error));
        await redis.connect();
        client = redis;
        return client;
      } catch (error) {
        captureExceptionAndLog(error);
        return null;
      }
    })();
  }

  return connectPromise;
}
