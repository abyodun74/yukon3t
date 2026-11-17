import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Without Upstash configured the cooldown lives in this instance's memory only (best effort); with it, Redis is read
// and written, and a Redis failure falls back to memory without failing the run.

const redisGet = vi.fn();
const redisSet = vi.fn();
vi.mock("@upstash/redis", () => ({
  Redis: class {
    get = redisGet;
    set = redisSet;
  },
}));

const { readHiveCooldown, writeHiveCooldown, resetHiveCooldownStoreForTests } = await import("@/lib/hive-cooldown-store");

const COOLDOWN = { untilMs: Date.now() + 15 * 60_000, failure: "rate_limited" as const, streak: 1, setAtMs: Date.now() };

beforeEach(() => {
  vi.clearAllMocks();
  resetHiveCooldownStoreForTests();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("hive cooldown store", () => {
  it("keeps it in memory when Upstash isn't configured", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    expect(await readHiveCooldown()).toEqual({ cooldown: null, store: "memory" });
    expect(await writeHiveCooldown(COOLDOWN)).toBe("memory");
    expect(await readHiveCooldown()).toEqual({ cooldown: COOLDOWN, store: "memory" });
    expect(redisSet).not.toHaveBeenCalled();
  });

  it("writes to and reads from Redis with an expiry when configured", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "t");
    redisSet.mockResolvedValue("OK");
    expect(await writeHiveCooldown(COOLDOWN)).toBe("redis");
    const [key, value, opts] = redisSet.mock.calls[0];
    expect(key).toBe("cron:moderate-videos:hive-cooldown");
    expect(JSON.parse(value)).toEqual(COOLDOWN);
    expect(opts.px).toBeGreaterThan(15 * 60_000);

    resetHiveCooldownStoreForTests(); // a cold instance: nothing in memory
    redisGet.mockResolvedValue(COOLDOWN); // Upstash deserializes JSON itself
    expect(await readHiveCooldown()).toEqual({ cooldown: COOLDOWN, store: "redis" });
  });

  it("falls back to memory when Redis fails", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "t");
    redisSet.mockRejectedValue(new Error("down"));
    redisGet.mockRejectedValue(new Error("down"));
    expect(await writeHiveCooldown(COOLDOWN)).toBe("memory");
    expect(await readHiveCooldown()).toEqual({ cooldown: COOLDOWN, store: "memory" });
  });
});
