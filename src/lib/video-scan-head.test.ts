import { describe, expect, it, vi } from "vitest";
import { headVideoForDiagnostics } from "@/lib/video-scan-head";

const BASE = "https://media.example.com";
const URL_ = `${BASE}/post-video/u1/v.mp4`;

describe("headVideoForDiagnostics", () => {
  it("does one HEAD and reads size and type, never the body", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, { status: 200, headers: { "content-length": "1234567", "content-type": "video/mp4" } }),
    );
    const result = await headVideoForDiagnostics(URL_, { publicBase: BASE, fetchImpl: fetchImpl as typeof fetch });
    expect(result).toEqual({ ok: true, status: 200, contentType: "video/mp4", contentLength: 1234567 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const calls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0][1].method).toBe("HEAD");
    expect(calls[0][1].redirect).toBe("manual");
  });

  it("skips any URL outside the public media base without a request", async () => {
    const fetchImpl = vi.fn();
    expect(
      await headVideoForDiagnostics("https://elsewhere.example/v.mp4", {
        publicBase: BASE,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).toEqual({ ok: false, reason: "skipped" });
    expect(await headVideoForDiagnostics(URL_, { publicBase: "", fetchImpl: fetchImpl as unknown as typeof fetch })).toEqual({
      ok: false,
      reason: "skipped",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports an HTTP error, a network error and a timeout without throwing", async () => {
    expect(
      await headVideoForDiagnostics(URL_, {
        publicBase: BASE,
        fetchImpl: (async () => new Response(null, { status: 404 })) as typeof fetch,
      }),
    ).toEqual({ ok: false, reason: "http", status: 404 });
    expect(
      await headVideoForDiagnostics(URL_, {
        publicBase: BASE,
        fetchImpl: (async () => {
          throw new Error("ECONNRESET");
        }) as typeof fetch,
      }),
    ).toEqual({ ok: false, reason: "error" });
    const hanging = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as typeof fetch;
    expect(await headVideoForDiagnostics(URL_, { publicBase: BASE, fetchImpl: hanging, timeoutMs: 10 })).toEqual({
      ok: false,
      reason: "timeout",
    });
  });

  it("leaves a missing or malformed content-length unknown", async () => {
    const result = await headVideoForDiagnostics(URL_, {
      publicBase: BASE,
      fetchImpl: (async () => new Response(null, { status: 200, headers: { "content-length": "abc" } })) as typeof fetch,
    });
    expect(result).toEqual({ ok: true, status: 200, contentType: null, contentLength: null });
  });
});
