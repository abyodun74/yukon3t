import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  APP_REVIEW_DEMO_MIN_PASSWORD_LENGTH,
  appReviewDemoIdentity,
  appReviewDemoPassword,
  isDemoContactRefused,
  matchesAppReviewDemoPassword,
} from "@/lib/app-review-demo";

const STRONG = "x".repeat(APP_REVIEW_DEMO_MIN_PASSWORD_LENGTH);

describe("App Review demo password", () => {
  it("has no default: unset or short means not configured", () => {
    expect(appReviewDemoPassword({})).toBeNull();
    expect(appReviewDemoPassword({ APP_REVIEW_DEMO_PASSWORD: "" })).toBeNull();
    expect(appReviewDemoPassword({ APP_REVIEW_DEMO_PASSWORD: "short-password" })).toBeNull();
    expect(appReviewDemoPassword({ APP_REVIEW_DEMO_PASSWORD: STRONG })).toBe(STRONG);
  });

  it("only the configured value matches, and nothing matches while unset", () => {
    const env = { APP_REVIEW_DEMO_PASSWORD: STRONG };
    expect(matchesAppReviewDemoPassword(STRONG, env)).toBe(true);
    expect(matchesAppReviewDemoPassword(`${STRONG}y`, env)).toBe(false);
    expect(matchesAppReviewDemoPassword("", {})).toBe(false);
    expect(matchesAppReviewDemoPassword(STRONG, {})).toBe(false);
  });

  it("the identity can come from the environment", () => {
    expect(appReviewDemoIdentity({ APP_REVIEW_DEMO_USERNAME: "rev", APP_REVIEW_DEMO_EMAIL: "Rev@Example.com" })).toEqual({
      username: "rev",
      email: "rev@example.com",
    });
    expect(appReviewDemoIdentity({}).username).toBeTruthy();
  });

  it("no password literal is left in the code that manages the demo accounts", () => {
    for (const file of [
      "src/app/actions/password-auth.ts",
      "scripts/fix-app-review-demo-account.ts",
      "src/components/fix-app-review-demo-button.tsx",
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/AppReview001/);
      expect(source).not.toMatch(/APP_REVIEW_DEMO_PASSWORD\s*=\s*["'`]/);
      expect(source).not.toMatch(/--reset-password="[^")]/);
    }
  });
});

describe("isDemoContactRefused", () => {
  const demo = { isAppReviewDemo: true };
  const member = { isAppReviewDemo: false };
  it("demo accounts reach only each other", () => {
    expect(isDemoContactRefused(demo, member)).toBe(true);
    expect(isDemoContactRefused(member, demo)).toBe(true);
    expect(isDemoContactRefused(demo, demo)).toBe(false);
    expect(isDemoContactRefused(member, member)).toBe(false);
  });
});
