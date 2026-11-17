import { describe, it, expect, vi, afterEach } from "vitest";
import { isFlagged, hiveFailureForStatus, isProviderWideFailure, parseRetryAfterSeconds, moderateVideo } from "@/lib/hive";

function response(classes: Array<{ class: string; value: number }>) {
  return { output: [{ classes }] };
}

describe("isFlagged", () => {
  it("does not flag a clean result", () => {
    expect(
      isFlagged(response([{ class: "general_nsfw", value: 0.0000078 }])),
    ).toBe(false);
  });

  it("flags when general_nsfw crosses the threshold", () => {
    expect(isFlagged(response([{ class: "general_nsfw", value: 0.9 }]))).toBe(true);
  });

  it("does not flag a score just under the threshold", () => {
    expect(isFlagged(response([{ class: "general_nsfw", value: 0.74 }]))).toBe(false);
  });

  it("flags a score exactly at the threshold", () => {
    expect(isFlagged(response([{ class: "general_nsfw", value: 0.75 }]))).toBe(true);
  });

  it("ignores unrelated classes with high scores", () => {
    expect(
      isFlagged(response([{ class: "yes_smoking", value: 0.99 }])),
    ).toBe(false);
  });

  it("checks every sampled video frame, not just the first", () => {
    const data = {
      output: [
        { classes: [{ class: "general_nsfw", value: 0.01 }] },
        { classes: [{ class: "general_nsfw", value: 0.01 }] },
        { classes: [{ class: "general_nsfw", value: 0.95 }] },
      ],
    };
    expect(isFlagged(data)).toBe(true);
  });

  it("handles a missing/empty output gracefully", () => {
    expect(isFlagged({})).toBe(false);
    expect(isFlagged({ output: [] })).toBe(false);
  });
});

describe("hiveFailureForStatus / isProviderWideFailure", () => {
  it("treats key, credit, rate-limit and server errors as provider-wide", () => {
    for (const status of [401, 403, 402, 429, 500, 503]) {
      expect(isProviderWideFailure(hiveFailureForStatus(status)), String(status)).toBe(true);
    }
  });

  it("treats a paused or out-of-balance account as out of credit, whatever the status", () => {
    const paused =
      '{"status_code":405,"message":"Your Organization is currently paused. Please check your account balance, our terms and conditions, or contact support@thehive.ai for more information."}';
    expect(hiveFailureForStatus(405, paused)).toBe("out_of_credit");
    expect(hiveFailureForStatus(400, paused)).toBe("out_of_credit");
    expect(isProviderWideFailure(hiveFailureForStatus(405, paused))).toBe(true);
  });

  it("treats an unrecognised client error as provider-wide, never against the video", () => {
    for (const status of [404, 405, 409, 410]) {
      expect(isProviderWideFailure(hiveFailureForStatus(status)), String(status)).toBe(true);
    }
  });

  it("treats media errors as about the video", () => {
    for (const status of [400, 413, 415, 422]) {
      expect(hiveFailureForStatus(status), String(status)).toBe("rejected_media");
      expect(isProviderWideFailure("rejected_media")).toBe(false);
    }
  });

  it("names the common cases", () => {
    expect(hiveFailureForStatus(401)).toBe("unauthorized");
    expect(hiveFailureForStatus(402)).toBe("out_of_credit");
    expect(hiveFailureForStatus(429)).toBe("rate_limited");
    expect(hiveFailureForStatus(502)).toBe("provider_error");
  });

  it("counts a missing key and an unreachable host as provider-wide, a timeout as about the video", () => {
    expect(isProviderWideFailure("not_configured")).toBe(true);
    expect(isProviderWideFailure("unreachable")).toBe(true);
    expect(isProviderWideFailure("timeout")).toBe(false);
    expect(isProviderWideFailure("bad_response")).toBe(false);
  });
});

describe("parseRetryAfterSeconds", () => {
  const now = Date.parse("2026-11-16T12:00:00Z");
  it("reads delta-seconds and HTTP dates", () => {
    expect(parseRetryAfterSeconds("120", now)).toBe(120);
    expect(parseRetryAfterSeconds(" 0 ", now)).toBe(0);
    expect(parseRetryAfterSeconds("Mon, 16 Nov 2026 12:30:00 GMT", now)).toBe(1800);
  });
  it("ignores missing, unreadable, past or absurd values", () => {
    expect(parseRetryAfterSeconds(null, now)).toBeUndefined();
    expect(parseRetryAfterSeconds("", now)).toBeUndefined();
    expect(parseRetryAfterSeconds("soon", now)).toBeUndefined();
    expect(parseRetryAfterSeconds("-5", now)).toBeUndefined();
    expect(parseRetryAfterSeconds("Mon, 16 Nov 2026 11:00:00 GMT", now)).toBeUndefined();
    expect(parseRetryAfterSeconds(String(10 * 24 * 3600), now)).toBeUndefined();
  });
});

describe("moderateVideo (HTTP)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("passes Hive's Retry-After through on a 429", async () => {
    vi.stubEnv("HIVE_API_KEY", "k");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"message":"rate limited"}', { status: 429, headers: { "Retry-After": "900" } })),
    );
    expect(await moderateVideo("https://media.example.com/v.mp4")).toMatchObject({
      ok: false,
      failure: "rate_limited",
      retryAfterSeconds: 900,
    });
  });

  it("aborts at the shorter timeout the caller gives (never above 30s)", async () => {
    vi.useFakeTimers();
    vi.stubEnv("HIVE_API_KEY", "k");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(new Error("aborted")))),
      ),
    );
    const pending = moderateVideo("https://media.example.com/v.mp4", { timeoutMs: 5_000 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await pending).toEqual({ ok: false, failure: "timeout" });
  });
});
