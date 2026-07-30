import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// In-memory fallback so local dev works without Upstash credentials.
// Production MUST set UPSTASH_REDIS_REST_URL/TOKEN — the in-memory limiter
// does not survive across serverless instances and is not a real defense.
const memoryHits = new Map<string, { count: number; resetAt: number }>();

function memoryLimiter(limit: number, windowMs: number) {
  return {
    limit: async (key: string) => {
      const now = Date.now();
      const entry = memoryHits.get(key);
      if (!entry || entry.resetAt < now) {
        memoryHits.set(key, { count: 1, resetAt: now + windowMs });
        return { success: true, remaining: limit - 1 };
      }
      entry.count += 1;
      const success = entry.count <= limit;
      return { success, remaining: Math.max(0, limit - entry.count) };
    },
  };
}

const hasUpstash =
  !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN;

const redis = hasUpstash
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    })
  : null;

function makeLimiter(limit: number, window: `${number} ${"s" | "m" | "h"}`) {
  if (redis) {
    return new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, window),
      analytics: false,
    });
  }
  const [amount, unit] = window.split(" ");
  const multiplier = unit === "h" ? 3_600_000 : unit === "m" ? 60_000 : 1_000;
  return memoryLimiter(limit, Number(amount) * multiplier);
}

export const rateLimiters = {
  signIn: makeLimiter(5, "10 m"),
  passwordSignUp: makeLimiter(5, "1 h"),
  passwordLogin: makeLimiter(10, "10 m"),
  messageSend: makeLimiter(20, "1 m"),
  postCreate: makeLimiter(10, "5 m"),
  report: makeLimiter(10, "10 m"),
  connectionRequest: makeLimiter(20, "10 m"),
  circleCreate: makeLimiter(5, "1 h"),
  mediaUpload: makeLimiter(20, "10 m"),
  like: makeLimiter(60, "1 m"),
  comment: makeLimiter(20, "5 m"),
  repost: makeLimiter(20, "10 m"),
  share: makeLimiter(20, "5 m"),
};

export async function checkRateLimit(
  limiter: keyof typeof rateLimiters,
  identifier: string,
) {
  try {
    const { success } = await rateLimiters[limiter].limit(identifier);
    return success;
  } catch {
    // An Upstash outage should degrade to unlimited, not take the app down.
    return true;
  }
}
