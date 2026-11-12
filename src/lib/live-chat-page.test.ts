import { describe, expect, it } from "vitest";
import { LIVE_CHAT_FIRST_PAGE, LIVE_CHAT_PAGE_MAX, liveChatPageQuery } from "@/lib/live-chat-page";

// getLiveStreamComments used to drop its 30-comment cap as soon as any afterId was passed, so one request could pull
// a stream's whole chat. Every answer is bounded now.

describe("liveChatPageQuery", () => {
  it("takes the latest comments, newest first, without a cursor", () => {
    const { args, newestFirst } = liveChatPageQuery("ls1", null);
    expect(newestFirst).toBe(true);
    expect(args.take).toBe(LIVE_CHAT_FIRST_PAGE);
    expect(args.where).toEqual({ liveStreamId: "ls1" });
    expect(args.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
  });

  it("is capped after a cursor too, scoped to the stream and ordered with an id tie-break", () => {
    const createdAt = new Date("2026-11-12T10:00:00Z");
    const { args, newestFirst } = liveChatPageQuery("ls1", { createdAt, id: "c5" });
    expect(newestFirst).toBe(false);
    expect(args.take).toBe(LIVE_CHAT_PAGE_MAX);
    expect(args.where).toEqual({
      liveStreamId: "ls1",
      OR: [{ createdAt: { gt: createdAt } }, { createdAt, id: { gt: "c5" } }],
    });
    expect(args.orderBy).toEqual([{ createdAt: "asc" }, { id: "asc" }]);
  });

  it("keeps both caps small", () => {
    expect(LIVE_CHAT_FIRST_PAGE).toBeLessThanOrEqual(LIVE_CHAT_PAGE_MAX);
    expect(LIVE_CHAT_PAGE_MAX).toBeLessThanOrEqual(100);
  });
});
