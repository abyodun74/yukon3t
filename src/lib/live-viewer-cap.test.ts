import { describe, expect, it } from "vitest";
import {
  LIVE_ROOM_MAX_PARTICIPANTS,
  LIVE_VIEWER_FRESH_MS,
  MAX_LIVE_VIEWERS,
  PREVIEW_FULL_BACKOFF_MS,
  createPreviewFullGate,
  holdsViewerSlot,
  isStreamFull,
  isViewerCapExempt,
  otherViewingsWhere,
  previewJoinOutcome,
  viewerCapDecision,
} from "@/lib/live-viewer-cap";
import { ONLINE_WINDOW_MS } from "@/lib/presence";

const now = new Date("2026-11-12T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

describe("viewer cap rules", () => {
  it("uses the app's presence window and leaves Daily headroom above the cap", () => {
    expect(LIVE_VIEWER_FRESH_MS).toBe(ONLINE_WINDOW_MS);
    expect(LIVE_ROOM_MAX_PARTICIPANTS).toBeGreaterThan(MAX_LIVE_VIEWERS);
  });

  it("admits under the cap and refuses at it", () => {
    expect(viewerCapDecision({ exempt: false, alreadyHoldsSlot: false, othersHoldingSlots: MAX_LIVE_VIEWERS - 1 })).toBe(
      "admit",
    );
    expect(viewerCapDecision({ exempt: false, alreadyHoldsSlot: false, othersHoldingSlots: MAX_LIVE_VIEWERS })).toBe("full");
    expect(isStreamFull(MAX_LIVE_VIEWERS)).toBe(true);
    expect(isStreamFull(MAX_LIVE_VIEWERS - 1)).toBe(false);
  });

  it("always admits the exempt and anyone already holding a slot", () => {
    expect(viewerCapDecision({ exempt: true, alreadyHoldsSlot: false, othersHoldingSlots: 500 })).toBe("admit");
    expect(viewerCapDecision({ exempt: false, alreadyHoldsSlot: true, othersHoldingSlots: 500 })).toBe("admit");
  });

  it("exempts the host, co-hosts and admins only", () => {
    expect(isViewerCapExempt({ isHost: true, isAdmin: false, existingRole: null })).toBe(true);
    expect(isViewerCapExempt({ isHost: false, isAdmin: true, existingRole: null })).toBe(true);
    expect(isViewerCapExempt({ isHost: false, isAdmin: false, existingRole: "COHOST" })).toBe(true);
    expect(isViewerCapExempt({ isHost: false, isAdmin: false, existingRole: "GUEST" })).toBe(false);
    expect(isViewerCapExempt({ isHost: false, isAdmin: false, existingRole: "VIEWER" })).toBe(false);
  });

  it("a row holds a slot only while fresh, and a co-host row never does", () => {
    const stale = ago(LIVE_VIEWER_FRESH_MS + 1000);
    expect(holdsViewerSlot({ role: "VIEWER", joinedAt: ago(1000) }, null, now)).toBe(true);
    expect(holdsViewerSlot({ role: "VIEWER", joinedAt: stale }, ago(1000), now)).toBe(true);
    expect(holdsViewerSlot({ role: "VIEWER", joinedAt: stale }, stale, now)).toBe(false);
    expect(holdsViewerSlot({ role: "VIEWER", joinedAt: stale }, null, now)).toBe(false);
    expect(holdsViewerSlot({ role: "COHOST", joinedAt: ago(1000) }, ago(1000), now)).toBe(false);
    expect(holdsViewerSlot(null, ago(1000), now)).toBe(false);
  });

  it("other viewings never include a co-host seat or a stream the person hosts", () => {
    const where = otherViewingsWhere("u1", "streamB");
    expect(where.role.in).toEqual(["VIEWER", "GUEST"]);
    expect(where.liveStream).toEqual({ hostId: { not: "u1" } });
    expect(where.liveStreamId).toEqual({ not: "streamB" });
  });
});

describe("feed preview on a full stream", () => {
  it("maps join answers to play / full / skip", () => {
    expect(previewJoinOutcome({ error: "stream_full" })).toBe("full");
    expect(previewJoinOutcome({ error: "rate_limited" })).toBe("skip");
    expect(previewJoinOutcome({ error: null, roomUrl: "u", token: "t" })).toBe("play");
    expect(previewJoinOutcome({ error: null })).toBe("skip");
  });

  it("doesn't retry-loop: after stream_full it asks at most once per backoff, and never while listed full", () => {
    const gate = createPreviewFullGate();
    let t = 0;
    let joins = 0;
    // A card left on screen for ten minutes, re-evaluated every second, every answer full; counts keep saying "a
    // slot opened" (the worst case for a loop).
    gate.markFull("s1", t);
    for (t = 0; t <= 10 * 60_000; t += 1000) {
      if (gate.mayJoin("s1", false, t)) {
        joins += 1;
        gate.markFull("s1", t);
      }
    }
    expect(joins).toBe(Math.floor((10 * 60_000) / PREVIEW_FULL_BACKOFF_MS));
    expect(gate.mayJoin("s1", true, 10 ** 9)).toBe(false);
    expect(gate.mayJoin("other", false, 0)).toBe(true);
    expect(gate.retryAt("other")).toBeNull();
  });
});
