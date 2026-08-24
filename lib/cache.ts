import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { cache as cacheTable } from "@/db/schema/cache";
import { getRedis } from "@/lib/redis";
import { captureExceptionAndLog } from "@/lib/shared/sentry";

const REDIS_KEY_PREFIX = "helper:cache:";

const redisKey = (key: string) => `${REDIS_KEY_PREFIX}${key}`;

async function readFromRedis<T>(key: string): Promise<T | null | undefined> {
  const redis = await getRedis();
  if (!redis) return undefined;

  try {
    const raw = await redis.get(redisKey(key));
    if (raw == null) return null;
    return JSON.parse(raw) as T;
  } catch (error) {
    captureExceptionAndLog(error);
    return undefined;
  }
}

async function writeToRedis(key: string, value: unknown, expirySeconds: number | null): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;

  try {
    const payload = JSON.stringify(value);
    if (expirySeconds != null && expirySeconds > 0) {
      await redis.set(redisKey(key), payload, { EX: expirySeconds });
    } else {
      await redis.set(redisKey(key), payload);
    }
    return true;
  } catch (error) {
    captureExceptionAndLog(error);
    return false;
  }
}

async function readFromPostgres(key: string): Promise<{ value: unknown; expirySeconds: number | null } | null> {
  const result = await db.query.cache.findFirst({ where: eq(cacheTable.key, key) });
  if (!result || (result.expiresAt && result.expiresAt <= new Date())) {
    return null;
  }

  const expirySeconds = result.expiresAt
    ? Math.max(1, Math.floor((result.expiresAt.getTime() - Date.now()) / 1000))
    : null;

  return { value: result.value, expirySeconds };
}

async function writeToPostgres(key: string, value: unknown, expirySeconds: number | null) {
  const expiresAt = expirySeconds ? new Date(Date.now() + expirySeconds * 1000) : null;
  await db.insert(cacheTable).values({ key, value, expiresAt }).onConflictDoUpdate({
    target: cacheTable.key,
    set: { value, expiresAt },
  });
}

/**
 * Application cache: Redis when `REDIS_URL` is set (fast), Postgres `cache` table as fallback.
 */
export const cacheFor = <T>(key: string) => ({
  get: async (): Promise<T | null> => {
    const fromRedis = await readFromRedis<T>(key);
    if (fromRedis !== undefined) {
      return fromRedis;
    }

    const fromPostgres = await readFromPostgres(key);
    if (fromPostgres) {
      void writeToRedis(key, fromPostgres.value, fromPostgres.expirySeconds);
      return fromPostgres.value as T;
    }

    return null;
  },
  set: async (value: T, expirySeconds: number | null = null) => {
    await Promise.all([writeToRedis(key, value, expirySeconds), writeToPostgres(key, value, expirySeconds)]);
  },
});
