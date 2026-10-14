import { describe, it, expect } from "vitest";
import { isAccountVerified, signInNeedsVerification } from "@/lib/account-verification";

const at = new Date("2026-10-01T00:00:00Z");

describe("isAccountVerified", () => {
  it("accepts an email-verified account", () => {
    expect(isAccountVerified({ emailVerified: at, phoneVerifiedAt: null })).toBe(true);
  });

  it("accepts a phone-verified account", () => {
    expect(isAccountVerified({ emailVerified: null, phoneVerifiedAt: at })).toBe(true);
  });

  it("accepts an account verified both ways", () => {
    expect(isAccountVerified({ emailVerified: at, phoneVerifiedAt: at })).toBe(true);
  });

  it("refuses an account verified neither way", () => {
    expect(isAccountVerified({ emailVerified: null, phoneVerifiedAt: null })).toBe(false);
  });
});

describe("signInNeedsVerification", () => {
  it("sends an unverified account to verify", () => {
    expect(signInNeedsVerification({ emailVerified: null, phoneVerifiedAt: null, isAppReviewDemo: false })).toBe(true);
  });

  it("lets an email- or phone-verified account through", () => {
    expect(signInNeedsVerification({ emailVerified: at, phoneVerifiedAt: null, isAppReviewDemo: false })).toBe(false);
    expect(signInNeedsVerification({ emailVerified: null, phoneVerifiedAt: at, isAppReviewDemo: false })).toBe(false);
  });

  it("lets the App Review demo account through unverified", () => {
    expect(signInNeedsVerification({ emailVerified: null, phoneVerifiedAt: null, isAppReviewDemo: true })).toBe(false);
  });
});
