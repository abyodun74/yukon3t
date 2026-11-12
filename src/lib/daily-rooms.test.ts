import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLiveStreamRoom, createMeetingToken } from "@/lib/daily";

// createLiveStreamRoom / createMeetingToken over a stubbed fetch: a busy Daily API (429/5xx) is retried rather than
// failing a start or silently dropping recording, and a retried room create that already landed is recovered.

type Call = { url: string; method: string; body: Record<string, unknown> | null };
let calls: Call[] = [];
let answers: Array<(call: Call) => Response> = [];

function json(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  calls = [];
  answers = [];
  vi.stubEnv("DAILY_API_KEY", "test-key");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const call = { url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : null };
      calls.push(call);
      const answer = answers.shift();
      if (!answer) throw new Error("unexpected request");
      return answer(call);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const room = { name: "live-x", url: "https://d.daily.co/live-x" };

describe("createLiveStreamRoom", () => {
  it("retries a 429 and keeps cloud recording (no silent fallback)", async () => {
    answers = [() => json(429), () => json(200, room)];
    await expect(createLiveStreamRoom({ name: "live-x" })).resolves.toEqual(room);
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => (c.body?.properties as Record<string, unknown>).enable_recording === "cloud")).toBe(true);
  });

  it("falls back to a room without recording only when Daily refuses recording", async () => {
    answers = [() => json(400, { error: "invalid-request-error" }), () => json(404), () => json(200, room)];
    await expect(createLiveStreamRoom({ name: "live-x" })).resolves.toEqual(room);
    expect(calls.map((c) => c.method)).toEqual(["POST", "GET", "POST"]);
    expect((calls[2].body?.properties as Record<string, unknown>).enable_recording).toBeUndefined();
  });

  it("recovers a room an earlier, timed-out attempt actually created", async () => {
    answers = [
      () => {
        throw new Error("timeout");
      },
      () => json(400, { info: "a room named live-x already exists" }),
      () => json(200, room),
    ];
    await expect(createLiveStreamRoom({ name: "live-x" })).resolves.toEqual(room);
    expect(calls.map((c) => c.method)).toEqual(["POST", "POST", "GET"]);
  });

  it("fails (for the caller to clean up) when Daily stays down, without a no-recording retry", async () => {
    answers = [() => json(503), () => json(503), () => json(503)];
    await expect(createLiveStreamRoom({ name: "live-x" })).rejects.toMatchObject({ status: 503 });
    expect(calls).toHaveLength(3);
  });
});

describe("createMeetingToken", () => {
  it("retries a 5xx", async () => {
    answers = [() => json(502), () => json(200, { token: "t" })];
    await expect(createMeetingToken({ roomName: "live-x", userId: "u", userName: "U", isOwner: false })).resolves.toBe("t");
  });
});
