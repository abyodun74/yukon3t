import { describe, expect, it, vi, beforeEach } from "vitest";

const queryRaw = vi.fn();
const executeRaw = vi.fn<(...args: unknown[]) => Promise<number>>(() => Promise.resolve(0));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => queryRaw(...args),
    $executeRaw: (...args: unknown[]) => executeRaw(...args),
  },
}));

const { databaseFixedWindowAllows, fallbackRowKey } = await import("@/lib/rate-limit-db-fallback");

beforeEach(() => {
  queryRaw.mockReset();
});

describe("database rate-limit fallback", () => {
  it("registers itself in the slot checkRateLimit reads", () => {
    expect((globalThis as Record<symbol, unknown>)[Symbol.for("yukon3t.rateLimitDbFallback")]).toBe(
      databaseFixedWindowAllows,
    );
  });

  it("allows up to the limit and refuses past it", async () => {
    queryRaw.mockResolvedValueOnce([{ count: 5 }]);
    expect(await databaseFixedWindowAllows("rl:x:id", 5, 60_000)).toBe(true);
    queryRaw.mockResolvedValueOnce([{ count: 6 }]);
    expect(await databaseFixedWindowAllows("rl:x:id", 5, 60_000)).toBe(false);
  });

  it("stores only a hash of the key (identifiers can hold an email address or IP)", async () => {
    queryRaw.mockResolvedValueOnce([{ count: 1 }]);
    await databaseFixedWindowAllows("rl:passwordResetRequest:resetreq:1.2.3.4:a@b.c", 5, 3_600_000);
    const values = queryRaw.mock.calls[0].slice(1);
    expect(values).toContain(fallbackRowKey("rl:passwordResetRequest:resetreq:1.2.3.4:a@b.c"));
    expect(values).toContain(3_600_000);
    expect(JSON.stringify(values)).not.toContain("a@b.c");
    expect(fallbackRowKey("a")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses when no row comes back, and passes a database error to the caller", async () => {
    queryRaw.mockResolvedValueOnce([]);
    expect(await databaseFixedWindowAllows("k", 5, 1000)).toBe(false);
    queryRaw.mockRejectedValueOnce(new Error("db down"));
    await expect(databaseFixedWindowAllows("k", 5, 1000)).rejects.toThrow("db down");
  });
});
