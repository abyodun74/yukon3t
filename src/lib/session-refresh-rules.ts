// Pure, client-safe rules for keeping a signed-in member's session cookie alive (see session-refresh.ts for the server
// half and components/session-keep-alive.tsx for the client).
//
// Why this exists: sessions are Auth.js JWT cookies with a fixed 30-day lifetime (SESSION_MAX_AGE_SECONDS). Auth.js only
// slides that expiry when its own /api/auth/session handler runs, and nothing in this app calls it: every page reads the
// session through auth() in a Server Component, where Auth.js's re-issued cookie is thrown away (Server Components
// can't set cookies). So every member was signed out exactly 30 days after signing in, however active they were.

/** How often an open app asks the server to re-issue the session cookie (on launch / foreground, never on a timer). */
export const SESSION_REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;

/** localStorage key holding when this device last got a re-issued cookie. Not a secret: just a timestamp. */
export const SESSION_REFRESH_STORAGE_KEY = "yk-session-refreshed-at";

/** Whether it is time to refresh again. A missing, unreadable or future timestamp means yes. */
export function shouldRefreshSession(lastRefreshAt: number | null, now: number): boolean {
  if (lastRefreshAt === null || !Number.isFinite(lastRefreshAt) || lastRefreshAt > now) return true;
  return now - lastRefreshAt >= SESSION_REFRESH_INTERVAL_MS;
}

export function parseLastRefreshAt(raw: string | null): number | null {
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

type Claims = { sub?: unknown; guest?: unknown; issuedAt?: unknown };
type UserRow = { status: string; isGuestPreview: boolean; sessionInvalidatedAt: Date | null } | null;

/**
 * Whether a decoded, still-valid session token may be re-issued with a fresh 30-day expiry: a member's token (never a
 * guest preview's, whose lifetime is fixed) for an active account that hasn't been revoked since the session began
 * (the same sessionInvalidatedAt rule requireUser applies). `issuedAt`, the session's real start, is carried over
 * unchanged by the re-issue, so a later revocation still ends it.
 */
export function mayRefreshSession(claims: Claims, user: UserRow): boolean {
  if (typeof claims.sub !== "string" || claims.sub === "") return false;
  if (claims.guest === true) return false;
  if (!user || user.status !== "ACTIVE" || user.isGuestPreview) return false;
  if (user.sessionInvalidatedAt) {
    const issuedAt = typeof claims.issuedAt === "number" ? claims.issuedAt : null;
    if (issuedAt === null || issuedAt * 1000 < user.sessionInvalidatedAt.getTime()) return false;
  }
  return true;
}

/**
 * The longest a session can be kept alive by refreshing, counted from when it began (the token's stable `issuedAt`,
 * set at sign-in and carried over by every re-issue): 120 days. Past that the refresh route answers
 * `refreshed: false` and the cookie runs out on its own, so a stolen cookie can't be kept alive forever and every
 * member signs in again at least every 120 days. Not a sign-out: nothing is deleted early.
 */
export const SESSION_ABSOLUTE_MAX_AGE_SECONDS = 120 * 24 * 60 * 60;

/**
 * How long (seconds) a re-issued session cookie may last: the usual sliding lifetime, cut so the session never
 * outlives SESSION_ABSOLUTE_MAX_AGE_SECONDS from its `issuedAt`. Null when it may not be extended at all: no usable
 * `issuedAt` (older tokens; also never a time in the future), the absolute limit already reached, or a re-issue that
 * wouldn't end later than the cookie the browser already holds (`exp`), so a refresh can never shorten a session.
 */
export function refreshedSessionMaxAge(
  claims: { issuedAt?: unknown; exp?: unknown },
  nowSeconds: number,
  slidingSeconds: number,
  absoluteSeconds: number = SESSION_ABSOLUTE_MAX_AGE_SECONDS,
): number | null {
  const issuedAt = claims.issuedAt;
  if (typeof issuedAt !== "number" || !Number.isFinite(issuedAt) || issuedAt > nowSeconds + 60) return null;
  const remaining = Math.floor(issuedAt + absoluteSeconds - nowSeconds);
  if (remaining <= 0) return null;
  const maxAge = Math.min(slidingSeconds, remaining);
  if (typeof claims.exp === "number" && nowSeconds + maxAge <= claims.exp) return null;
  return maxAge;
}
