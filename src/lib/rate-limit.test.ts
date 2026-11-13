import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  FAIL_CLOSED_NO_FALLBACK,
  FAIL_CLOSED_WITH_DB_FALLBACK,
  checkRateLimit,
  rateLimiters,
  registerRateLimitFallback,
  unavailableBehaviour,
} from "@/lib/rate-limit";
import { captureError } from "@/lib/error-tracking";

vi.mock("@/lib/error-tracking", () => ({ captureError: vi.fn(async () => {}) }));

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

describe("limiters with the same window and identifier (own counters)", () => {
  it("exhausting rsvp (30 per 1m) does not consume like (60 per 1m)", async () => {
    const user = `test-own-counter-${Math.random()}`;
    for (let i = 0; i < 30; i++) {
      await checkRateLimit("rsvp", user);
    }
    expect(await checkRateLimit("rsvp", user)).toBe(false);
    for (let i = 0; i < 60; i++) {
      expect(await checkRateLimit("like", user)).toBe(true);
    }
  });
});

describe("fail-open reporting is throttled", () => {
  const TEN_MINUTES = 10 * 60 * 1000;
  // The throttle state is module-level, so every test starts well past the
  // previous test's window.
  let clock = new Date("2030-01-01T00:00:00Z").getTime();

  beforeEach(() => {
    clock += 60 * 60 * 1000;
    vi.useFakeTimers();
    vi.setSystemTime(clock);
    vi.mocked(captureError).mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("still fails open on every thrown error but reports only once per window", async () => {
    vi.spyOn(rateLimiters.pageRequest, "limit").mockRejectedValue(new Error("max requests limit exceeded"));

    for (let i = 0; i < 5; i++) {
      expect(await checkRateLimit("pageRequest", "ip")).toBe(true);
    }
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError).toHaveBeenCalledWith(expect.any(Error), {
      where: "checkRateLimit",
      limiter: "pageRequest",
      suppressedSinceLastReport: 0,
    });
    expect(console.error).toHaveBeenCalledTimes(1);

    vi.setSystemTime(clock + TEN_MINUTES - 1);
    await checkRateLimit("pageRequest", "ip");
    expect(captureError).toHaveBeenCalledTimes(1);

    vi.setSystemTime(clock + TEN_MINUTES);
    expect(await checkRateLimit("pageRequest", "ip")).toBe(true);
    expect(captureError).toHaveBeenCalledTimes(2);
    expect(captureError).toHaveBeenLastCalledWith(expect.any(Error), {
      where: "checkRateLimit",
      limiter: "pageRequest",
      suppressedSinceLastReport: 5,
    });
  });

  it("does not key the throttle by limiter", async () => {
    vi.spyOn(rateLimiters.pageRequest, "limit").mockRejectedValue(new Error("down"));
    vi.spyOn(rateLimiters.like, "limit").mockRejectedValue(new Error("down"));

    await checkRateLimit("pageRequest", "ip");
    await checkRateLimit("like", "user");
    expect(captureError).toHaveBeenCalledTimes(1);
  });

  it("throttles timeouts separately from thrown errors", async () => {
    vi.spyOn(rateLimiters.pageRequest, "limit").mockResolvedValue({
      success: true,
      remaining: 0,
      reason: "timeout",
    } as never);

    expect(await checkRateLimit("pageRequest", "ip")).toBe(true);
    expect(await checkRateLimit("pageRequest", "ip")).toBe(true);
    expect(console.error).toHaveBeenCalledTimes(1);

    vi.spyOn(rateLimiters.pageRequest, "limit").mockRejectedValue(new Error("down"));
    await checkRateLimit("pageRequest", "ip");
    expect(captureError).toHaveBeenCalledTimes(1);
  });

  it("does not wait on captureError", async () => {
    vi.spyOn(rateLimiters.pageRequest, "limit").mockRejectedValue(new Error("down"));
    vi.mocked(captureError).mockReturnValue(new Promise(() => {}));

    await expect(checkRateLimit("pageRequest", "ip")).resolves.toBe(true);
  });
});

describe("the rate option (page-limit credits)", () => {
  it("reserves several requests at once and refuses a batch that doesn't fit without consuming it", async () => {
    const key = `test-rate-${Math.random()}`;
    // "pageRequest" allows 300 per 1m.
    expect(await checkRateLimit("pageRequest", key, { rate: 295 })).toBe(true);
    expect(await checkRateLimit("pageRequest", key, { rate: 10 })).toBe(false);
    for (let i = 0; i < 5; i++) expect(await checkRateLimit("pageRequest", key)).toBe(true);
    expect(await checkRateLimit("pageRequest", key)).toBe(false);
  });
});

describe("when Upstash is unavailable", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    registerRateLimitFallback(null);
  });

  const SENDERS = [
    "signIn",
    "passwordSignUp",
    "passwordResetRequest",
    "emailOtpSend",
    "phoneVerifyRequest",
    "deviceChallengeSend",
    "accountReauth",
    // Not senders, but on the same database fallback: digital gifts (app/actions/gifts.ts) must never be unlimited.
    "giftIntent",
    "giftToSameRecipient",
    "giftFreeDaily",
    "giftFreeToSameRecipient",
    // Challenges (Gift Universe Phase B): a declared win gives a gift and promotes paid gifts, never unlimited.
    "challengeCreate",
    "challengeDeclare",
    "challengeJoin",
  ] as const;

  it("puts every email/SMS-sending limiter on the database fallback, and only paid ones on plain fail-closed", () => {
    for (const name of SENDERS) expect(unavailableBehaviour(name)).toBe("database");
    expect([...FAIL_CLOSED_WITH_DB_FALLBACK].sort()).toEqual([...SENDERS].sort());
    for (const name of FAIL_CLOSED_NO_FALLBACK) expect(unavailableBehaviour(name)).toBe("closed");
    // Reads, feeds and the page limit keep failing open.
    for (const name of ["pageRequest", "pageRequestDevice", "like", "museView", "avatarView", "pollList", "giftOpen", "giftCatalog", "challengeList", "challengeManage"] as const) {
      expect(unavailableBehaviour(name)).toBe("open");
    }
  });

  it("counts an email/SMS sender in the database fallback on an Upstash error, and follows its answer", async () => {
    vi.spyOn(rateLimiters.passwordResetRequest, "limit").mockRejectedValue(new Error("max requests limit exceeded"));
    const fallback = vi.fn(async () => true);
    registerRateLimitFallback(fallback);
    expect(await checkRateLimit("passwordResetRequest", "resetreq:1.2.3.4:a@b.c")).toBe(true);
    // Same key space as Upstash (rl:<name>), same size and window (5 per hour).
    expect(fallback).toHaveBeenCalledWith("rl:passwordResetRequest:resetreq:1.2.3.4:a@b.c", 5, 3_600_000);

    fallback.mockResolvedValue(false);
    expect(await checkRateLimit("passwordResetRequest", "resetreq:1.2.3.4:a@b.c")).toBe(false);
  });

  it("uses the fallback on a timeout too (the library resolves success: true there)", async () => {
    vi.spyOn(rateLimiters.phoneVerifyRequest, "limit").mockResolvedValue({
      success: true,
      remaining: 0,
      reason: "timeout",
    } as never);
    registerRateLimitFallback(async () => false);
    expect(await checkRateLimit("phoneVerifyRequest", "user-1")).toBe(false);
  });

  it("refuses an email/SMS sender when there is no fallback or the database fails as well", async () => {
    vi.spyOn(rateLimiters.emailOtpSend, "limit").mockRejectedValue(new Error("down"));
    expect(await checkRateLimit("emailOtpSend", "otpsend:x")).toBe(false);

    registerRateLimitFallback(async () => {
      throw new Error("db down");
    });
    expect(await checkRateLimit("emailOtpSend", "otpsend:x")).toBe(false);
  });

  it("refuses a paid limiter without a fallback, and still fails open for ordinary ones", async () => {
    vi.spyOn(rateLimiters.transcribeAudio, "limit").mockRejectedValue(new Error("down"));
    vi.spyOn(rateLimiters.like, "limit").mockRejectedValue(new Error("down"));
    const fallback = vi.fn(async () => true);
    registerRateLimitFallback(fallback);
    expect(await checkRateLimit("transcribeAudio", "u")).toBe(false);
    expect(await checkRateLimit("like", "u")).toBe(true);
    expect(fallback).not.toHaveBeenCalled();
  });
});
