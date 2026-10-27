import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// requireUser / requireViewer against a mocked session and database: a guest preview session may read
// (requireViewer) but never write (requireUser refuses it with GuestReadOnlyError), and it ends after its fixed
// lifetime or the moment GUEST_PREVIEW_ENABLED is turned off.
type SessionLike = { user: { id: string; isGuest?: boolean }; issuedAt?: number; guestSessionId?: string } | null;
let session: SessionLike = null;
let row: Record<string, unknown> | null = null;

vi.mock("@/lib/auth", () => ({ auth: async () => session }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: async () => row } } }));

import {
  AuthError,
  GuestReadOnlyError,
  requireAdmin,
  requireUser,
  requireVerifiedViewer,
  requireViewer,
  viewerRateLimitKey,
} from "@/lib/auth-guards";

const nowSec = () => Math.floor(Date.now() / 1000);
const guestRow = { id: "guest", status: "ACTIVE", isGuestPreview: true, sessionInvalidatedAt: null, emailVerified: new Date(), phoneVerifiedAt: null, isAdmin: false };
const memberRow = { ...guestRow, id: "member", isGuestPreview: false };

beforeEach(() => {
  vi.stubEnv("GUEST_PREVIEW_ENABLED", "1");
});
afterEach(() => {
  vi.unstubAllEnvs();
  session = null;
  row = null;
});

describe("a live guest preview session", () => {
  beforeEach(() => {
    session = { user: { id: "guest", isGuest: true }, issuedAt: nowSec() - 60 };
    row = guestRow;
  });

  it("can read", async () => {
    await expect(requireViewer()).resolves.toMatchObject({ id: "guest" });
    await expect(requireVerifiedViewer()).resolves.toMatchObject({ id: "guest" });
  });

  it("can never write: every member guard refuses it with GuestReadOnlyError (an AuthError)", async () => {
    await expect(requireUser()).rejects.toBeInstanceOf(GuestReadOnlyError);
    await expect(requireUser()).rejects.toBeInstanceOf(AuthError);
    await expect(requireAdmin()).rejects.toBeInstanceOf(GuestReadOnlyError);
  });
});

describe("a guest session that should be over", () => {
  it("ends 2 hours after it started", async () => {
    session = { user: { id: "guest", isGuest: true }, issuedAt: nowSec() - 2 * 3600 - 1 };
    row = guestRow;
    await expect(requireViewer()).rejects.toBeInstanceOf(AuthError);
  });

  it("ends when the kill switch is off", async () => {
    vi.stubEnv("GUEST_PREVIEW_ENABLED", "");
    session = { user: { id: "guest", isGuest: true }, issuedAt: nowSec() - 60 };
    row = guestRow;
    await expect(requireViewer()).rejects.toBeInstanceOf(AuthError);
  });

  it("ends when an admin suspends the guest row", async () => {
    session = { user: { id: "guest", isGuest: true }, issuedAt: nowSec() - 60 };
    row = { ...guestRow, status: "SUSPENDED" };
    await expect(requireViewer()).rejects.toBeInstanceOf(AuthError);
  });
});

describe("claim and row must agree", () => {
  it("refuses the guest row without the guest claim", async () => {
    session = { user: { id: "guest" }, issuedAt: nowSec() - 60 };
    row = guestRow;
    await expect(requireViewer()).rejects.toBeInstanceOf(AuthError);
  });

  it("refuses a guest claim on a member's row", async () => {
    session = { user: { id: "member", isGuest: true }, issuedAt: nowSec() - 60 };
    row = memberRow;
    await expect(requireViewer()).rejects.toBeInstanceOf(AuthError);
  });
});

describe("members are unaffected", () => {
  it("passes every guard, whatever the guest switch says", async () => {
    vi.stubEnv("GUEST_PREVIEW_ENABLED", "");
    session = { user: { id: "member" }, issuedAt: nowSec() - 90 * 24 * 3600 };
    row = memberRow;
    await expect(requireUser()).resolves.toMatchObject({ id: "member" });
    await expect(requireViewer()).resolves.toMatchObject({ id: "member" });
  });
});

describe("viewerRateLimitKey", () => {
  it("counts each guest visitor separately (they share one user id), members by their id", async () => {
    session = { user: { id: "guest", isGuest: true }, issuedAt: nowSec(), guestSessionId: "visitor-a" };
    expect(await viewerRateLimitKey({ id: "guest", isGuestPreview: true })).toBe("guest:visitor-a");
    session = { user: { id: "guest", isGuest: true }, issuedAt: nowSec(), guestSessionId: "visitor-b" };
    expect(await viewerRateLimitKey({ id: "guest", isGuestPreview: true })).toBe("guest:visitor-b");
    expect(await viewerRateLimitKey({ id: "member", isGuestPreview: false })).toBe("member");
  });
});
