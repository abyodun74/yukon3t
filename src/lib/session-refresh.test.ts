import { describe, expect, it } from "vitest";
import { encode } from "next-auth/jwt";
import {
  SESSION_REFRESH_INTERVAL_MS,
  mayRefreshSession,
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

describe("reissueSessionToken", () => {
  it("keeps every claim, including the stable issuedAt, and gives a fresh 30-day expiry", async () => {
    const original = await encode({
      token: { sub: "u1", isAdmin: true, trustBand: "HIGH", issuedAt: 1234 },
      secret: SECRET,
      salt: SALT,
      maxAge: 60, // about to run out
    });
    const claims = await decodeSessionToken(original, SECRET, SALT);
    expect(claims?.sub).toBe("u1");
    const reissued = await reissueSessionToken(claims!, SECRET, SALT);
    const after = await decodeSessionToken(reissued, SECRET, SALT);
    expect(after).toMatchObject({ sub: "u1", isAdmin: true, trustBand: "HIGH", issuedAt: 1234 });
    const nowSec = Math.floor(Date.now() / 1000);
    expect(after!.exp).toBeGreaterThanOrEqual(nowSec + SESSION_MAX_AGE_SECONDS - 5);
    expect(after!.jti).not.toBe(claims!.jti);
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
