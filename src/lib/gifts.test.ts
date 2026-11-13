import { describe, expect, it, vi } from "vitest";
import {
  GIFT_MESSAGE_MAX,
  LIVE_GIFT_QUEUE_MAX,
  canEquip,
  createGiftEffectQueue,
  expandProductItems,
  giftMessageRefusal,
  giftSendRefusal,
  giftVisibleOnProfile,
  giftsEnabledFor,
  giftsFromAllows,
  giftsHref,
  liveEffectFor,
  normalizeGiftMessage,
  type GiftParty,
  type GiftsFromValue,
} from "@/lib/gifts";

const NOW = new Date("2026-11-12T12:00:00Z");
const adultBirth = new Date("1990-05-01T00:00:00Z");
const minorBirth = new Date("2010-05-01T00:00:00Z"); // 16
const justEighteen = new Date("2008-11-12T00:00:00Z");

function party(over: Partial<GiftParty> = {}): GiftParty {
  return { id: "u1", status: "ACTIVE", isAdmin: true, isGuestPreview: false, birthDate: adultBirth, ...over };
}
function recipient(over: Partial<GiftParty> & { giftsFrom?: GiftsFromValue } = {}) {
  return { ...party({ id: "u2" }), giftsFrom: "CONNECTIONS" as GiftsFromValue, ...over };
}
const base = {
  sender: party(),
  recipient: recipient(),
  connected: true,
  blocked: false,
  context: "DIRECT" as const,
  now: NOW,
};

describe("giftsEnabledFor (the one feature gate)", () => {
  it("is on for site admins only in Phase 1", () => {
    expect(giftsEnabledFor({ isAdmin: true })).toBe(true);
    expect(giftsEnabledFor({ isAdmin: false })).toBe(false);
  });
  it("is never on for the guest identity, or nobody", () => {
    expect(giftsEnabledFor({ isAdmin: true, isGuestPreview: true })).toBe(false);
    expect(giftsEnabledFor(null)).toBe(false);
    expect(giftsEnabledFor(undefined)).toBe(false);
  });
});

describe("giftsFromAllows", () => {
  it("follows the recipient's choice", () => {
    expect(giftsFromAllows("EVERYONE", false)).toBe(true);
    expect(giftsFromAllows("CONNECTIONS", true)).toBe(true);
    expect(giftsFromAllows("CONNECTIONS", false)).toBe(false);
    expect(giftsFromAllows("NOBODY", true)).toBe(false);
  });
});

describe("gift note", () => {
  it("trims, and treats empty as no note", () => {
    expect(normalizeGiftMessage("  hi  ")).toBe("hi");
    expect(normalizeGiftMessage("   ")).toBeNull();
    expect(normalizeGiftMessage(null)).toBeNull();
    expect(normalizeGiftMessage(42)).toBeNull();
  });
  it("allows up to GIFT_MESSAGE_MAX characters, counted as people see them", () => {
    expect(giftMessageRefusal(null)).toBeNull();
    expect(giftMessageRefusal("a".repeat(GIFT_MESSAGE_MAX))).toBeNull();
    expect(giftMessageRefusal("a".repeat(GIFT_MESSAGE_MAX + 1))).toBe("too_long");
    // 140 emoji are 280 UTF-16 units but 140 characters.
    expect(giftMessageRefusal("🎁".repeat(GIFT_MESSAGE_MAX))).toBeNull();
  });
});

describe("giftSendRefusal", () => {
  it("allows an adult to send to an adult connection", () => {
    expect(giftSendRefusal(base)).toBeNull();
  });

  it("refuses when gifts aren't on for the sender, but not at delivery", () => {
    const sender = party({ isAdmin: false });
    expect(giftSendRefusal({ ...base, sender })).toBe("disabled");
    expect(giftSendRefusal({ ...base, sender, atDelivery: true })).toBeNull();
  });

  it("refuses a gift to yourself", () => {
    expect(giftSendRefusal({ ...base, recipient: recipient({ id: "u1" }) })).toBe("self");
  });

  it("refuses a recipient gifts aren't on for, or who isn't active, as plain unavailable (also at delivery)", () => {
    expect(giftSendRefusal({ ...base, recipient: recipient({ isAdmin: false }) })).toBe("unavailable");
    expect(giftSendRefusal({ ...base, recipient: recipient({ status: "SUSPENDED" }) })).toBe("unavailable");
    expect(giftSendRefusal({ ...base, recipient: recipient({ isAdmin: false }), atDelivery: true })).toBe("unavailable");
  });

  it("refuses across a block either way with the same answer as any unavailable recipient", () => {
    expect(giftSendRefusal({ ...base, blocked: true })).toBe("unavailable");
    expect(giftSendRefusal({ ...base, blocked: true, atDelivery: true })).toBe("unavailable");
  });

  it("only lets a known adult send", () => {
    expect(giftSendRefusal({ ...base, sender: party({ birthDate: null }) })).toBe("adult_only");
    expect(giftSendRefusal({ ...base, sender: party({ birthDate: minorBirth }) })).toBe("adult_only");
    expect(giftSendRefusal({ ...base, sender: party({ birthDate: justEighteen }) })).toBeNull();
  });

  it("lets an under-18 receive only from a connection, never in a live stream, whatever giftsFrom says", () => {
    const minor = recipient({ birthDate: minorBirth, giftsFrom: "EVERYONE" });
    expect(giftSendRefusal({ ...base, recipient: minor, connected: true })).toBeNull();
    expect(giftSendRefusal({ ...base, recipient: minor, connected: false })).toBe("not_accepting");
    expect(giftSendRefusal({ ...base, recipient: minor, connected: true, context: "LIVE" })).toBe("not_accepting");
    // An unknown birth date counts as under 18.
    const unknown = recipient({ birthDate: null, giftsFrom: "EVERYONE" });
    expect(giftSendRefusal({ ...base, recipient: unknown, connected: false })).toBe("not_accepting");
  });

  it("follows the recipient's giftsFrom", () => {
    expect(giftSendRefusal({ ...base, recipient: recipient({ giftsFrom: "NOBODY" }) })).toBe("not_accepting");
    expect(giftSendRefusal({ ...base, connected: false })).toBe("not_accepting");
    expect(giftSendRefusal({ ...base, connected: false, recipient: recipient({ giftsFrom: "EVERYONE" }) })).toBeNull();
    expect(
      giftSendRefusal({ ...base, connected: false, recipient: recipient({ giftsFrom: "EVERYONE" }), context: "LIVE" }),
    ).toBeNull();
  });
});

describe("expandProductItems", () => {
  it("gives one entry per item per copy (a box gives everything inside it)", () => {
    expect(expandProductItems([{ itemId: "wave", quantity: 1 }])).toEqual(["wave"]);
    expect(
      expandProductItems([
        { itemId: "heart", quantity: 1 },
        { itemId: "rose", quantity: 2 },
      ]),
    ).toEqual(["heart", "rose", "rose"]);
  });
  it("never gives less than one or more than ten of one item", () => {
    expect(expandProductItems([{ itemId: "x", quantity: 0 }])).toEqual(["x"]);
    expect(expandProductItems([{ itemId: "x", quantity: 500 }])).toHaveLength(10);
  });
});

describe("canEquip", () => {
  it("needs a frame or badge with an unrevoked copy", () => {
    expect(canEquip({ kind: "FRAME" }, [{ revokedAt: null }])).toBe(true);
    expect(canEquip({ kind: "BADGE" }, [{ revokedAt: new Date() }, { revokedAt: null }])).toBe(true);
    expect(canEquip({ kind: "BADGE" }, [{ revokedAt: new Date() }])).toBe(false);
    expect(canEquip({ kind: "FRAME" }, [])).toBe(false);
    expect(canEquip({ kind: "STICKER" }, [{ revokedAt: null }])).toBe(false);
    expect(canEquip(null, [{ revokedAt: null }])).toBe(false);
  });
});

describe("liveEffectFor / giftsHref / giftVisibleOnProfile", () => {
  it("plays a product's live effect, or the sparkle", () => {
    expect(liveEffectFor([{ kind: "FRAME", assetKey: "gold" }, { kind: "LIVE_EFFECT", assetKey: "confetti" }])).toBe("confetti");
    expect(liveEffectFor([{ kind: "STICKER", assetKey: "wave" }])).toBe("sparkle");
  });
  it("links a gift notification to the recipient's Gifts area", () => {
    expect(giftsHref("me")).toBe("/u/me#gifts");
  });
  it("shows the recipient delivered and opened gifts, visitors only opened ones, and nobody across a block", () => {
    expect(giftVisibleOnProfile({ status: "DELIVERED", viewerIsRecipient: true, blocked: false })).toBe(true);
    expect(giftVisibleOnProfile({ status: "OPENED", viewerIsRecipient: true, blocked: false })).toBe(true);
    expect(giftVisibleOnProfile({ status: "HIDDEN_BY_RECIPIENT", viewerIsRecipient: true, blocked: false })).toBe(false);
    expect(giftVisibleOnProfile({ status: "DELIVERED", viewerIsRecipient: false, blocked: false })).toBe(false);
    expect(giftVisibleOnProfile({ status: "OPENED", viewerIsRecipient: false, blocked: false })).toBe(true);
    expect(giftVisibleOnProfile({ status: "OPENED", viewerIsRecipient: false, blocked: true })).toBe(false);
    expect(giftVisibleOnProfile({ status: "REVOKED", viewerIsRecipient: false, blocked: false })).toBe(false);
  });
});

describe("createGiftEffectQueue (one live stream's gift effects)", () => {
  it("plays one effect at a time, in order, each id once", () => {
    const play = vi.fn();
    const queue = createGiftEffectQueue(play);
    queue.push([
      { id: "a", effect: "confetti" },
      { id: "b", effect: "sparkle" },
    ]);
    expect(play).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenLastCalledWith({ id: "a", effect: "confetti" });
    // A refetch returning the same ids again adds nothing.
    queue.push([
      { id: "a", effect: "confetti" },
      { id: "b", effect: "sparkle" },
    ]);
    expect(queue.size).toBe(1);
    queue.done();
    expect(play).toHaveBeenLastCalledWith({ id: "b", effect: "sparkle" });
    queue.done();
    expect(queue.playing).toBe(false);
    expect(play).toHaveBeenCalledTimes(2);
  });

  it("keeps at most LIVE_GIFT_QUEUE_MAX waiting and drops the rest of a burst", () => {
    const play = vi.fn();
    const queue = createGiftEffectQueue(play);
    queue.push(Array.from({ length: 20 }, (_, i) => ({ id: `g${i}`, effect: "sparkle" })));
    expect(play).toHaveBeenCalledTimes(1);
    // The first of the burst is playing; the next ones wait, up to the cap.
    expect(queue.size).toBe(LIVE_GIFT_QUEUE_MAX - 1);
    let played = 1;
    while (queue.playing) {
      queue.done();
      if (queue.playing) played++;
    }
    expect(played).toBe(LIVE_GIFT_QUEUE_MAX);
  });

  it("starts again after going idle, and clear empties it", () => {
    const play = vi.fn();
    const queue = createGiftEffectQueue(play);
    queue.push([{ id: "a", effect: "x" }]);
    queue.done();
    queue.push([{ id: "b", effect: "x" }]);
    expect(play).toHaveBeenCalledTimes(2);
    queue.push([{ id: "c", effect: "x" }]);
    queue.clear();
    expect(queue.size).toBe(0);
    expect(queue.playing).toBe(false);
  });
});
