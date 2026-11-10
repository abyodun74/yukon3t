import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/calls/native: CallKit's End reported by the iOS app's native side. It only translates to endCall, which
// keeps every guard of its own (session, membership, guarded ACCEPTED write).

class FakeAuthError extends Error {}
const endCall = vi.fn();

vi.mock("@/lib/auth-guards", () => ({ AuthError: FakeAuthError }));
vi.mock("@/app/actions/calls", () => ({ endCall: (...args: unknown[]) => endCall(...args) }));

const { POST } = await import("@/app/api/calls/native/route");

function post(body: unknown, header: string | null = "1") {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (header !== null) headers["x-yukon3t-native-call"] = header;
  return POST(
    new Request("https://yukon3t.com/api/calls/native", {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  endCall.mockReset();
  endCall.mockResolvedValue({ error: null });
});

describe("POST /api/calls/native", () => {
  it("hangs up through endCall, telling it CallKit already ended this iPhone's call", async () => {
    const res = await post({ action: "end", callId: "call1", voipToken: "tok" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ error: null });
    expect(endCall).toHaveBeenCalledWith("call1", { platform: "ios", voipToken: "tok", callKitEnded: true });
  });

  it("passes endCall's own refusal through", async () => {
    endCall.mockResolvedValue({ error: "not_found" });
    const res = await post({ action: "end", callId: "call1" });
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("answers 401 when the session is missing or revoked", async () => {
    endCall.mockRejectedValue(new FakeAuthError("signed out"));
    const res = await post({ action: "end", callId: "call1" });
    expect(res.status).toBe(401);
  });

  it("refuses a request without the native header or with a bad body, without touching the call", async () => {
    expect((await post({ action: "end", callId: "call1" }, null)).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect((await post({ action: "answer", callId: "call1" })).status).toBe(400);
    expect(endCall).not.toHaveBeenCalled();
  });
});
