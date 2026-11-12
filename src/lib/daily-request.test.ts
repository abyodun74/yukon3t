import { describe, expect, it, vi } from "vitest";
import {
  DAILY_MAX_ATTEMPTS,
  DAILY_MAX_RETRY_AFTER_MS,
  DailyApiError,
  dailyRequest,
  isRetriableDailyStatus,
  retryAfterMs,
} from "@/lib/daily-request";

function res(status: number, headers: Record<string, string> = {}) {
  return new Response(status === 204 ? null : "{}", { status, headers });
}

function deps(responses: Array<Response | Error>) {
  const queue = [...responses];
  const fetchImpl = vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error("no more responses");
    if (next instanceof Error) throw next;
    return next;
  });
  const sleep = vi.fn(async () => undefined);
  let clock = 0;
  return { fetchImpl: fetchImpl as unknown as typeof fetch, fetchMock: fetchImpl, sleep, now: () => clock, advance: (ms: number) => (clock += ms), random: () => 0 };
}

describe("isRetriableDailyStatus", () => {
  it("retries no answer, 429 and 5xx, never another 4xx", () => {
    expect(isRetriableDailyStatus(null)).toBe(true);
    expect(isRetriableDailyStatus(429)).toBe(true);
    expect(isRetriableDailyStatus(500)).toBe(true);
    expect(isRetriableDailyStatus(503)).toBe(true);
    expect(isRetriableDailyStatus(400)).toBe(false);
    expect(isRetriableDailyStatus(401)).toBe(false);
    expect(isRetriableDailyStatus(404)).toBe(false);
  });
});

describe("retryAfterMs", () => {
  it("reads seconds and dates, caps them, ignores junk", () => {
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs("1")).toBe(1000);
    expect(retryAfterMs("120")).toBe(DAILY_MAX_RETRY_AFTER_MS);
    expect(retryAfterMs("soon")).toBeNull();
    expect(retryAfterMs(new Date(5_500).toUTCString(), 5_000)).toBeLessThanOrEqual(DAILY_MAX_RETRY_AFTER_MS);
  });
});

describe("dailyRequest", () => {
  it("returns the first successful answer without retrying", async () => {
    const d = deps([res(200)]);
    const r = await dailyRequest("https://api.daily.co/v1/x", { method: "POST" }, d);
    expect(r.status).toBe(200);
    expect(d.fetchMock).toHaveBeenCalledTimes(1);
    expect(d.sleep).not.toHaveBeenCalled();
  });

  it("retries a 429 and a network error, then succeeds", async () => {
    const d = deps([res(429, { "retry-after": "1" }), new Error("socket hang up"), res(200)]);
    const r = await dailyRequest("https://api.daily.co/v1/x", {}, d);
    expect(r.status).toBe(200);
    expect(d.fetchMock).toHaveBeenCalledTimes(3);
    // The 429's Retry-After (1s) outweighs the 300ms backoff.
    expect(d.sleep).toHaveBeenNthCalledWith(1, 1000);
  });

  it("gives up after DAILY_MAX_ATTEMPTS with the last status", async () => {
    const d = deps([res(503), res(502), res(500), res(200)]);
    await expect(dailyRequest("https://api.daily.co/v1/x", {}, d)).rejects.toMatchObject({ status: 500 });
    expect(d.fetchMock).toHaveBeenCalledTimes(DAILY_MAX_ATTEMPTS);
  });

  it("throws a real refusal at once, without retrying", async () => {
    const d = deps([res(400), res(200)]);
    const err = await dailyRequest("https://api.daily.co/v1/x", {}, d).catch((e) => e);
    expect(err).toBeInstanceOf(DailyApiError);
    expect(err.status).toBe(400);
    expect(d.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a status of null when no answer ever came", async () => {
    const d = deps([new Error("timeout"), new Error("timeout"), new Error("timeout")]);
    await expect(dailyRequest("https://api.daily.co/v1/x", {}, d)).rejects.toMatchObject({ status: null });
  });

  it("stops retrying once the time budget would be exceeded", async () => {
    const d = deps([res(500), res(200)]);
    // The first attempt alone took (almost) the whole budget.
    d.fetchMock.mockImplementationOnce(async () => {
      d.advance(9_900);
      return res(500);
    });
    await expect(dailyRequest("https://api.daily.co/v1/x", {}, d)).rejects.toMatchObject({ status: 500 });
    expect(d.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives every attempt its own timeout signal", async () => {
    const d = deps([res(200)]);
    await dailyRequest("https://api.daily.co/v1/x", { method: "GET" }, d);
    const init = (d.fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.method).toBe("GET");
  });
});
