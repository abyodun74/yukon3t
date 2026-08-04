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
