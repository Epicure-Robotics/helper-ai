import { getRedis } from "@/lib/redis";
import { captureExceptionAndLog } from "@/lib/shared/sentry";

export type RateLimitResult = {
  allowed: boolean;
  /** Seconds until the current window resets. Only meaningful when `allowed` is false. */
  retryAfterSeconds: number;
};

const ALLOWED: RateLimitResult = { allowed: true, retryAfterSeconds: 0 };

/**
 * Fixed-window counter backed by Redis.
 *
 * Fails open: if Redis is unavailable or errors, requests are allowed through. This is a cost/abuse
 * guard on public endpoints, not an authorization check, so availability beats strictness.
 */
export const checkRateLimit = async (
  key: string,
  { limit, windowSeconds }: { limit: number; windowSeconds: number },
): Promise<RateLimitResult> => {
  const redis = await getRedis();
  if (!redis) return ALLOWED;

  const redisKey = `helper:ratelimit:${key}`;
  try {
    const count = await redis.incr(redisKey);
    if (count === 1) {
      await redis.expire(redisKey, windowSeconds);
    }
    if (count > limit) {
      const ttl = await redis.ttl(redisKey);
      return { allowed: false, retryAfterSeconds: ttl > 0 ? ttl : windowSeconds };
    }
    return ALLOWED;
  } catch (error) {
    captureExceptionAndLog(error);
    return ALLOWED;
  }
};

/** Best-effort client IP for requests proxied through Vercel / nginx. */
export const clientIpFromRequest = (request: Request): string | null =>
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || null;

/**
 * Abuse guard for the public widget chat endpoints. Anonymous widget sessions are handed out freely, so
 * the session limit alone is trivially bypassed by minting new tokens; the IP limit is the real backstop.
 */
export const checkWidgetChatRateLimit = async ({
  request,
  sessionKey,
  perSession = { limit: 20, windowSeconds: 300 },
  perIp = { limit: 60, windowSeconds: 300 },
}: {
  request: Request;
  sessionKey: string;
  perSession?: { limit: number; windowSeconds: number };
  perIp?: { limit: number; windowSeconds: number };
}): Promise<RateLimitResult> => {
  const sessionResult = await checkRateLimit(`chat:session:${sessionKey}`, perSession);
  if (!sessionResult.allowed) return sessionResult;

  const ip = clientIpFromRequest(request);
  if (!ip) return ALLOWED;

  return await checkRateLimit(`chat:ip:${ip}`, perIp);
};

/** Stable per-session identifier for rate limiting: the customer's email, or their anonymous session id. */
export const widgetSessionKey = (session: { email?: string; anonymousSessionId?: string }): string =>
  session.email ?? session.anonymousSessionId ?? "unknown";
