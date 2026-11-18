import { describe, expect, it } from "vitest";
import {
  DAILY_ACTIVE_SENDERS_WITHOUT_SUPPORT,
  FULL_QUALITY_MAX_ON_STAGE,
  inviteSendDecision,
  LIVE_INVITE_MAX_PER_REQUEST,
  LIVE_INVITE_MAX_SENDS,
  LIVE_INVITE_TTL_MS,
  liveInviteeUserWhere,
  liveInviteStatus,
  liveStageLockKey,
  MAX_LIVE_STAGE,
  parseInviteeIds,
  STAGE_FITS_ROOM_HEADROOM,
  stageGrid,
  stageQuality,
  stageSeatDecision,
} from "@/lib/live-stage";
import { LIVE_ROOM_MAX_PARTICIPANTS, MAX_LIVE_VIEWERS } from "@/lib/live-viewer-cap";

const now = new Date("2026-11-17T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

describe("stage cap", () => {
  it("is ten, and the host plus a full stage stays within Daily's documented active-sender guidance", () => {
    expect(MAX_LIVE_STAGE).toBe(10);
    expect(MAX_LIVE_STAGE + 1).toBeLessThanOrEqual(DAILY_ACTIVE_SENDERS_WITHOUT_SUPPORT);
  });

  it("fits inside the room's max_participants headroom over the viewer cap", () => {
    expect(STAGE_FITS_ROOM_HEADROOM).toBe(true);
    expect(MAX_LIVE_VIEWERS + MAX_LIVE_STAGE + 1).toBeLessThanOrEqual(LIVE_ROOM_MAX_PARTICIPANTS);
  });

  it("admits under the cap, refuses at it, and never refuses someone already on stage", () => {
    expect(stageSeatDecision({ alreadyOnStage: false, othersOnStage: 0 })).toBe("admit");
    expect(stageSeatDecision({ alreadyOnStage: false, othersOnStage: MAX_LIVE_STAGE - 1 })).toBe("admit");
    expect(stageSeatDecision({ alreadyOnStage: false, othersOnStage: MAX_LIVE_STAGE })).toBe("full");
    expect(stageSeatDecision({ alreadyOnStage: true, othersOnStage: MAX_LIVE_STAGE })).toBe("admit");
  });

  it("locks per stream", () => {
    expect(liveStageLockKey("a")).toBe("live-stage:a");
    expect(liveStageLockKey("a")).not.toBe(liveStageLockKey("b"));
  });
});

describe("invite status and re-invites", () => {
  it("reads a pending invite as expired past its TTL or once the stream is over", () => {
    expect(liveInviteStatus({ status: "PENDING", createdAt: ago(1000) }, true, now)).toBe("PENDING");
    expect(liveInviteStatus({ status: "PENDING", createdAt: ago(LIVE_INVITE_TTL_MS) }, true, now)).toBe("EXPIRED");
    expect(liveInviteStatus({ status: "PENDING", createdAt: ago(1000) }, false, now)).toBe("EXPIRED");
    expect(liveInviteStatus({ status: "DECLINED", createdAt: ago(1000) }, true, now)).toBe("DECLINED");
  });

  it("creates, no-ops an open or accepted invite, refuses after a decline, and caps re-sends", () => {
    expect(inviteSendDecision(null, now)).toBe("create");
    expect(inviteSendDecision({ status: "PENDING", createdAt: ago(1000), sendCount: 1 }, now)).toBe("noop");
    expect(inviteSendDecision({ status: "ACCEPTED", createdAt: ago(1000), sendCount: 1 }, now)).toBe("noop");
    expect(inviteSendDecision({ status: "DECLINED", createdAt: ago(1000), sendCount: 1 }, now)).toBe("declined");
    expect(inviteSendDecision({ status: "CANCELLED", createdAt: ago(1000), sendCount: 1 }, now)).toBe("resend");
    expect(
      inviteSendDecision({ status: "PENDING", createdAt: ago(LIVE_INVITE_TTL_MS + 1), sendCount: 1 }, now),
    ).toBe("resend");
    expect(
      inviteSendDecision({ status: "EXPIRED", createdAt: ago(1000), sendCount: LIVE_INVITE_MAX_SENDS }, now),
    ).toBe("too_many");
  });
});

describe("parseInviteeIds (the multi-select's ids)", () => {
  it("de-duplicates, trims and drops the inviter", () => {
    expect(parseInviteeIds([" a1 ", "b2", "a1", "me"], "me")).toEqual(["a1", "b2"]);
    expect(parseInviteeIds([], "me")).toEqual([]);
  });

  it("refuses anything that isn't a short list of ids", () => {
    expect(parseInviteeIds("a1", "me")).toBeNull();
    expect(parseInviteeIds([1], "me")).toBeNull();
    expect(parseInviteeIds(["a b"], "me")).toBeNull();
    expect(parseInviteeIds(["x".repeat(65)], "me")).toBeNull();
    const many = Array.from({ length: LIVE_INVITE_MAX_PER_REQUEST + 1 }, (_, i) => `id${i}`);
    expect(parseInviteeIds(many, "me")).toBeNull();
    expect(parseInviteeIds(many.slice(1), "me")).toHaveLength(LIVE_INVITE_MAX_PER_REQUEST);
  });
});

describe("liveInviteeUserWhere (who the picker may reach)", () => {
  it("never the inviter or anyone excluded, only active verified named members, connected or discoverable", () => {
    const where = liveInviteeUserWhere("me", new Set(["blocked1", "host"]));
    expect(where.id.notIn).toEqual(["me", "blocked1", "host"]);
    expect(where).toMatchObject({ status: "ACTIVE", name: { not: null }, isGuestPreview: false });
    expect(where.NOT).toEqual({ emailVerified: null, phoneVerifiedAt: null });
    expect(where.OR).toEqual([
      { discoverable: true, isAdmin: false },
      { sentConnections: { some: { targetId: "me", status: "ACCEPTED" } } },
      { receivedConnections: { some: { requesterId: "me", status: "ACCEPTED" } } },
    ]);
  });
});

describe("stageQuality (auto-lowering as the stage grows)", () => {
  it("is full quality up to four on stage", () => {
    for (let n = 0; n <= FULL_QUALITY_MAX_ON_STAGE; n++) {
      expect(stageQuality(n)).toEqual({ tier: "full", sendMaxQuality: "high", receiveLayer: 2 });
    }
  });

  it("steps down past four, and to the lowest layer for a nearly full stage", () => {
    expect(stageQuality(5)).toEqual({ tier: "reduced", sendMaxQuality: "medium", receiveLayer: 1 });
    expect(stageQuality(7)).toMatchObject({ tier: "reduced" });
    expect(stageQuality(8)).toEqual({ tier: "minimal", sendMaxQuality: "low", receiveLayer: 0 });
    expect(stageQuality(MAX_LIVE_STAGE)).toMatchObject({ tier: "minimal" });
  });

  it("never raises quality as the stage grows", () => {
    const rank = { full: 2, reduced: 1, minimal: 0 } as const;
    for (let n = 1; n <= MAX_LIVE_STAGE; n++) {
      expect(rank[stageQuality(n).tier]).toBeLessThanOrEqual(rank[stageQuality(n - 1).tier]);
    }
  });
});

describe("stageGrid", () => {
  it("fits every tile count up to a full stage plus host on one screen, both orientations", () => {
    for (let tiles = 1; tiles <= MAX_LIVE_STAGE + 1; tiles++) {
      for (const landscape of [false, true]) {
        const { columns, rows } = stageGrid(tiles, landscape);
        expect(columns * rows).toBeGreaterThanOrEqual(tiles);
        // No empty row at the end.
        expect(columns * (rows - 1)).toBeLessThan(tiles);
        expect(columns).toBeLessThanOrEqual(landscape ? 4 : 3);
        expect(rows).toBeLessThanOrEqual(4);
      }
    }
  });

  it("stacks two on a portrait phone and puts them side by side in landscape", () => {
    expect(stageGrid(1, false)).toEqual({ columns: 1, rows: 1 });
    expect(stageGrid(2, false)).toEqual({ columns: 1, rows: 2 });
    expect(stageGrid(2, true)).toEqual({ columns: 2, rows: 1 });
    expect(stageGrid(11, false)).toEqual({ columns: 3, rows: 4 });
    expect(stageGrid(11, true)).toEqual({ columns: 4, rows: 3 });
  });
});

describe("liveInviteGone and the invite URL", () => {
  it("explains a settled invite, an ended live winning over expiry", async () => {
    const { liveInviteGone, liveInviteHref } = await import("@/lib/live-stage");
    expect(liveInviteGone("CANCELLED", true)).toBe("cancelled");
    expect(liveInviteGone("ACCEPTED", true)).toBe("answered");
    expect(liveInviteGone("DECLINED", false)).toBe("answered");
    expect(liveInviteGone("EXPIRED", true)).toBe("expired");
    expect(liveInviteGone("EXPIRED", false)).toBe("ended");
    expect(liveInviteHref("s1")).toBe("/live/s1?invite=1");
  });
});
