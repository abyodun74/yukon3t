import { describe, expect, it } from "vitest";
import {
  FREE_GIFT_DAILY_MAX,
  FREE_GIFT_PER_RECIPIENT_DAILY_MAX,
  GIFT_SHOWCASE_MAX,
  freeShowcasePosition,
  inYearlyWindow,
  isFreeGiftProduct,
  nextEditionNumber,
  showcaseEligible,
  thankYouRefusal,
} from "@/lib/gifts";
import { readFileSync } from "node:fs";
import path from "node:path";
import { FAIL_CLOSED_WITH_DB_FALLBACK } from "@/lib/rate-limit";

// Phase A pure rules (src/lib/gifts.ts): free gifts, numbered editions, yearly windows, the Thank You and the showcase.

describe("free gifts", () => {
  it("are price 0 AND an appreciation sentiment; nothing else is free", () => {
    expect(isFreeGiftProduct({ webPriceMinor: 0, occasionTags: ["appreciation"] })).toBe(true);
    expect(isFreeGiftProduct({ webPriceMinor: 0, occasionTags: ["birthday"] })).toBe(false);
    expect(isFreeGiftProduct({ webPriceMinor: 99, occasionTags: ["appreciation"] })).toBe(false);
  });
  it("are limited to 20 a day in all and 3 a day per person, failing closed with the database fallback", () => {
    expect(FREE_GIFT_DAILY_MAX).toBe(20);
    expect(FREE_GIFT_PER_RECIPIENT_DAILY_MAX).toBe(3);
    const source = readFileSync(path.join(process.cwd(), "src/lib/rate-limit.ts"), "utf8");
    expect(source).toContain(`giftFreeDaily: makeLimiter(${FREE_GIFT_DAILY_MAX}, "24 h")`);
    expect(source).toContain(`giftFreeToSameRecipient: makeLimiter(${FREE_GIFT_PER_RECIPIENT_DAILY_MAX}, "24 h")`);
    expect(FAIL_CLOSED_WITH_DB_FALLBACK.has("giftFreeDaily")).toBe(true);
    expect(FAIL_CLOSED_WITH_DB_FALLBACK.has("giftFreeToSameRecipient")).toBe(true);
  });
});

describe("numbered editions", () => {
  it("number sequentially from 1, never at random", () => {
    expect(nextEditionNumber(null, null)).toBe(1);
    expect(nextEditionNumber(1, null)).toBe(2);
    expect(nextEditionNumber(41, undefined)).toBe(42);
  });
  it("stop at a limited edition's size (the gift is then undeliverable, never 'N left')", () => {
    expect(nextEditionNumber(9, 10)).toBe(10);
    expect(nextEditionNumber(10, 10)).toBeNull();
  });
});

describe("yearly availability windows", () => {
  it("always available without one", () => {
    expect(inYearlyWindow(null, null, { month: 7, day: 4 })).toBe(true);
  });
  it("inclusive, and wrapping the new year", () => {
    expect(inYearlyWindow("12-01", "01-15", { month: 12, day: 24 })).toBe(true);
    expect(inYearlyWindow("12-01", "01-15", { month: 1, day: 15 })).toBe(true);
    expect(inYearlyWindow("12-01", "01-15", { month: 1, day: 16 })).toBe(false);
    expect(inYearlyWindow("03-01", "03-31", { month: 3, day: 1 })).toBe(true);
    expect(inYearlyWindow("03-01", "03-31", { month: 4, day: 1 })).toBe(false);
  });
  it("comes back every year (no year in it), and treats a malformed bound as open", () => {
    expect(inYearlyWindow("03-01", "03-31", { month: 3, day: 10 })).toBe(true);
    expect(inYearlyWindow("13-40", "03-31", { month: 1, day: 1 })).toBe(true);
    expect(inYearlyWindow("10-01", null, { month: 9, day: 30 })).toBe(false);
  });
});

describe("the free Thank You", () => {
  const received = { recipientId: "me", senderId: "bob", status: "OPENED", thanksForSendId: null, thanked: false };
  it("is for the recipient of a delivered gift, once", () => {
    expect(thankYouRefusal({ userId: "me", received })).toBeNull();
    expect(thankYouRefusal({ userId: "me", received: { ...received, status: "DELIVERED" } })).toBeNull();
    expect(thankYouRefusal({ userId: "me", received: { ...received, thanked: true } })).toBe("already_thanked");
  });
  it("is never for someone else's gift, an undelivered one, a Thank You itself, or a deleted sender", () => {
    expect(thankYouRefusal({ userId: "eve", received })).toBe("not_found");
    expect(thankYouRefusal({ userId: "me", received: null })).toBe("not_found");
    expect(thankYouRefusal({ userId: "me", received: { ...received, status: "UNDELIVERABLE" } })).toBe("not_found");
    expect(thankYouRefusal({ userId: "me", received: { ...received, status: "REVOKED" } })).toBe("not_found");
    expect(thankYouRefusal({ userId: "me", received: { ...received, thanksForSendId: "x" } })).toBe("unavailable");
    expect(thankYouRefusal({ userId: "me", received: { ...received, senderId: null } })).toBe("unavailable");
  });
});

describe("the showcase", () => {
  it("holds 3, in the first free positions", () => {
    expect(GIFT_SHOWCASE_MAX).toBe(3);
    expect(freeShowcasePosition([])).toBe(0);
    expect(freeShowcasePosition([0, 2])).toBe(1);
    expect(freeShowcasePosition([0, 1, 2])).toBeNull();
  });
  it("takes only the owner's own, unrevoked copy of an opened (not hidden) gift", () => {
    const ok = { ownerId: "me", userId: "me", revokedAt: null, sendStatus: "OPENED" };
    expect(showcaseEligible(ok)).toBe(true);
    expect(showcaseEligible({ ...ok, userId: "eve" })).toBe(false);
    expect(showcaseEligible({ ...ok, revokedAt: new Date() })).toBe(false);
    expect(showcaseEligible({ ...ok, sendStatus: "HIDDEN_BY_RECIPIENT" })).toBe(false);
    expect(showcaseEligible({ ...ok, sendStatus: "DELIVERED" })).toBe(false);
    expect(showcaseEligible({ ...ok, sendStatus: "REVOKED" })).toBe(false);
  });
});
