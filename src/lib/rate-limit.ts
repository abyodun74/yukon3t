import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { captureError } from "@/lib/error-tracking";

// In-memory fallback so local dev works without Upstash credentials.
// Production MUST set UPSTASH_REDIS_REST_URL/TOKEN — the in-memory limiter
// does not survive across serverless instances and is not a real defense.
const memoryHits = new Map<string, { count: number; resetAt: number }>();

function memoryLimiter(limit: number, windowMs: number, prefix?: string) {
  return {
    limit: async (identifier: string, opts?: { rate?: number }) => {
      const rate = Math.max(1, opts?.rate ?? 1);
      const key = prefix ? `${prefix}:${identifier}` : identifier;
      const now = Date.now();
      const entry = memoryHits.get(key);
      if (!entry || entry.resetAt < now) {
        if (rate > limit) return { success: false, remaining: limit };
        memoryHits.set(key, { count: rate, resetAt: now + windowMs });
        return { success: true, remaining: limit - rate };
      }
      if (entry.count + rate > limit && rate > 1) {
        // Like Upstash's sliding window: a multi-token request that doesn't fit is refused without consuming anything.
        return { success: false, remaining: Math.max(0, limit - entry.count) };
      }
      entry.count += rate;
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

// Every limiter gets its OWN counter, keyed by its name in `rateLimiters`
// below (`rl:<name>`), unless a limiter passes an explicit `prefix` (kept
// as-is so existing counters don't reset). Without one, Upstash's default
// prefix is shared by every limiter, so two limiters with the same
// identifier (a user id) and the same window length would count against ONE
// counter — e.g. viewing Muse videos used up the message-send budget. (The
// in-memory fallback keyed on the bare identifier, so there any two
// limiters with the same identifier shared one.) makeLimiter only records
// the definition; buildLimiter below constructs it once the name is known.
function makeLimiter(limit: number, window: `${number} ${"s" | "m" | "h"}`, prefix?: string) {
  return { limit, window, prefix };
}

// 1s instead of the library's 5s default: on timeout Ratelimit does NOT throw,
// it resolves { success: true, reason: "timeout" }, which checkRateLimit
// treats like an error (fail open, closed or database fallback, per limiter),
// so a slow Redis can stall a request by at most this long.
const RATE_LIMIT_TIMEOUT_MS = 1000;

function limiterKey({ prefix }: ReturnType<typeof makeLimiter>, name: string): string {
  return prefix ?? `rl:${name}`;
}

function windowToMs(window: ReturnType<typeof makeLimiter>["window"]): number {
  const [amount, unit] = window.split(" ");
  const multiplier = unit === "h" ? 3_600_000 : unit === "m" ? 60_000 : 1_000;
  return Number(amount) * multiplier;
}

function buildLimiter(def: ReturnType<typeof makeLimiter>, name: string) {
  const { limit, window } = def;
  const key = limiterKey(def, name);
  if (redis) {
    return new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, window),
      analytics: false,
      prefix: key,
      timeout: RATE_LIMIT_TIMEOUT_MS,
    });
  }
  return memoryLimiter(limit, windowToMs(window), key);
}

const limiterDefinitions = {
  signIn: makeLimiter(5, "10 m"),
  passwordSignUp: makeLimiter(5, "1 h"),
  // Starting a guest preview from /try (actions/guest-preview.ts), per client IP. Loose enough for a household or a
  // carrier NAT sharing one address (each start is one cookie, nothing is created), tight enough that a script can't
  // mint sessions in bulk; a second, global ceiling bounds a distributed run.
  guestPreviewStart: makeLimiter(10, "1 h"),
  guestPreviewStartGlobal: makeLimiter(3000, "1 h"),
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
  // Forwarding a chat message (forwardMessage): per action, on top of messageSend per destination.
  messageForward: makeLimiter(20, "10 m", "messageForward"),
  // The forward picker's list of chats (getForwardTargets).
  messageForwardTargets: makeLimiter(60, "10 m", "messageForwardTargets"),
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
  // Inviting whole Circles to a collab: each request can notify up to 200
  // people (COLLAB_CIRCLE_INVITE_MAX), so it's far tighter than collabModerate.
  collabCircleInvite: makeLimiter(5, "1 h", "collabCircleInvite"),
  // Inviting connections to a PRIVATE Circle (inviteToCircle): each request
  // can push-notify up to 50 people (CIRCLE_INVITE_MAX).
  circleInvite: makeLimiter(10, "1 h"),
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
  // Discover's people search (searchDiscoverPeople), one call per debounced keystroke or "Show more". The hourly
  // ceiling bounds how much of the directory one account can walk through by scripting queries.
  discoverSearch: makeLimiter(30, "1 m"),
  discoverSearchHour: makeLimiter(300, "1 h"),
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
  // The page-level limit in src/proxy.ts, applied to nearly every request (not just mutating Server Actions, which
  // each have their own tighter limiter above), before auth is known. Which buckets a request counts against is
  // decided by pageLimitChecks (src/lib/page-rate-limit.ts):
  // - pageRequest: a request with no device cookie (a first visit, a scraper that drops cookies), per client IP.
  //   Unchanged at 300 a minute.
  // - pageRequestDevice: a request from a known device (the device id cookie the proxy mints), per device. One
  //   phone in active use (feed scrolling with link prefetches, a call's status checks and roster, badge counts,
  //   presence, realtime resyncs) makes a few requests a second at most; production showed one address sustaining
  //   more than 10 a second for 45 seconds with two phones on it (2026-10-14, a call between them), which the old
  //   single 300-a-minute per-IP bucket refused, leaving the app on a bare error page mid-call. 1,200 a minute (20 a
  //   second for a whole minute) is far above any real device, and still bounds a runaway client.
  // - pageRequestNetwork: the same requests per client IP, a ceiling shared by everyone behind one address (a
  //   household on one Wi-Fi, a mobile carrier's shared address). 3,000 a minute: room for many active devices on
  //   one address, and a hard bound for a client that invents device ids to get fresh buckets.
  pageRequest: makeLimiter(300, "1 m"),
  pageRequestDevice: makeLimiter(1200, "1 m"),
  pageRequestNetwork: makeLimiter(3000, "1 m"),
  // The review-prompt gate's own free-text feedback form (submitAppFeedback
  // in actions/review-prompt.ts) — generous since a real user only ever
  // submits this once (DECLINED is terminal), just a backstop against a
  // scripted flood of the admin notification it fires.
  appFeedback: makeLimiter(5, "1 h", "appFeedback"),
  // Each call can trigger a real Cloudflare Stream encode (see
  // branded-video-service.ts) — generous enough for the client's own poll
  // loop while a share is preparing (a few calls over ~20s), tight enough
  // to bound spend if something calls this in a loop.
  brandedVideo: makeLimiter(30, "5 m", "brandedVideo"),
  // Ambient presence groundwork (actions/ambient.ts). Adding/removing a
  // handful of people is an occasional settings action, not something
  // anyone legitimately does dozens of times a minute.
  innerCircleManage: makeLimiter(20, "10 m", "innerCircleManage"),
  // A real upload + moderation call per attempt, same cost shape as
  // postCreate — "ambient" doesn't mean "unthrottled."
  ambientMomentCreate: makeLimiter(10, "10 m", "ambientMomentCreate"),
  // Token generation/revocation — rare by nature (done once when setting up
  // a future widget), tight on purpose.
  ambientWidgetToken: makeLimiter(10, "1 h", "ambientWidgetToken"),
  // Each one notifies and pushes someone else's phone — nobody takes
  // screenshots at anything like this rate by hand.
  screenshotNotice: makeLimiter(10, "10 m", "screenshotNotice"),
  // Hidden-chats PIN entry, change and reset (actions/hidden-chats.ts). A second layer only: this limiter fails open,
  // so the lockout that actually bounds guessing is the database one in src/lib/hidden-chats.ts.
  hiddenPin: makeLimiter(20, "10 m", "hiddenPin"),
  // Polls in Circles and collabs (actions/polls.ts). Creating one notifies up to POLL_NOTIFY_MAX_RECIPIENTS people, so
  // it is the tight one; editing/closing/scheduling is an organizer's occasional action; voting is a tap, and changing
  // one's mind a few times is normal.
  pollCreate: makeLimiter(10, "1 h", "pollCreate"),
  pollManage: makeLimiter(30, "10 m", "pollManage"),
  pollVote: makeLimiter(60, "1 m", "pollVote"),
  // Reading poll pages: "Load more", and the refetch a live poll signal triggers (each open page at most once per
  // POLL_SIGNAL_COOLDOWN_MS, plus focus resyncs), so this only stops a client hammering it.
  pollList: makeLimiter(120, "1 m", "pollList"),
  // Circle events (actions/circle-events.ts). Organizer actions (bring-list edits, unassigning, stopping a repeat) are
  // occasional; claiming is a tap; a nudge notifies up to EVENT_NUDGE_MAX_RECIPIENTS people, so it is the tight one
  // (each event also allows only one per EVENT_NUDGE_COOLDOWN_MS, in the database). The list limiter only stops a
  // client hammering "Load more" on "Coming up".
  eventOrganize: makeLimiter(30, "10 m", "eventOrganize"),
  eventBringClaim: makeLimiter(60, "1 m", "eventBringClaim"),
  eventNudge: makeLimiter(10, "1 h", "eventNudge"),
  circleEventList: makeLimiter(120, "1 m", "circleEventList"),
  // "Load more" on a Circle's member lists (actions/circles.ts loadCircleMembers): only stops a client hammering it.
  circleMemberList: makeLimiter(120, "1 m", "circleMemberList"),
  // Organizer tools on a Circle event (actions/circle-event-organizer.ts). An update notifies up to
  // EVENT_ANNOUNCEMENT_MAX_RECIPIENTS people, and each event also takes at most EVENT_ANNOUNCEMENTS_PER_DAY in any 24h
  // (counted in the database, so it holds while Redis fails open); this one caps an organizer across all their events.
  // Check-in is a tap per person (plus the list and the walk-in search). An export reads every RSVP of up to a whole
  // series, so it is the tight one.
  eventAnnounce: makeLimiter(10, "1 h", "eventAnnounce"),
  eventCheckIn: makeLimiter(300, "10 m", "eventCheckIn"),
  eventExport: makeLimiter(10, "1 h", "eventExport"),
  // Translating posts/comments/messages (actions/translation.ts, src/lib/translation-server.ts). Each one is a paid
  // model call, so three layers: requests per user (a batch is at most TRANSLATION_BATCH_MAX items, cache hits
  // included), model calls per user (cache misses only: what costs money; generous enough for auto-translate on a
  // busy feed), and one ceiling across everyone (identifier "all") so a flood can't run up the bill. Like every
  // limiter these fail open if Redis is down; the shared cache still means each text is translated at most once per
  // language.
  translateRequest: makeLimiter(120, "10 m", "translateRequest"),
  translateModelCall: makeLimiter(200, "1 h", "translateModelCall"),
  translateGlobal: makeLimiter(20000, "24 h", "translateGlobal"),
  // Live translated captions in 1:1 calls (actions/call-captions.ts). The hard money cap is the per-user monthly
  // count of seconds in the database (CALL_CAPTION_MONTHLY_SECONDS), which holds while Redis fails open; these only
  // slow down abuse. Turning captions on/off and the state checks; starting a transcription session (each one is an
  // OpenAI client secret + call); its heartbeats; one ceiling on sessions + heartbeats across everyone (each is about
  // CALL_CAPTION_HEARTBEAT_MS of someone's microphone, so 40000 a day is roughly 500 hours); and the translation of
  // each received sentence, per user and across everyone.
  callCaptionConsent: makeLimiter(30, "10 m", "callCaptionConsent"),
  callCaptionState: makeLimiter(240, "10 m", "callCaptionState"),
  callCaptionStart: makeLimiter(20, "1 h", "callCaptionStart"),
  callCaptionHeartbeat: makeLimiter(200, "1 h", "callCaptionHeartbeat"),
  callCaptionGlobal: makeLimiter(40000, "24 h", "callCaptionGlobal"),
  callCaptionTranslate: makeLimiter(600, "1 h", "callCaptionTranslate"),
  callCaptionTranslateGlobal: makeLimiter(100000, "24 h", "callCaptionTranslateGlobal"),
  // Private profile pictures (/api/avatar/…, per signed-in user): one request per distinct avatar a screen shows,
  // since the browser caches each redirect for ~50 minutes. A busy hour of feed, comments, search and lists stays well
  // under this; a scraper walking every profile doesn't. Over it, avatars fall back to initials, nothing else breaks.
  avatarView: makeLimiter(600, "1 h", "avatarView"),
  // "Send to a friend" in the share sheets to up to 5 chats at once (sendToConversations, shareMuseToConversations,
  // shareStoryToConversations): per action, on top of messageSend per destination.
  shareToChats: makeLimiter(20, "10 m", "shareToChats"),
  // Birthday wishes (sendBirthdayWish): per sender, on top of messageSend. At most one per celebrant per year anyway.
  birthdayWish: makeLimiter(30, "1 h", "birthdayWish"),
  // Settings -> Privacy -> Birthday, "Add your birth date" (setBirthDateOnce): per user. It can only ever succeed once;
  // this just caps retries of a refused date (underage, invalid).
  birthDateSet: makeLimiter(5, "1 h", "birthDateSet"),
  // Re-entering the account password before "Export my data" or "Delete account" (actions/account-reauth.ts), per
  // user: what bounds guessing a password from a stolen session. Codes sent for the same step use deviceChallengeSend
  // (email) / phoneVerifyRequest (SMS), and checking one deviceChallengeCheck / phoneVerifyCheck.
  accountReauth: makeLimiter(10, "1 h", "accountReauth"),
} satisfies Record<string, ReturnType<typeof makeLimiter>>;

export const rateLimiters = Object.fromEntries(
  Object.entries(limiterDefinitions).map(([name, def]) => [name, buildLimiter(def, name)]),
) as { [K in keyof typeof limiterDefinitions]: ReturnType<typeof buildLimiter> };

export type LimiterName = keyof typeof limiterDefinitions;

/**
 * Limiters that FAIL CLOSED when Upstash errors or times out, and fall back to a counter in Postgres
 * (src/lib/rate-limit-db-fallback.ts) instead of letting the request through unlimited: each of these sends an email
 * or a text message (real money, and a way to flood someone's inbox or phone) or guards re-entering a password. If
 * the fallback isn't available either (not registered in this runtime, or the database errors), the request is
 * refused like any rate-limited one. The fallback is a fixed window of the same length and size, so it is about as
 * strict as the Upstash sliding window.
 */
export const FAIL_CLOSED_WITH_DB_FALLBACK: ReadonlySet<LimiterName> = new Set<LimiterName>([
  "signIn", // magic-link email (sign-in/page.tsx)
  "passwordSignUp", // creates an account and sends its verification email or text
  "passwordResetRequest", // password reset email
  "emailOtpSend", // sign-up email code
  "phoneVerifyRequest", // SMS code (Twilio charge per send)
  "deviceChallengeSend", // step-up email code (new-device sign-in, password change, hidden PIN reset, re-auth)
  "accountReauth", // password re-entry before data export / account deletion
]);

/**
 * Limiters that FAIL CLOSED with no fallback: each allowed call is a paid third-party call with no other cap, so
 * during an Upstash outage they are refused rather than unlimited (the feature pauses; nothing else breaks).
 * Everything not in either set fails OPEN: a slow or down Redis must never take the app down.
 */
export const FAIL_CLOSED_NO_FALLBACK: ReadonlySet<LimiterName> = new Set<LimiterName>([
  "transcribeAudio", // OpenAI Whisper per call
  "translateModelCall", // OpenAI per cache miss
  "translateGlobal", // the bill's ceiling across everyone
  "brandedVideo", // Cloudflare Stream encode
]);

/** A fixed-window counter used when Upstash is unavailable: true while `key` has used fewer than `limit` in `windowMs`. */
export type RateLimitFallback = (key: string, limit: number, windowMs: number) => Promise<boolean>;

// Registered by src/lib/rate-limit-db-fallback.ts (which needs Prisma) rather than imported here: this file is also
// bundled into src/proxy.ts, which must not pull in a database client. Kept on globalThis so every bundle in the
// server process sees the same registration.
const FALLBACK_SLOT = Symbol.for("yukon3t.rateLimitDbFallback");

export function registerRateLimitFallback(fallback: RateLimitFallback | null): void {
  (globalThis as Record<symbol, unknown>)[FALLBACK_SLOT] = fallback;
}

function registeredFallback(): RateLimitFallback | null {
  const value = (globalThis as Record<symbol, unknown>)[FALLBACK_SLOT];
  return typeof value === "function" ? (value as RateLimitFallback) : null;
}

// An Upstash outage (or an exhausted plan) fails every check, and src/proxy.ts
// runs one on nearly every request — so the outage trace is reported at
// most once per window per server instance per kind of failure, not once per
// request. Not keyed by limiter: an outage hits all of them, so the first
// failure's limiter name is enough.
const FAIL_OPEN_REPORT_INTERVAL_MS = 10 * 60 * 1000;
const failOpenReports = {
  error: { lastAt: null as number | null, suppressed: 0 },
  timeout: { lastAt: null as number | null, suppressed: 0 },
  fallback: { lastAt: null as number | null, suppressed: 0 },
};

// Returns how many failures were suppressed since the last report if this one
// should be reported, or null if it should be suppressed.
function claimFailOpenReport(kind: keyof typeof failOpenReports): number | null {
  const state = failOpenReports[kind];
  const now = Date.now();
  if (state.lastAt !== null && now - state.lastAt < FAIL_OPEN_REPORT_INTERVAL_MS) {
    state.suppressed += 1;
    return null;
  }
  const suppressed = state.suppressed;
  state.lastAt = now;
  state.suppressed = 0;
  return suppressed;
}

/** What a limiter does when Upstash can't answer: "open" (allow), "closed" (refuse), or "database" (fallback). */
export function unavailableBehaviour(limiter: LimiterName): "open" | "closed" | "database" {
  if (FAIL_CLOSED_WITH_DB_FALLBACK.has(limiter)) return "database";
  if (FAIL_CLOSED_NO_FALLBACK.has(limiter)) return "closed";
  return "open";
}

// The answer for a check Upstash couldn't make (thrown error or timeout).
async function whenUpstashUnavailable(limiter: LimiterName, identifier: string, rate: number): Promise<boolean> {
  const behaviour = unavailableBehaviour(limiter);
  if (behaviour === "open") return true;
  if (behaviour === "closed") return false;
  const fallback = registeredFallback();
  if (!fallback) return false;
  const def = limiterDefinitions[limiter];
  try {
    let allowed = true;
    for (let i = 0; i < rate && allowed; i++) {
      allowed = await fallback(`${limiterKey(def, limiter)}:${identifier}`, def.limit, windowToMs(def.window));
    }
    return allowed;
  } catch (err) {
    const suppressed = claimFailOpenReport("fallback");
    if (suppressed !== null) {
      console.error(`[rate-limit] ${limiter} database fallback failed too; refusing`, err);
      void captureError(err, { where: "checkRateLimit:fallback", limiter, suppressedSinceLastReport: suppressed });
    }
    return false;
  }
}

function outcomeWord(limiter: LimiterName): string {
  const behaviour = unavailableBehaviour(limiter);
  return behaviour === "open" ? "failing open" : behaviour === "closed" ? "failing closed" : "using the database fallback";
}

/**
 * Whether one more request (or `rate` more, see src/proxy.ts's page-limit credits) fits under `limiter` for
 * `identifier`. When Upstash errors or times out the answer depends on the limiter: most fail open, the email/SMS
 * senders fall back to a database counter, and a few paid ones fail closed (see the two sets above).
 */
export async function checkRateLimit(limiter: LimiterName, identifier: string, options?: { rate?: number }) {
  const rate = Math.max(1, Math.floor(options?.rate ?? 1));
  try {
    const result = await rateLimiters[limiter].limit(identifier, rate > 1 ? { rate } : undefined);
    if ("reason" in result && result.reason === "timeout") {
      const suppressed = claimFailOpenReport("timeout");
      if (suppressed !== null) {
        console.error(
          `[rate-limit] ${limiter} timed out after ${RATE_LIMIT_TIMEOUT_MS}ms; ${outcomeWord(limiter)}` +
            (suppressed > 0 ? ` (${suppressed} similar suppressed since last report)` : ""),
        );
      }
      return whenUpstashUnavailable(limiter, identifier, rate);
    }
    return result.success;
  } catch (err) {
    // An Upstash outage should degrade, not take the app down — but not
    // silently: this is the only trace that limits stopped enforcing.
    const suppressed = claimFailOpenReport("error");
    if (suppressed !== null) {
      console.error(`[rate-limit] ${limiter} check failed; ${outcomeWord(limiter)}`, err);
      // captureError never rejects (it swallows its own errors), and the
      // request must not wait on Sentry.
      void captureError(err, { where: "checkRateLimit", limiter, suppressedSinceLastReport: suppressed });
    }
    return whenUpstashUnavailable(limiter, identifier, rate);
  }
}
