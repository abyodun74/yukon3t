import { describe, it, expect } from "vitest";
import { isOnline, onlineSince, ONLINE_WINDOW_MS } from "@/lib/presence";

describe("isOnline", () => {
  it("is false when never seen", () => {
    expect(isOnline(null)).toBe(false);
  });

  it("is true just inside the online window", () => {
    expect(isOnline(new Date(Date.now() - ONLINE_WINDOW_MS + 1_000))).toBe(true);
  });

  it("is false once the online window has elapsed", () => {
    expect(isOnline(new Date(Date.now() - ONLINE_WINDOW_MS - 1_000))).toBe(false);
  });
});

describe("onlineSince", () => {
  it("returns a cutoff ONLINE_WINDOW_MS in the past", () => {
    const cutoff = onlineSince();
    const expected = Date.now() - ONLINE_WINDOW_MS;
    expect(Math.abs(cutoff.getTime() - expected)).toBeLessThan(50);
  });
});
