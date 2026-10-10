import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PUBLISH_EVENTS_CHUNK_SIZE, publishEvents } from "./realtime-server";

const fetchMock = vi.fn();

function events(count: number) {
  return Array.from({ length: count }, (_, i) => ({ channel: `nav-badges:u${i}`, event: "changed" }));
}

function sentMessages(call: number) {
  return JSON.parse(fetchMock.mock.calls[call][1].body).messages;
}

describe("publishEvents", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SECRET_KEY", "secret");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("sends every event in one request, in the endpoint's own message shape", async () => {
    await publishEvents([
      { channel: "nav-badges:u1", event: "changed" },
      { channel: "conversation:c1", event: "changed", payload: { a: 1 } },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://example.supabase.co/realtime/v1/api/broadcast");
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(sentMessages(0)).toEqual([
      { topic: "nav-badges:u1", event: "changed", payload: {} },
      { topic: "conversation:c1", event: "changed", payload: { a: 1 } },
    ]);
  });

  it("chunks a large list without dropping or duplicating an event", async () => {
    const total = PUBLISH_EVENTS_CHUNK_SIZE * 2 + 1;
    await publishEvents(events(total));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const sizes = fetchMock.mock.calls.map((_, i) => sentMessages(i).length);
    expect(sizes).toEqual([PUBLISH_EVENTS_CHUNK_SIZE, PUBLISH_EVENTS_CHUNK_SIZE, 1]);
    const topics = fetchMock.mock.calls.flatMap((_, i) => sentMessages(i).map((m: { topic: string }) => m.topic));
    expect(new Set(topics).size).toBe(total);
  });

  it("does nothing for an empty list or when Supabase isn't configured", async () => {
    await publishEvents([]);
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    await publishEvents(events(3));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never throws, and a failed chunk doesn't stop the others", async () => {
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "boom" });

    await expect(publishEvents(events(PUBLISH_EVENTS_CHUNK_SIZE + 1))).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
