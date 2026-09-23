import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// In-memory fallback so local dev works without Upstash credentials.
// Production MUST set UPSTASH_REDIS_REST_URL/TOKEN — the in-memory limiter
// does not survive across serverless instances and is not a real defense.
const memoryHits = new Map<string, { count: number; resetAt: number }>();

function memoryLimiter(limit: number, windowMs: number, prefix?: string) {
  return {
    limit: async (identifier: string) => {
      const key = prefix ? `${prefix}:${identifier}` : identifier;
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

// `prefix` gives a limiter its OWN counter. Without one, every limiter shares
// the library's default prefix — so two limiters with the same identifier (a
// user id) and the same window length count against ONE shared counter (in the
// in-memory fallback, any two limiters with the same identifier do). That's
// how most limiters here work today; a new one that must stay independent of
// the rest (see subCircleCreate) passes a prefix.
function makeLimiter(limit: number, window: `${number} ${"s" | "m" | "h"}`, prefix?: string) {
  if (redis) {
    return new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, window),
      analytics: false,
      ...(prefix ? { prefix } : {}),
    });
  }
  const [amount, unit] = window.split(" ");
  const multiplier = unit === "h" ? 3_600_000 : unit === "m" ? 60_000 : 1_000;
  return memoryLimiter(limit, Number(amount) * multiplier, prefix);
}

export const rateLimiters = {
  signIn: makeLimiter(5, "10 m"),
  passwordSignUp: makeLimiter(5, "1 h"),
  passwordLogin: makeLimiter(10, "10 m"),
  // Per-IP ceiling across ALL accounts, on top of passwordLogin's per-IP+
  // account bucket above — that one alone lets a single IP try unlimited
  // different accounts (credential stuffing), bounded only by pageRequest's
  // 300/min. Deliberately loose: mobile carriers (CGNAT) put thousands of
  // real users behind one shared IP, and every attempt counts, successful or
  // not, so a tight cap here would lock legitimate people out. 100 per 10
  // minutes still cuts a stuffing run from ~18,000 tries/hour per IP to 600.
  passwordLoginIp: makeLimiter(100, "10 m"),
  passwordResetRequest: makeLimiter(5, "1 h"),
  call: makeLimiter(20, "10 m"),
  messageSend: makeLimiter(20, "1 m"),
  postCreate: makeLimiter(10, "5 m"),
  report: makeLimiter(10, "10 m"),
  connectionRequest: makeLimiter(20, "10 m"),
  subscribe: makeLimiter(30, "10 m"),
  circleCreate: makeLimiter(5, "1 h"),
  // Separate from circleCreate: an owner setting up a main Circle's
  // sub-circles legitimately creates several in one sitting, and shouldn't be
  // throttled by the (much tighter) limit meant to stop Circle spam.
  subCircleCreate: makeLimiter(20, "1 h", "subCircleCreate"),
  // Secret chats (src/app/actions/e2ee.ts). Each has its own counter (prefix)
  // for the same reason subCircleCreate does. The backup fetch is the one
  // worth keeping tight: the backup is encrypted under a passphrase, and this
  // is what someone with a stolen session would call to get a copy to guess
  // at offline — the limit can't stop that, but it stops it being cheap.
  e2eeSetup: makeLimiter(5, "1 h", "e2eeSetup"),
  e2eeBackupFetch: makeLimiter(10, "1 h", "e2eeBackupFetch"),
  e2eeReset: makeLimiter(3, "1 h", "e2eeReset"),
  e2eeToggle: makeLimiter(30, "10 m", "e2eeToggle"),
  groupChatCreate: makeLimiter(5, "1 h"),
  // Uploads now start when a file is picked (see prefetchUpload), so trying out and removing attachments costs uploads too.
  mediaUpload: makeLimiter(40, "10 m"),
  like: makeLimiter(60, "1 m"),
  rsvp: makeLimiter(30, "1 m"),
  comment: makeLimiter(20, "5 m"),
  repost: makeLimiter(20, "10 m"),
  share: makeLimiter(20, "5 m"),
  shareToCircle: makeLimiter(20, "10 m"),
  museRepost: makeLimiter(20, "10 m"),
  museShare: makeLimiter(20, "5 m"),
  // Fires once per card-visible event (see MuseFeed's view-recording
  // effect), so this needs to be generous enough for a fast scroller
  // blowing through a whole page of the feed at once, not just deliberate
  // taps like the buckets above.
  museView: makeLimiter(120, "1 m"),
  liveStreamStart: makeLimiter(5, "10 m"),
  liveStreamJoin: makeLimiter(30, "1 m"),
  liveStreamComment: makeLimiter(20, "1 m"),
  dataExport: makeLimiter(3, "1 h"),
  circleModerate: makeLimiter(30, "10 m"),
  channelManage: makeLimiter(30, "10 m"),
  collabModerate: makeLimiter(30, "10 m"),
  collabSession: makeLimiter(20, "10 m"),
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
  // Same send/check split as phoneVerifyRequest/Check above, for the
  // signup-time email OTP code (src/app/actions/password-auth.ts).
  emailOtpSend: makeLimiter(5, "1 h"),
  // Switching email <-> phone while verifying a new account (a delayed email / text shouldn't dead-end anyone).
  verifyMethodSwitch: makeLimiter(10, "1 h", "verify-switch"),
  emailOtpCheck: makeLimiter(10, "1 h"),
  // Each call is a real OpenAI Whisper charge, same reasoning as
  // phoneVerifyRequest above (real per-call cost) — a tight bucket keeps
  // spend bounded per user.
  transcribeAudio: makeLimiter(10, "1 h"),
  voiceChannelInvite: makeLimiter(30, "10 m"),
  // Client pings every ~45s (see presence-heartbeat.tsx) — this bucket is
  // slack for tab-focus/visibility-change pings on top of the interval, not
  // a real per-call cost concern like the paid-API limiters above.
  presenceHeartbeat: makeLimiter(6, "1 m"),
  // Each call is a real Giphy API request — generous enough for someone
  // typing/refining a search, tight enough to bound spend per user.
  gifSearch: makeLimiter(30, "1 m"),
  // Each call is a real Safe Browsing API request (see src/lib/link-safety.ts)
  // — generous enough that checking every link post someone taps through in
  // a normal browsing session never gets throttled, tight enough that this
  // endpoint can't be scripted into a free arbitrary-URL scanning proxy.
  linkSafetyCheck: makeLimiter(30, "5 m"),
  // Device step-up verification (src/lib/device-challenge.ts): new-device
  // login, password change, or posting. Send/check split mirrors
  // emailOtpSend/Check above for the same reason — Send guards real email
  // volume, Check guards brute-forcing a submitted code.
  deviceChallengeSend: makeLimiter(5, "1 h"),
  deviceChallengeCheck: makeLimiter(10, "1 h"),
  // Coarse, IP-keyed defense-in-depth applied to every page request in
  // src/proxy.ts (not just mutating Server Actions, which each already have
  // their own tighter per-action limiter above) — generous enough that no
  // real user's normal browsing/scrolling ever trips it, tight enough to
  // blunt a scripted crawl/scrape or a flood aimed at a single IP. Keyed by
  // IP rather than user.id since it has to run before auth is known, at the
  // edge, on every route.
  pageRequest: makeLimiter(300, "1 m"),
  // The review-prompt gate's own free-text feedback form (submitAppFeedback
  // in actions/review-prompt.ts) — generous since a real user only ever
  // submits this once (DECLINED is terminal), just a backstop against a
  // scripted flood of the admin notification it fires. Needs its own
  // prefix — called with the bare user id like circleCreate/groupChatCreate/
  // dataExport/phoneVerifyRequest/transcribeAudio above, all also on a "1 h"
  // window with no prefix of their own, which means they already silently
  // share one counter per user per rolling hour (confirmed live: 3 Circles
  // created in an hour left only 2 of "appFeedback"'s own 5 before this fix).
  // Not fixing those other five here — out of scope for this change — but
  // not repeating the same mistake in new code either.
  appFeedback: makeLimiter(5, "1 h", "appFeedback"),
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
