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

if (!hasUpstash && process.env.NODE_ENV === "production") {
  // Each serverless instance would otherwise enforce its own independent
  // in-memory limit — under real concurrent load this isn't "a smaller
  // limit," it's effectively no limit at all. Fail loud in logs rather than
  // silently degrading, without taking the app down over a config issue.
  console.error(
    "[rate-limit] UPSTASH_REDIS_REST_URL/TOKEN are not set in production. " +
      "Falling back to a per-instance in-memory limiter that does not " +
      "enforce limits across serverless instances.",
  );
}

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
  passwordResetRequest: makeLimiter(5, "1 h"),
  call: makeLimiter(20, "10 m"),
  messageSend: makeLimiter(20, "1 m"),
  postCreate: makeLimiter(10, "5 m"),
  report: makeLimiter(10, "10 m"),
  connectionRequest: makeLimiter(20, "10 m"),
  subscribe: makeLimiter(30, "10 m"),
  circleCreate: makeLimiter(5, "1 h"),
  groupChatCreate: makeLimiter(5, "1 h"),
  mediaUpload: makeLimiter(20, "10 m"),
  like: makeLimiter(60, "1 m"),
  rsvp: makeLimiter(30, "1 m"),
  comment: makeLimiter(20, "5 m"),
  repost: makeLimiter(20, "10 m"),
  share: makeLimiter(20, "5 m"),
  shareToCircle: makeLimiter(20, "10 m"),
  liveStreamStart: makeLimiter(5, "10 m"),
  liveStreamJoin: makeLimiter(30, "1 m"),
  liveStreamComment: makeLimiter(20, "1 m"),
  dataExport: makeLimiter(3, "1 h"),
  circleModerate: makeLimiter(30, "10 m"),
  channelManage: makeLimiter(30, "10 m"),
  collabModerate: makeLimiter(30, "10 m"),
  collabSession: makeLimiter(20, "10 m"),
  storyCreate: makeLimiter(10, "1 h"),
  // Keyed by IP rather than user.id — /advertise takes bookings with no
  // sign-in (see getClientIp), so there's no account identifier to key on.
  adUpload: makeLimiter(10, "10 m"),
  adBookingCreate: makeLimiter(5, "1 h"),
  // Guards SMS send cost/abuse (each call is a real Twilio charge) — separate
  // from phoneVerifyCheck below, which guards brute-forcing a submitted code
  // rather than triggering new sends. Twilio Verify has its own internal
  // rate limiting too; this is defense-in-depth, same as every other
  // user-facing action in this app.
  phoneVerifyRequest: makeLimiter(5, "1 h"),
  phoneVerifyCheck: makeLimiter(10, "1 h"),
  // Each call is a real OpenAI Whisper charge, same reasoning as
  // phoneVerifyRequest above (real per-call cost) — a tight bucket keeps
  // spend bounded per user.
  transcribeAudio: makeLimiter(10, "1 h"),
  voiceChannelInvite: makeLimiter(30, "10 m"),
  // Client pings every ~45s (see presence-heartbeat.tsx) — this bucket is
  // slack for tab-focus/visibility-change pings on top of the interval, not
  // a real per-call cost concern like the paid-API limiters above.
  presenceHeartbeat: makeLimiter(6, "1 m"),
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
