import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { decode, encode } from "next-auth/jwt";

// POST /api/session/refresh slides a member's session cookie. It may only ever extend a session: every failure leaves
// the browser's cookie untouched (no Set-Cookie at all), so a deploy, a cold database or a secret mismatch can never
// turn into a sign-out here.

const SECRET = "test-secret-for-session-refresh-route-0123456789";
const COOKIE = "__Secure-authjs.session-token";
process.env.AUTH_SECRET = SECRET;
process.env.AUTH_URL = "https://yukon3t.com";

const findUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: (...a: unknown[]) => findUnique(...a) } } }));

const { POST } = await import("@/app/api/session/refresh/route");

// A session that began a day ago (seconds): the refresh route only slides sessions younger than 120 days.
const DAY = 24 * 60 * 60;
const RECENT = Math.floor(Date.now() / 1000) - DAY;

function request(cookie?: string) {
  return new NextRequest("https://yukon3t.com/api/session/refresh", {
    method: "POST",
    headers: cookie ? { cookie: `${COOKIE}=${cookie}` } : {},
  });
}

async function token(claims: Record<string, unknown>, secret = SECRET) {
  return encode({ token: claims, secret, salt: COOKIE, maxAge: 60 });
}

beforeEach(() => {
  findUnique.mockReset();
  findUnique.mockResolvedValue({ status: "ACTIVE", isGuestPreview: false, sessionInvalidatedAt: null, isAdmin: false, trustBand: "NEW" });
});

describe("POST /api/session/refresh", () => {
  it("re-issues an active member's cookie as a persistent 30-day cookie with the same claims", async () => {
    const res = await POST(request(await token({ sub: "u1", issuedAt: RECENT, isAdmin: false })));
    expect(await res.json()).toEqual({ refreshed: true });
    const set = res.cookies.get(COOKIE);
    expect(set).toBeDefined();
    expect(set).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 30 * 24 * 60 * 60 });
    const claims = await decode({ token: set!.value, secret: SECRET, salt: COOKIE });
    expect(claims).toMatchObject({ sub: "u1", issuedAt: RECENT });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("leaves the cookie alone when there is none, or it can't be read with this server's secret", async () => {
    for (const res of [await POST(request()), await POST(request(await token({ sub: "u1" }, "a-different-secret-0123456789xx")))]) {
      expect(await res.json()).toEqual({ refreshed: false });
      expect(res.headers.get("set-cookie")).toBeNull();
    }
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("leaves the cookie alone when the database is unavailable (deploy, migration, cold start)", async () => {
    findUnique.mockRejectedValue(new Error("Can't reach database server"));
    const res = await POST(request(await token({ sub: "u1", issuedAt: RECENT })));
    expect(await res.json()).toEqual({ refreshed: false });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("doesn't extend a guest, revoked or inactive session (and doesn't delete it either)", async () => {
    const guest = await POST(request(await token({ sub: "g", guest: true, issuedAt: RECENT })));
    expect(await guest.json()).toEqual({ refreshed: false });
    expect(guest.headers.get("set-cookie")).toBeNull();

    findUnique.mockResolvedValue({ status: "ACTIVE", isGuestPreview: false, sessionInvalidatedAt: new Date((RECENT + 60) * 1000) });
    const revoked = await POST(request(await token({ sub: "u1", issuedAt: RECENT })));
    expect(await revoked.json()).toEqual({ refreshed: false });
    expect(revoked.headers.get("set-cookie")).toBeNull();

    findUnique.mockResolvedValue({ status: "SUSPENDED", isGuestPreview: false, sessionInvalidatedAt: null });
    const suspended = await POST(request(await token({ sub: "u1", issuedAt: RECENT })));
    expect(await suspended.json()).toEqual({ refreshed: false });
  });

  it("stops extending a session 120 days after it began, without deleting the cookie", async () => {
    const old = await POST(request(await token({ sub: "u1", issuedAt: Math.floor(Date.now() / 1000) - 121 * DAY })));
    expect(await old.json()).toEqual({ refreshed: false });
    expect(old.headers.get("set-cookie")).toBeNull();
    // A token with no issuedAt (its age can't be told) isn't extended either.
    const unknown = await POST(request(await token({ sub: "u1" })));
    expect(await unknown.json()).toEqual({ refreshed: false });
    expect(unknown.headers.get("set-cookie")).toBeNull();
  });

  it("cuts the last re-issue at the 120-day mark", async () => {
    const issuedAt = Math.floor(Date.now() / 1000) - 110 * DAY;
    const res = await POST(request(await token({ sub: "u1", issuedAt })));
    expect(await res.json()).toEqual({ refreshed: true });
    const set = res.cookies.get(COOKIE)!;
    expect(set.maxAge).toBeLessThanOrEqual(10 * DAY);
    expect(set.maxAge).toBeGreaterThan(10 * DAY - 60);
    const claims = await decode({ token: set.value, secret: SECRET, salt: COOKIE });
    expect(claims!.exp).toBeLessThanOrEqual(issuedAt + 120 * DAY + 5);
  });

  it("re-reads isAdmin and trustBand from the database instead of copying the old token's", async () => {
    findUnique.mockResolvedValue({ status: "ACTIVE", isGuestPreview: false, sessionInvalidatedAt: null, isAdmin: false, trustBand: "LOW" });
    const res = await POST(request(await token({ sub: "u1", issuedAt: RECENT, isAdmin: true, trustBand: "HIGH" })));
    expect(await res.json()).toEqual({ refreshed: true });
    const claims = await decode({ token: res.cookies.get(COOKIE)!.value, secret: SECRET, salt: COOKIE });
    expect(claims).toMatchObject({ sub: "u1", isAdmin: false, trustBand: "LOW", issuedAt: RECENT });
  });
});
