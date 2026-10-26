import { describe, it, expect, vi } from "vitest";
import { FetchTimeoutError, backoffDelayMs, fetchWithRetry, isRetryableStatus } from "./fetch-retry";

const noSleep = () => Promise.resolve();

describe("backoffDelayMs", () => {
  it("doubles per attempt, capped, scaled by 50-100% jitter", () => {
    expect(backoffDelayMs(1, { baseMs: 500, random: () => 1 })).toBe(500);
    expect(backoffDelayMs(2, { baseMs: 500, random: () => 1 })).toBe(1_000);
    expect(backoffDelayMs(3, { baseMs: 500, random: () => 1 })).toBe(2_000);
    expect(backoffDelayMs(10, { baseMs: 500, maxMs: 8_000, random: () => 1 })).toBe(8_000);
    expect(backoffDelayMs(2, { baseMs: 500, random: () => 0 })).toBe(500);
  });
});

describe("isRetryableStatus", () => {
  it("retries throttling and server errors, not client errors", () => {
    for (const status of [408, 425, 429, 500, 502, 503, 504]) expect(isRetryableStatus(status), String(status)).toBe(true);
    for (const status of [200, 304, 400, 401, 403, 404]) expect(isRetryableStatus(status), String(status)).toBe(false);
  });
});

describe("fetchWithRetry", () => {
  it("returns the first good response without retrying", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok"));
    const res = await fetchWithRetry("/api/x", {}, { fetchImpl, sleep: noSleep });
    expect(await res.text()).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a network error and a 503, then succeeds", async () => {
    const onRetry = vi.fn();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok"));
    const res = await fetchWithRetry("/api/x", {}, { fetchImpl, sleep: noSleep, onRetry, attempts: 3 });
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(onRetry.mock.calls.map((c) => c[0])).toEqual([2, 3]);
  });

  it("returns the last retryable response once attempts run out", async () => {
    const fetchImpl = vi.fn(async () => new Response("busy", { status: 503 }));
    const res = await fetchWithRetry("/api/x", {}, { fetchImpl, sleep: noSleep, attempts: 2 });
    expect(res.status).toBe(503);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 404", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 404 }));
    const res = await fetchWithRetry("/api/x", {}, { fetchImpl, sleep: noSleep });
    expect(res.status).toBe(404);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("never retries a non-idempotent request", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(fetchWithRetry("/api/x", { method: "POST" }, { fetchImpl, sleep: noSleep, attempts: 5 })).rejects.toThrow(
      "Failed to fetch",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("aborts a hung attempt at the timeout and reports it as a timeout", async () => {
    const onSample = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    );
    await expect(
      fetchWithRetry("/api/x", {}, { fetchImpl, sleep: noSleep, attempts: 2, timeoutMs: 5, onSample }),
    ).rejects.toBeInstanceOf(FetchTimeoutError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(onSample).toHaveBeenCalledWith(5);
  });

  it("stops at once when the caller aborts", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      controller.abort();
      throw new DOMException("Aborted", "AbortError");
    });
    await expect(
      fetchWithRetry("/api/x", {}, { fetchImpl, sleep: noSleep, attempts: 3, signal: controller.signal }),
    ).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("waits until ready before each retry", async () => {
    const order: string[] = [];
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () => {
        order.push("fetch1");
        throw new TypeError("offline");
      })
      .mockImplementationOnce(async () => {
        order.push("fetch2");
        return new Response("ok");
      });
    await fetchWithRetry("/api/x", {}, {
      fetchImpl,
      sleep: noSleep,
      waitUntilReady: async () => {
        order.push("ready");
      },
    });
    expect(order).toEqual(["fetch1", "ready", "fetch2"]);
  });
});
