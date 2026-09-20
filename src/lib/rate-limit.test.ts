import { describe, it, expect } from "vitest";
import { checkRateLimit } from "@/lib/rate-limit";

// These exercise the in-memory fallback limiter (no UPSTASH_* env vars are
// set in the test environment) — the exact code path flagged as not being
// enforced in production without Upstash configured. Each test uses a
// unique identifier so they can't interfere with each other.

describe("checkRateLimit (in-memory fallback)", () => {
  it("allows requests up to the configured limit", async () => {
    const key = `test-share-${Math.random()}`;
    // "share" allows 20 per 5m.
    for (let i = 0; i < 20; i++) {
      expect(await checkRateLimit("share", key)).toBe(true);
    }
  });

  it("blocks the request that exceeds the limit", async () => {
    const key = `test-comment-${Math.random()}`;
    // "comment" allows 20 per 5m.
    for (let i = 0; i < 20; i++) {
      await checkRateLimit("comment", key);
    }
    expect(await checkRateLimit("comment", key)).toBe(false);
  });

  it("tracks each identifier independently", async () => {
    const keyA = `test-rsvp-a-${Math.random()}`;
    const keyB = `test-rsvp-b-${Math.random()}`;
    // "rsvp" allows 30 per 1m — exhaust it for A only.
    for (let i = 0; i < 30; i++) {
      await checkRateLimit("rsvp", keyA);
    }
    expect(await checkRateLimit("rsvp", keyA)).toBe(false);
    expect(await checkRateLimit("rsvp", keyB)).toBe(true);
  });
});

describe("subCircleCreate (its own counter)", () => {
  it("neither consumes nor is consumed by circleCreate for the same user", async () => {
    const user = `test-subcircle-${Math.random()}`;

    // "circleCreate" allows 5 per 1h — use them all up; the 6th is refused.
    for (let i = 0; i < 5; i++) {
      expect(await checkRateLimit("circleCreate", user)).toBe(true);
    }
    expect(await checkRateLimit("circleCreate", user)).toBe(false);

    // An owner who has hit their Circle-creation limit can still add sub-circles...
    for (let i = 0; i < 20; i++) {
      expect(await checkRateLimit("subCircleCreate", user)).toBe(true);
    }
    // ...up to its own, larger limit (20 per 1h).
    expect(await checkRateLimit("subCircleCreate", user)).toBe(false);
  });

  it("is tracked per user", async () => {
    const a = `test-subcircle-a-${Math.random()}`;
    const b = `test-subcircle-b-${Math.random()}`;
    for (let i = 0; i < 20; i++) {
      await checkRateLimit("subCircleCreate", a);
    }
    expect(await checkRateLimit("subCircleCreate", a)).toBe(false);
    expect(await checkRateLimit("subCircleCreate", b)).toBe(true);
  });
});
