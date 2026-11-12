import { describe, expect, it, vi } from "vitest";
import { allowWithCredits, createCreditCache, PAGE_LIMIT_CREDIT_BATCH, PAGE_LIMIT_CREDIT_TTL_MS } from "@/lib/page-limit-credits";

describe("allowWithCredits", () => {
  it("asks Upstash once per batch and spends the rest locally", async () => {
    const cache = createCreditCache();
    const check = vi.fn(async () => true);
    for (let i = 0; i < PAGE_LIMIT_CREDIT_BATCH * 3; i++) {
      expect(await allowWithCredits(cache, "pageRequestDevice:d1", check, 1_000)).toBe(true);
    }
    expect(check).toHaveBeenCalledTimes(3);
    expect(check).toHaveBeenCalledWith(PAGE_LIMIT_CREDIT_BATCH);
  });

  it("keeps each bucket's credit separate", async () => {
    const cache = createCreditCache();
    const check = vi.fn(async () => true);
    await allowWithCredits(cache, "pageRequestDevice:d1", check, 0);
    await allowWithCredits(cache, "pageRequestNetwork:1.2.3.4", check, 0);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("retries a single request when a whole batch no longer fits, and refuses when that doesn't fit either", async () => {
    const cache = createCreditCache();
    const nearlyFull = vi.fn(async (rate: number) => rate === 1);
    expect(await allowWithCredits(cache, "k", nearlyFull, 0)).toBe(true);
    expect(nearlyFull.mock.calls.map((c) => c[0])).toEqual([PAGE_LIMIT_CREDIT_BATCH, 1]);
    expect(cache.size()).toBe(0); // nothing reserved, so nothing to spend

    const full = vi.fn(async () => false);
    expect(await allowWithCredits(cache, "k", full, 0)).toBe(false);
  });

  it("lets reserved credit expire", async () => {
    const cache = createCreditCache();
    const check = vi.fn(async () => true);
    await allowWithCredits(cache, "k", check, 0);
    await allowWithCredits(cache, "k", check, PAGE_LIMIT_CREDIT_TTL_MS);
    expect(check).toHaveBeenCalledTimes(2);
  });
});

describe("createCreditCache", () => {
  it("never holds more than maxKeys identifiers", () => {
    const cache = createCreditCache({ maxKeys: 3 });
    for (let i = 0; i < 10; i++) cache.grant(`k${i}`, 5, 0);
    expect(cache.size()).toBe(3);
    // The newest are kept.
    expect(cache.take("k9", 0)).toBe(true);
    expect(cache.take("k0", 0)).toBe(false);
  });

  it("spends exactly what was granted", () => {
    const cache = createCreditCache();
    cache.grant("k", 2, 0);
    expect(cache.take("k", 0)).toBe(true);
    expect(cache.take("k", 0)).toBe(true);
    expect(cache.take("k", 0)).toBe(false);
    cache.grant("z", 0, 0);
    expect(cache.take("z", 0)).toBe(false);
  });
});
