import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nearestPostIds = vi.fn();
vi.mock("@/lib/search-embeddings", () => ({ nearestPostIds: (...a: unknown[]) => nearestPostIds(...a) }));
vi.mock("@/lib/embeddings", () => ({
  getEmbedding: async () => [0.1, 0.2],
  toPgVector: (v: number[]) => `[${v.join(",")}]`,
}));

import { buildCategoryFilter, clearCategoryCandidateCache } from "@/lib/feed-category";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-29T12:00:00Z"));
  nearestPostIds.mockReset();
  clearCategoryCandidateCache();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("buildCategoryFilter candidate cache", () => {
  it("reuses a category's semantic id set for 90s, then rescans", async () => {
    nearestPostIds.mockResolvedValue(["p1", "p2"]);
    const first = await buildCategoryFilter("SPORTS");
    expect(first).toEqual({ OR: [{ feedCategory: "SPORTS" }, { id: { in: ["p1", "p2"] } }] });
    await buildCategoryFilter("SPORTS");
    expect(nearestPostIds).toHaveBeenCalledTimes(1);

    // Another category has its own entry.
    await buildCategoryFilter("NEWS");
    expect(nearestPostIds).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(90_001);
    nearestPostIds.mockResolvedValue(["p3"]);
    expect(await buildCategoryFilter("SPORTS")).toEqual({ OR: [{ feedCategory: "SPORTS" }, { id: { in: ["p3"] } }] });
    expect(nearestPostIds).toHaveBeenCalledTimes(3);
  });

  it("shares one scan between concurrent callers", async () => {
    nearestPostIds.mockResolvedValue(["p1"]);
    await Promise.all([buildCategoryFilter("SPORTS"), buildCategoryFilter("SPORTS")]);
    expect(nearestPostIds).toHaveBeenCalledTimes(1);
  });

  it("doesn't keep a failed scan", async () => {
    nearestPostIds.mockRejectedValueOnce(new Error("db down"));
    await expect(buildCategoryFilter("SPORTS")).rejects.toThrow("db down");
    nearestPostIds.mockResolvedValue(["p1"]);
    expect(await buildCategoryFilter("SPORTS")).toEqual({ OR: [{ feedCategory: "SPORTS" }, { id: { in: ["p1"] } }] });
  });

  it("is viewer-independent: the filter has no viewer in it, only the category", async () => {
    nearestPostIds.mockResolvedValue([]);
    expect(await buildCategoryFilter("SPORTS")).toEqual({ feedCategory: "SPORTS" });
    expect(await buildCategoryFilter(null)).toBeUndefined();
    expect(await buildCategoryFilter("GENERAL")).toEqual({ feedCategory: "GENERAL" });
  });
});
