import { describe, it, expect } from "vitest";
import { computeTrustScore, bandFromScore } from "@/lib/trust";

const DAY_MS = 24 * 60 * 60 * 1000;
const baseSignals = {
  emailVerified: null as Date | null,
  phoneVerifiedAt: null as Date | null,
  createdAt: new Date(),
  bio: null as string | null,
  country: null as string | null,
  interests: [] as string[],
  currentStreak: 0,
  upheldReportCount: 0,
};

describe("computeTrustScore", () => {
  it("scores a brand-new, unverified account at 0", () => {
    expect(computeTrustScore(baseSignals)).toBe(0);
  });

  it("awards 30 points for a verified email", () => {
    expect(computeTrustScore({ ...baseSignals, emailVerified: new Date() })).toBe(30);
  });

  it("awards 15 points for a verified phone", () => {
    expect(computeTrustScore({ ...baseSignals, phoneVerifiedAt: new Date() })).toBe(15);
  });

  it("stacks email and phone verification additively", () => {
    const verified = { ...baseSignals, emailVerified: new Date(), phoneVerifiedAt: new Date() };
    expect(computeTrustScore(verified)).toBe(45);
  });

  it("awards up to 30 points for account age, capped at ~6 weeks", () => {
    const sixWeeksOld = new Date(Date.now() - 45 * DAY_MS);
    const oneYearOld = new Date(Date.now() - 365 * DAY_MS);
    expect(computeTrustScore({ ...baseSignals, createdAt: sixWeeksOld })).toBe(30);
    // A much older account shouldn't score higher than the cap.
    expect(computeTrustScore({ ...baseSignals, createdAt: oneYearOld })).toBe(30);
  });

  it("awards 20 points for a complete profile (bio + country + interests)", () => {
    const complete = { ...baseSignals, bio: "Hi", country: "Kenya", interests: ["hiking"] };
    expect(computeTrustScore(complete)).toBe(20);
    // Missing any one field means no credit at all — it's all-or-nothing.
    expect(computeTrustScore({ ...complete, interests: [] })).toBe(0);
  });

  it("awards up to 20 points for a streak, +5 per full week, capped", () => {
    expect(computeTrustScore({ ...baseSignals, currentStreak: 6 })).toBe(0);
    expect(computeTrustScore({ ...baseSignals, currentStreak: 7 })).toBe(5);
    expect(computeTrustScore({ ...baseSignals, currentStreak: 100 })).toBe(20);
  });

  it("deducts 15 points per upheld report, capped at -50", () => {
    const verified = { ...baseSignals, emailVerified: new Date() }; // 30 pts baseline
    expect(computeTrustScore({ ...verified, upheldReportCount: 1 })).toBe(15);
    expect(computeTrustScore({ ...verified, upheldReportCount: 10 })).toBe(0); // floored at 0, not negative
  });

  it("never exceeds 100 or drops below 0", () => {
    const maxed = {
      emailVerified: new Date(),
      phoneVerifiedAt: new Date(),
      createdAt: new Date(Date.now() - 365 * DAY_MS),
      bio: "Hi",
      country: "Kenya",
      interests: ["hiking"],
      currentStreak: 365,
      upheldReportCount: 0,
    };
    expect(computeTrustScore(maxed)).toBeLessThanOrEqual(100);
    expect(computeTrustScore({ ...maxed, upheldReportCount: 20 })).toBeGreaterThanOrEqual(0);
  });
});

describe("bandFromScore", () => {
  it("bands NEW below 30, ESTABLISHED 30-69, TRUSTED at 70+", () => {
    expect(bandFromScore(0)).toBe("NEW");
    expect(bandFromScore(29)).toBe("NEW");
    expect(bandFromScore(30)).toBe("ESTABLISHED");
    expect(bandFromScore(69)).toBe("ESTABLISHED");
    expect(bandFromScore(70)).toBe("TRUSTED");
    expect(bandFromScore(100)).toBe("TRUSTED");
  });
});
