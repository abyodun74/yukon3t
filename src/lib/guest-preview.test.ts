import { describe, expect, it } from "vitest";
import {
  GUEST_PREVIEW_SESSION_MAX_SECONDS,
  guestFeedbackUrl,
  isGuestPreviewEnabled,
  isGuestSessionLive,
  safeGuestExitDestination,
  sanitizeGuestRef,
} from "@/lib/guest-preview";

const NOW = Date.UTC(2026, 9, 26, 12, 0, 0);
const secondsAgo = (s: number) => Math.floor(NOW / 1000) - s;

describe("isGuestPreviewEnabled (kill switch)", () => {
  it("is off unless exactly '1'", () => {
    expect(isGuestPreviewEnabled({})).toBe(false);
    expect(isGuestPreviewEnabled({ GUEST_PREVIEW_ENABLED: "" })).toBe(false);
    expect(isGuestPreviewEnabled({ GUEST_PREVIEW_ENABLED: "0" })).toBe(false);
    expect(isGuestPreviewEnabled({ GUEST_PREVIEW_ENABLED: "true" })).toBe(false);
    expect(isGuestPreviewEnabled({ GUEST_PREVIEW_ENABLED: "1" })).toBe(true);
  });
});

describe("isGuestSessionLive (fixed 2-hour lifetime)", () => {
  it("is 2 hours", () => {
    expect(GUEST_PREVIEW_SESSION_MAX_SECONDS).toBe(7200);
  });

  it("lives until 2 hours after it started, not a second more", () => {
    expect(isGuestSessionLive({ issuedAt: secondsAgo(0), nowMs: NOW, enabled: true })).toBe(true);
    expect(isGuestSessionLive({ issuedAt: secondsAgo(7199), nowMs: NOW, enabled: true })).toBe(true);
    expect(isGuestSessionLive({ issuedAt: secondsAgo(7200), nowMs: NOW, enabled: true })).toBe(false);
    expect(isGuestSessionLive({ issuedAt: secondsAgo(30 * 24 * 3600), nowMs: NOW, enabled: true })).toBe(false);
  });

  it("ends every session at once when the feature is switched off", () => {
    expect(isGuestSessionLive({ issuedAt: secondsAgo(10), nowMs: NOW, enabled: false })).toBe(false);
  });

  it("refuses a missing, non-numeric or future start", () => {
    expect(isGuestSessionLive({ issuedAt: undefined, nowMs: NOW, enabled: true })).toBe(false);
    expect(isGuestSessionLive({ issuedAt: null, nowMs: NOW, enabled: true })).toBe(false);
    expect(isGuestSessionLive({ issuedAt: Number.NaN, nowMs: NOW, enabled: true })).toBe(false);
    expect(isGuestSessionLive({ issuedAt: secondsAgo(-3600), nowMs: NOW, enabled: true })).toBe(false);
    // A little clock skew between servers is fine.
    expect(isGuestSessionLive({ issuedAt: secondsAgo(-30), nowMs: NOW, enabled: true })).toBe(true);
  });
});

describe("safeGuestExitDestination", () => {
  it("only goes to sign-up, sign-in or the landing page", () => {
    expect(safeGuestExitDestination("/sign-in")).toBe("/sign-in");
    expect(safeGuestExitDestination("/sign-up")).toBe("/sign-up");
    expect(safeGuestExitDestination("/")).toBe("/");
    expect(safeGuestExitDestination("https://evil.example")).toBe("/sign-up");
    expect(safeGuestExitDestination("//evil.example")).toBe("/sign-up");
    expect(safeGuestExitDestination(null)).toBe("/sign-up");
  });
});

describe("sanitizeGuestRef", () => {
  it("keeps a short plain tag, lowercased", () => {
    expect(sanitizeGuestRef("reddit")).toBe("reddit");
    expect(sanitizeGuestRef(" SideProject ")).toBe("sideproject");
    expect(sanitizeGuestRef("r_sideproject-1")).toBe("r_sideproject-1");
  });
  it("drops anything else", () => {
    expect(sanitizeGuestRef("<script>")).toBeNull();
    expect(sanitizeGuestRef("a b")).toBeNull();
    expect(sanitizeGuestRef("x".repeat(33))).toBeNull();
    expect(sanitizeGuestRef(undefined)).toBeNull();
    expect(sanitizeGuestRef(["reddit"])).toBeNull();
  });
});

describe("guestFeedbackUrl", () => {
  it("uses a configured https or mailto link", () => {
    expect(guestFeedbackUrl("https://forms.example/feedback")).toBe("https://forms.example/feedback");
    expect(guestFeedbackUrl("mailto:hi@yukon3t.com")).toBe("mailto:hi@yukon3t.com");
  });
  it("falls back to the support inbox for anything else", () => {
    expect(guestFeedbackUrl(undefined)).toMatch(/^mailto:support@yukon3t\.com/);
    expect(guestFeedbackUrl("javascript:alert(1)")).toMatch(/^mailto:support@yukon3t\.com/);
  });
});
