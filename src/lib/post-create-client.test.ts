import { describe, expect, it } from "vitest";
import { submitCreatePost } from "@/lib/post-create-client";
import { UPLOAD_ROUTE_HEADER } from "@/lib/upload-route-guard";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function form() {
  const fd = new FormData();
  fd.set("clientRequestId", "req-12345678");
  fd.set("content", "hello");
  return fd;
}

describe("submitCreatePost", () => {
  it("posts the FormData to /api/posts with the guard header, not through a Server Action", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const answer = await submitCreatePost(form(), {
      fetchImpl: (async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return json(200, { error: null });
      }) as typeof fetch,
    });
    expect(answer).toEqual({ kind: "ok", held: false });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/posts");
    expect(calls[0].init?.method).toBe("POST");
    expect((calls[0].init?.headers as Record<string, string>)[UPLOAD_ROUTE_HEADER]).toBe("1");
  });

  it("retries an unknown outcome with the SAME clientRequestId, then stops on the server's answer", async () => {
    const seen: string[] = [];
    let n = 0;
    const answer = await submitCreatePost(form(), {
      sleep: async () => {},
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        seen.push(String((init?.body as FormData).get("clientRequestId")));
        n++;
        if (n === 1) throw new TypeError("Load failed");
        if (n === 2) return json(503, null);
        return json(200, { error: null });
      }) as typeof fetch,
    });
    expect(answer).toEqual({ kind: "ok", held: false });
    expect(seen).toEqual(["req-12345678", "req-12345678", "req-12345678"]);
  });

  it("never retries a server refusal", async () => {
    let n = 0;
    const answer = await submitCreatePost(form(), {
      sleep: async () => {},
      fetchImpl: (async () => {
        n++;
        return json(200, { error: "moderation" });
      }) as typeof fetch,
    });
    expect(answer).toMatchObject({ kind: "error", code: "moderation", outcome: "no_post" });
    expect(n).toBe(1);
  });

  it("times out a request that never answers and reports an unknown outcome", async () => {
    const answer = await submitCreatePost(form(), {
      tries: 2,
      timeoutMs: 15,
      sleep: async () => {},
      fetchImpl: ((_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        })) as typeof fetch,
    });
    expect(answer).toMatchObject({ kind: "error", code: "timeout", outcome: "unknown" });
  });

  it("stops at once when the attempt's own signal is aborted", async () => {
    const controller = new AbortController();
    let n = 0;
    const pending = submitCreatePost(form(), {
      signal: controller.signal,
      sleep: async () => {},
      fetchImpl: ((_url: string, init?: RequestInit) => {
        n++;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      }) as typeof fetch,
    });
    controller.abort();
    const answer = await pending;
    expect(answer).toMatchObject({ kind: "error", outcome: "unknown" });
    expect(n).toBe(1);
  });
});
