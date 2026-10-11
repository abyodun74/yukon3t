import { describe, expect, it } from "vitest";
import { passwordSignInOutcome } from "./password-sign-in";

const flaggedAt = new Date("2026-10-11T15:00:00Z");

describe("passwordSignInOutcome", () => {
  it("treats a wrong password the same whether or not a reset is required", () => {
    const withFlag = passwordSignInOutcome({ passwordOk: false, resetRequiredAt: flaggedAt, isAppReviewDemo: false });
    const withoutFlag = passwordSignInOutcome({ passwordOk: false, resetRequiredAt: null, isAppReviewDemo: false });
    expect(withFlag).toBe("wrong_password");
    expect(withFlag).toBe(withoutFlag);
  });

  it("requires a reset when the correct password is one that must be replaced", () => {
    expect(passwordSignInOutcome({ passwordOk: true, resetRequiredAt: flaggedAt, isAppReviewDemo: false })).toBe(
      "reset_required",
    );
  });

  it("proceeds on a correct password with no reset required", () => {
    expect(passwordSignInOutcome({ passwordOk: true, resetRequiredAt: null, isAppReviewDemo: false })).toBe("proceed");
  });

  it("never asks the App Store review demo account to reset", () => {
    expect(passwordSignInOutcome({ passwordOk: true, resetRequiredAt: flaggedAt, isAppReviewDemo: true })).toBe(
      "proceed",
    );
    expect(passwordSignInOutcome({ passwordOk: true, resetRequiredAt: null, isAppReviewDemo: true })).toBe("proceed");
  });

  it("still rejects a wrong password on the demo account", () => {
    expect(passwordSignInOutcome({ passwordOk: false, resetRequiredAt: flaggedAt, isAppReviewDemo: true })).toBe(
      "wrong_password",
    );
  });
});
