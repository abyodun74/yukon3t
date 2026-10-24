import { describe, expect, it } from "vitest";
import {
  SHARE_MAX_RECIPIENTS,
  shareTargetRefusal,
  shareToChatsResult,
  toggleShareSelection,
  uniqueShareTargets,
  type ShareTargetRow,
} from "@/lib/share-to-chats";
import { shareToChatsSchema } from "@/lib/validations";

const ME = "me";
const PEER = "peer";

function member(userId: string, over: { e2ee?: boolean; status?: string; hidden?: boolean } = {}) {
  return {
    userId,
    e2eeEnabledAt: over.e2ee ? new Date() : null,
    hiddenAt: over.hidden ? new Date() : null,
    user: { status: over.status ?? "ACTIVE" },
  };
}

function dm(over: { e2ee?: boolean; peerStatus?: string } = {}): ShareTargetRow {
  return {
    id: "c1",
    isGroup: false,
    members: [member(ME, { e2ee: over.e2ee }), member(PEER, { e2ee: over.e2ee, status: over.peerStatus })],
  };
}

const none = new Set<string>();

describe("SHARE_MAX_RECIPIENTS", () => {
  it("is 5, the same cap as forwarding", () => {
    expect(SHARE_MAX_RECIPIENTS).toBe(5);
  });
});

describe("shareToChatsSchema", () => {
  const id = (n: number) => `cdst000000000${n}`;
  it("takes 1 to 5 ids", () => {
    expect(shareToChatsSchema.safeParse([id(1)]).success).toBe(true);
    expect(shareToChatsSchema.safeParse([1, 2, 3, 4, 5].map(id)).success).toBe(true);
  });
  it("refuses none, more than 5, and non-ids", () => {
    expect(shareToChatsSchema.safeParse([]).success).toBe(false);
    expect(shareToChatsSchema.safeParse([1, 2, 3, 4, 5, 6].map(id)).success).toBe(false);
    expect(shareToChatsSchema.safeParse(["not an id!"]).success).toBe(false);
    expect(shareToChatsSchema.safeParse("c1").success).toBe(false);
  });
});

describe("uniqueShareTargets", () => {
  it("drops repeats and keeps the picking order", () => {
    expect(uniqueShareTargets(["b", "a", "b", "c", "a"])).toEqual(["b", "a", "c"]);
  });
});

describe("shareTargetRefusal", () => {
  it("accepts a 1:1 with an active, unblocked friend", () => {
    expect(shareTargetRefusal(dm(), ME, none, { allowSecret: false })).toBeNull();
  });

  it("refuses a chat that doesn't exist or that the caller isn't in", () => {
    expect(shareTargetRefusal(undefined, ME, none, { allowSecret: true })).toBe("unavailable");
    expect(shareTargetRefusal(dm(), "someone-else", none, { allowSecret: true })).toBe("unavailable");
  });

  it("refuses a 1:1 blocked either way, or with an inactive account", () => {
    expect(shareTargetRefusal(dm(), ME, new Set([PEER]), { allowSecret: true })).toBe("unavailable");
    expect(shareTargetRefusal(dm({ peerStatus: "SUSPENDED" }), ME, none, { allowSecret: true })).toBe("unavailable");
  });

  it("refuses a secret chat unless the share carries no text", () => {
    expect(shareTargetRefusal(dm({ e2ee: true }), ME, none, { allowSecret: false })).toBe("unavailable");
    expect(shareTargetRefusal(dm({ e2ee: true }), ME, none, { allowSecret: true })).toBeNull();
  });

  it("refuses a 1:1 with nobody else left in it", () => {
    expect(shareTargetRefusal({ id: "c1", isGroup: false, members: [member(ME)] }, ME, none, { allowSecret: true })).toBe(
      "unavailable",
    );
  });

  it("accepts a group the caller is in, whoever else is in it", () => {
    const group: ShareTargetRow = { id: "g", isGroup: true, members: [member(ME), member(PEER, { status: "BANNED" })] };
    expect(shareTargetRefusal(group, ME, new Set([PEER]), { allowSecret: false })).toBeNull();
  });
});

describe("shareToChatsResult", () => {
  it("answers counts when anything was sent, partial success included", () => {
    expect(shareToChatsResult({ sent: 2, failed: 0, rateLimited: false })).toEqual({ error: null, sent: 2, failed: 0 });
    expect(shareToChatsResult({ sent: 1, failed: 3, rateLimited: true })).toEqual({ error: null, sent: 1, failed: 3 });
  });
  it("answers one generic error when nothing was sent", () => {
    expect(shareToChatsResult({ sent: 0, failed: 2, rateLimited: false })).toEqual({ error: "unavailable" });
    expect(shareToChatsResult({ sent: 0, failed: 2, rateLimited: true })).toEqual({ error: "rate_limited" });
  });
});

describe("toggleShareSelection", () => {
  it("adds in order and removes on a second tap", () => {
    let s = toggleShareSelection([], "a");
    s = toggleShareSelection(s, "b");
    expect(s).toEqual(["a", "b"]);
    expect(toggleShareSelection(s, "a")).toEqual(["b"]);
  });
  it("adds nothing once the cap is reached, but still removes", () => {
    const full = ["a", "b", "c", "d", "e"];
    expect(toggleShareSelection(full, "f")).toEqual(full);
    expect(toggleShareSelection(full, "c")).toEqual(["a", "b", "d", "e"]);
    expect(toggleShareSelection(["a"], "b", 1)).toEqual(["a"]);
  });
  it("doesn't change the array it was given", () => {
    const before = ["a"];
    toggleShareSelection(before, "b");
    expect(before).toEqual(["a"]);
  });
});
