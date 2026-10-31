import { describe, expect, it } from "vitest";
import { DEFAULT_DATABASE_POOL_MAX, resolveDatabasePoolMax } from "./db-pool";

describe("resolveDatabasePoolMax", () => {
  it("defaults to 10 when unset or empty", () => {
    expect(DEFAULT_DATABASE_POOL_MAX).toBe(10);
    expect(resolveDatabasePoolMax(undefined)).toBe(10);
    expect(resolveDatabasePoolMax("")).toBe(10);
    expect(resolveDatabasePoolMax("  ")).toBe(10);
  });

  it("ignores values that would make a broken pool", () => {
    expect(resolveDatabasePoolMax("0")).toBe(10);
    expect(resolveDatabasePoolMax("-3")).toBe(10);
    expect(resolveDatabasePoolMax("lots")).toBe(10);
  });

  it("uses a valid override, capped", () => {
    expect(resolveDatabasePoolMax("5")).toBe(5);
    expect(resolveDatabasePoolMax(" 20 ")).toBe(20);
    expect(resolveDatabasePoolMax("1000")).toBe(50);
  });
});
