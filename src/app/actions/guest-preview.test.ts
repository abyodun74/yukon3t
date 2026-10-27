import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// startGuestPreview / leaveGuestPreview against mocks: the kill switch, never replacing a member's session, the bot
// check, the per-IP and global limiters, and what a started session records.
class Redirect extends Error {
  constructor(readonly to: string) {
    super(`redirect ${to}`);
  }
}
let session: { user: { id: string; isGuest?: boolean } } | null = null;
const limits: Record<string, boolean> = {};
let botGate = true;
let isBot = false;
let guestId: string | null = "guest";
const issueGuestSessionCookie = vi.fn();
const track = vi.fn();
const signOut = vi.fn(async ({ redirectTo }: { redirectTo: string }) => {
  throw new Redirect(redirectTo);
});

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));
vi.mock("@/lib/auth", () => ({ auth: async () => session, signOut: (a: { redirectTo: string }) => signOut(a) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async (name: string) => limits[name] ?? true }));
vi.mock("@/lib/client-ip", () => ({ getClientIp: async () => "203.0.113.7" }));
vi.mock("@/lib/bot-protection", () => ({ isBotSubmission: () => isBot }));
vi.mock("@/lib/bot-gate", () => ({ passesBotGate: async () => botGate }));
vi.mock("@/lib/analytics", () => ({ track: (...a: unknown[]) => track(...a) }));
vi.mock("@/lib/hidden-chats", () => ({ clearHiddenUnlockCookie: async () => {} }));
vi.mock("@/lib/guest-preview-server", () => ({
  ensureGuestPreviewUser: async () => guestId,
  issueGuestSessionCookie: (...a: unknown[]) => issueGuestSessionCookie(...a),
}));

import { leaveGuestPreview, startGuestPreview } from "@/app/actions/guest-preview";

function form(fields: Record<string, string> = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function redirectOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    if (err instanceof Redirect) return err.to;
    throw err;
  }
  return null;
}

beforeEach(() => {
  vi.stubEnv("GUEST_PREVIEW_ENABLED", "1");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  session = null;
  for (const k of Object.keys(limits)) delete limits[k];
  botGate = true;
  isBot = false;
  guestId = "guest";
});

describe("startGuestPreview", () => {
  it("starts this visitor's own guest session and opens Home", async () => {
    expect(await redirectOf(startGuestPreview(form({ ref: "Reddit" })))).toBe("/home");
    expect(issueGuestSessionCookie).toHaveBeenCalledWith("guest");
    expect(track).toHaveBeenCalledWith("GUEST_PREVIEW_STARTED", "guest", { ref: "reddit" });
  });

  it("does nothing while the kill switch is off", async () => {
    vi.stubEnv("GUEST_PREVIEW_ENABLED", "");
    expect(await redirectOf(startGuestPreview(form()))).toBe("/try?error=unavailable");
    expect(issueGuestSessionCookie).not.toHaveBeenCalled();
  });

  it("never replaces a member's session", async () => {
    session = { user: { id: "member" } };
    expect(await redirectOf(startGuestPreview(form()))).toBe("/home");
    expect(issueGuestSessionCookie).not.toHaveBeenCalled();
  });

  it("refuses a bot (honeypot) and a failed Turnstile check", async () => {
    isBot = true;
    expect(await redirectOf(startGuestPreview(form()))).toBe("/try?error=rate_limited");
    isBot = false;
    botGate = false;
    expect(await redirectOf(startGuestPreview(form({ ref: "reddit" })))).toBe("/try?error=captcha&ref=reddit");
    expect(issueGuestSessionCookie).not.toHaveBeenCalled();
  });

  it("is rate limited per IP and globally", async () => {
    limits.guestPreviewStart = false;
    expect(await redirectOf(startGuestPreview(form()))).toBe("/try?error=rate_limited");
    limits.guestPreviewStart = true;
    limits.guestPreviewStartGlobal = false;
    expect(await redirectOf(startGuestPreview(form()))).toBe("/try?error=rate_limited");
    expect(issueGuestSessionCookie).not.toHaveBeenCalled();
  });

  it("answers unavailable when there is no usable guest row (e.g. an admin suspended it)", async () => {
    guestId = null;
    expect(await redirectOf(startGuestPreview(form()))).toBe("/try?error=unavailable");
    expect(issueGuestSessionCookie).not.toHaveBeenCalled();
  });
});

describe("leaveGuestPreview", () => {
  it("ends a guest session on the way to sign-up / sign-in", async () => {
    session = { user: { id: "guest", isGuest: true } };
    expect(await redirectOf(leaveGuestPreview(form({ to: "/sign-in" })))).toBe("/sign-in");
    expect(signOut).toHaveBeenCalledWith({ redirectTo: "/sign-in" });
  });

  it("never signs a member out, and only goes to the allowed places", async () => {
    session = { user: { id: "member" } };
    expect(await redirectOf(leaveGuestPreview(form({ to: "https://evil.example" })))).toBe("/sign-up");
    expect(signOut).not.toHaveBeenCalled();
  });
});
