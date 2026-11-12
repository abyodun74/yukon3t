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
