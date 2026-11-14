import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

class FakeAuthError extends Error {}
const createPost = vi.fn();
const requestUploadUrls = vi.fn();
vi.mock("@/app/actions/circles", () => ({ createPost: (fd: FormData) => createPost(fd) }));
vi.mock("@/app/actions/media", () => ({
  requestUploadUrls: (items: unknown, protocol: unknown) => requestUploadUrls(items, protocol),
}));
vi.mock("@/lib/auth-guards", () => ({ AuthError: FakeAuthError }));

const { POST: postsRoute } = await import("@/app/api/posts/route");
const { POST: presignRoute } = await import("@/app/api/uploads/presign/route");

const SAME_ORIGIN = { origin: "https://yukon3t.com", host: "yukon3t.com", "x-yk-upload": "1" };

beforeEach(() => {
  createPost.mockReset();
  requestUploadUrls.mockReset();
});

function postsRequest(headers: Record<string, string>) {
  const fd = new FormData();
  fd.set("content", "hello");
  fd.set("clientRequestId", "req-12345678");
  return new NextRequest("https://yukon3t.com/api/posts", { method: "POST", body: fd, headers });
}

describe("POST /api/posts", () => {
  it("passes the FormData to createPost and returns its answer", async () => {
    createPost.mockResolvedValue({ error: null, held: true });
    const res = await postsRoute(postsRequest(SAME_ORIGIN));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ error: null, held: true });
    const fd = createPost.mock.calls[0][0] as FormData;
    expect(fd.get("clientRequestId")).toBe("req-12345678");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("refuses a cross-site or header-less request before createPost runs", async () => {
    expect((await postsRoute(postsRequest({ ...SAME_ORIGIN, origin: "https://evil.example" }))).status).toBe(403);
    expect((await postsRoute(postsRequest({ origin: "https://yukon3t.com", host: "yukon3t.com" }))).status).toBe(403);
    expect(createPost).not.toHaveBeenCalled();
  });

  it("answers 401 when signed out and 500 (an unknown outcome the client retries with the same key) on a throw", async () => {
    createPost.mockRejectedValueOnce(new FakeAuthError("Sign in required."));
    expect((await postsRoute(postsRequest(SAME_ORIGIN))).status).toBe(401);
    vi.spyOn(console, "error").mockImplementation(() => {});
    createPost.mockRejectedValueOnce(new Error("db down"));
    const res = await postsRoute(postsRequest(SAME_ORIGIN));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "server_error" });
  });
});

describe("POST /api/uploads/presign", () => {
  const presignRequest = (body: string, headers: Record<string, string> = SAME_ORIGIN) =>
    new NextRequest("https://yukon3t.com/api/uploads/presign", {
      method: "POST",
      body,
      headers: { ...headers, "Content-Type": "application/json" },
    });

  it("passes items and protocol to requestUploadUrls and returns its answer", async () => {
    requestUploadUrls.mockResolvedValue({ error: null, items: [{ error: null, uploadUrl: "u", publicUrl: "p", key: "k", headers: {} }] });
    const items = [{ kind: "post-image", contentType: "image/webp" }];
    const res = await presignRoute(presignRequest(JSON.stringify({ items, protocol: "write-once-1" })));
    expect(res.status).toBe(200);
    expect(requestUploadUrls).toHaveBeenCalledWith(items, "write-once-1");
    expect((await res.json()).items).toHaveLength(1);
  });

  it("refuses without the guard and on a malformed body", async () => {
    expect((await presignRoute(presignRequest("{}", { origin: "https://yukon3t.com", host: "yukon3t.com" }))).status).toBe(403);
    expect((await presignRoute(presignRequest("not json"))).status).toBe(400);
    expect(requestUploadUrls).not.toHaveBeenCalled();
  });

  it("answers 401 when signed out", async () => {
    requestUploadUrls.mockRejectedValueOnce(new FakeAuthError("Sign in required."));
    expect((await presignRoute(presignRequest(JSON.stringify({ items: [] })))).status).toBe(401);
  });
});
