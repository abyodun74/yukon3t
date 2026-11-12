import { describe, expect, it } from "vitest";
import { encode } from "next-auth/jwt";
import {
  SESSION_ABSOLUTE_MAX_AGE_SECONDS,
  SESSION_REFRESH_INTERVAL_MS,
  mayRefreshSession,
  refreshedSessionMaxAge,
  parseLastRefreshAt,
  shouldRefreshSession,
} from "@/lib/session-refresh-rules";
import { decodeSessionToken, reissueSessionToken } from "@/lib/session-refresh";
import { SESSION_MAX_AGE_SECONDS } from "@/lib/auth-cookie";

const SECRET = "test-secret-for-session-refresh-0123456789";
const SALT = "__Secure-authjs.session-token";
const active = { status: "ACTIVE", isGuestPreview: false, sessionInvalidatedAt: null };

describe("shouldRefreshSession", () => {
  const now = 1_800_000_000_000;
  it("refreshes when never refreshed, unreadable, or set in the future", () => {
    expect(shouldRefreshSession(null, now)).toBe(true);
    expect(shouldRefreshSession(Number.NaN, now)).toBe(true);
    expect(shouldRefreshSession(now + 60_000, now)).toBe(true);
  });
  it("waits the interval between refreshes", () => {
    expect(shouldRefreshSession(now - 60_000, now)).toBe(false);
    expect(shouldRefreshSession(now - SESSION_REFRESH_INTERVAL_MS + 1, now)).toBe(false);
    expect(shouldRefreshSession(now - SESSION_REFRESH_INTERVAL_MS, now)).toBe(true);
  });
  it("parses the stored timestamp", () => {
    expect(parseLastRefreshAt(null)).toBeNull();
    expect(parseLastRefreshAt("abc")).toBeNull();
    expect(parseLastRefreshAt("123")).toBe(123);
  });
});

describe("mayRefreshSession", () => {
  it("allows an active member's token", () => {
    expect(mayRefreshSession({ sub: "u1", issuedAt: 100 }, active)).toBe(true);
  });
  it("never extends a guest preview session or a token without a subject", () => {
    expect(mayRefreshSession({ sub: "g", guest: true, issuedAt: 100 }, active)).toBe(false);
    expect(mayRefreshSession({ sub: "g", issuedAt: 100 }, { ...active, isGuestPreview: true })).toBe(false);
    expect(mayRefreshSession({ issuedAt: 100 }, active)).toBe(false);
  });
  it("never extends a missing, inactive or revoked account's session", () => {
    expect(mayRefreshSession({ sub: "u1", issuedAt: 100 }, null)).toBe(false);
    expect(mayRefreshSession({ sub: "u1", issuedAt: 100 }, { ...active, status: "BANNED" })).toBe(false);
    const invalidated = { ...active, sessionInvalidatedAt: new Date(200_000) };
    expect(mayRefreshSession({ sub: "u1", issuedAt: 100 }, invalidated)).toBe(false);
    expect(mayRefreshSession({ sub: "u1" }, invalidated)).toBe(false);
    // A session started after the revocation is fine.
    expect(mayRefreshSession({ sub: "u1", issuedAt: 300 }, invalidated)).toBe(true);
  });
});

describe("refreshedSessionMaxAge (absolute 120-day limit)", () => {
  const DAY = 24 * 60 * 60;
  const now = 1_800_000_000;
  it("is 120 days", () => {
    expect(SESSION_ABSOLUTE_MAX_AGE_SECONDS).toBe(120 * DAY);
  });
  it("gives the full sliding lifetime early in a session", () => {
    expect(refreshedSessionMaxAge({ issuedAt: now - 10 * DAY, exp: now + DAY }, now, SESSION_MAX_AGE_SECONDS)).toBe(
      SESSION_MAX_AGE_SECONDS,
    );
  });
  it("cuts the last re-issue so the session ends exactly 120 days after it began", () => {
    const issuedAt = now - 100 * DAY;
    expect(refreshedSessionMaxAge({ issuedAt, exp: now + DAY }, now, SESSION_MAX_AGE_SECONDS)).toBe(20 * DAY);
  });
  it("doesn't extend a session at or past 120 days (it runs out on its own)", () => {
    expect(refreshedSessionMaxAge({ issuedAt: now - 120 * DAY, exp: now + DAY }, now, SESSION_MAX_AGE_SECONDS)).toBeNull();
    expect(refreshedSessionMaxAge({ issuedAt: now - 200 * DAY }, now, SESSION_MAX_AGE_SECONDS)).toBeNull();
  });
  it("never shortens: no re-issue that would end before the cookie already held", () => {
    const issuedAt = now - 119 * DAY; // one day left of the 120
    expect(refreshedSessionMaxAge({ issuedAt, exp: now + 2 * DAY }, now, SESSION_MAX_AGE_SECONDS)).toBeNull();
    expect(refreshedSessionMaxAge({ issuedAt, exp: now + 3600 }, now, SESSION_MAX_AGE_SECONDS)).toBe(DAY);
  });
  it("doesn't extend a token without a usable issuedAt, or one claiming to start in the future", () => {
    expect(refreshedSessionMaxAge({}, now, SESSION_MAX_AGE_SECONDS)).toBeNull();
    expect(refreshedSessionMaxAge({ issuedAt: "1000" }, now, SESSION_MAX_AGE_SECONDS)).toBeNull();
    expect(refreshedSessionMaxAge({ issuedAt: Number.NaN }, now, SESSION_MAX_AGE_SECONDS)).toBeNull();
    expect(refreshedSessionMaxAge({ issuedAt: now + DAY }, now, SESSION_MAX_AGE_SECONDS)).toBeNull();
  });
});

describe("reissueSessionToken", () => {
  it("keeps the subject and the stable issuedAt, gives a fresh 30-day expiry, and takes isAdmin/trustBand from the database", async () => {
    const original = await encode({
      token: { sub: "u1", isAdmin: true, trustBand: "HIGH", issuedAt: 1234 },
      secret: SECRET,
      salt: SALT,
      maxAge: 60, // about to run out
    });
    const claims = await decodeSessionToken(original, SECRET, SALT);
    expect(claims?.sub).toBe("u1");
    const reissued = await reissueSessionToken(claims!, SECRET, SALT, { isAdmin: false, trustBand: "NEW" });
    const after = await decodeSessionToken(reissued, SECRET, SALT);
    expect(after).toMatchObject({ sub: "u1", isAdmin: false, trustBand: "NEW", issuedAt: 1234 });
    const nowSec = Math.floor(Date.now() / 1000);
    expect(after!.exp).toBeGreaterThanOrEqual(nowSec + SESSION_MAX_AGE_SECONDS - 5);
    expect(after!.jti).not.toBe(claims!.jti);
  });

  it("drops a trustBand the database no longer has, and honours a shorter lifetime", async () => {
    const claims = await decodeSessionToken(
      await encode({ token: { sub: "u1", trustBand: "HIGH", issuedAt: 1234 }, secret: SECRET, salt: SALT, maxAge: 60 }),
      SECRET,
      SALT,
    );
    const after = await decodeSessionToken(
      await reissueSessionToken(claims!, SECRET, SALT, { isAdmin: false, trustBand: null }, 3600),
      SECRET,
      SALT,
    );
    expect(after).not.toHaveProperty("trustBand");
    const nowSec = Math.floor(Date.now() / 1000);
    expect(after!.exp).toBeLessThanOrEqual(nowSec + 3600 + 5);
  });

  it("reads nothing under a different secret or salt, and never throws on junk", async () => {
    const token = await encode({ token: { sub: "u1" }, secret: SECRET, salt: SALT, maxAge: 60 });
    expect(await decodeSessionToken(token, "another-secret-entirely-0123456789", SALT)).toBeNull();
    expect(await decodeSessionToken(token, SECRET, "authjs.session-token")).toBeNull();
    expect(await decodeSessionToken("not-a-jwt", SECRET, SALT)).toBeNull();
    expect(await decodeSessionToken(undefined, SECRET, SALT)).toBeNull();
    expect(await decodeSessionToken(token, "", SALT)).toBeNull();
  });
});
