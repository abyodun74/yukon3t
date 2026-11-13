import { beforeEach, describe, expect, it, vi } from "vitest";

// loadProfileGifts (src/lib/gift-profile.ts), Phase A: the showcase shows only eligible pins (own, unrevoked, opened)
// in position order; a visitor gets the items and nothing else (no sender, no edition number, no owned-copy ids, no
// Thank You); the owner gets their pins, copies and Thank You state.

let sends: Record<string, unknown>[];
let pins: Record<string, unknown>[];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    giftItem: { findMany: async () => [] },
    giftSend: { findMany: async () => sends },
    ownedGift: { findMany: async () => [] },
    giftShowcasePin: { findMany: async () => pins },
  },
}));

import { loadProfileGifts } from "@/lib/gift-profile";

const OWNER = { id: "owner", isAdmin: true, isGuestPreview: false, equippedFrameItemId: null, equippedBadgeItemId: null };
const VISITOR = { id: "visitor", isAdmin: true, isGuestPreview: false };
const orchid = { slug: "gold-orchid", kind: "STICKER", assetKey: "gold-orchid", sortOrder: 250 };
const pin = (id: string, over: Record<string, unknown> = {}) => ({
  ownedGift: { id, ownerId: "owner", revokedAt: null, editionNumber: 7, send: { status: "OPENED" }, item: orchid, ...over },
});

beforeEach(() => {
  sends = [
    {
      id: "send1",
      status: "OPENED",
      senderId: "bob",
      thanksForSendId: null,
      thankedBy: null,
      sender: { name: "Bob" },
      owned: [{ id: "o1", editionNumber: 7, showcasePin: { id: "p1" }, item: { slug: "gold-orchid", assetKey: "gold-orchid" } }],
      purchase: { product: { sku: "sticker.gold-orchid", isBox: false, items: [{ item: orchid }] } },
    },
  ];
  pins = [pin("o1"), pin("o2", { revokedAt: new Date() }), pin("o3", { send: { status: "HIDDEN_BY_RECIPIENT" } }), pin("o4", { ownerId: "someone" })];
});

describe("the profile showcase", () => {
  it("shows a visitor only the eligible items: never the sender, an edition number or an owned-copy id", async () => {
    const view = await loadProfileGifts(OWNER, VISITOR, false);
    expect(view!.showcase).toEqual([{ slug: "gold-orchid", kind: "STICKER", assetKey: "gold-orchid" }]);
    const gift = view!.gifts[0];
    expect(gift).not.toHaveProperty("sender");
    expect(gift).not.toHaveProperty("owned");
    expect(gift).not.toHaveProperty("thankable");
    expect(JSON.stringify(view)).not.toMatch(/Bob|bob|editionNumber|"o1"/);
  });

  it("gives the owner their pins, copies (with edition numbers) and whether they can still say thank you", async () => {
    const view = await loadProfileGifts(OWNER, OWNER, false);
    expect(view!.showcase).toEqual([{ slug: "gold-orchid", kind: "STICKER", assetKey: "gold-orchid", ownedGiftId: "o1", editionNumber: 7 }]);
    expect(view!.gifts[0]).toMatchObject({
      sender: { name: "Bob" },
      thankable: true,
      owned: [{ id: "o1", slug: "gold-orchid", editionNumber: 7, pinned: true }],
    });
  });

  it("shows nothing across a block, or when gifts are off for either person", async () => {
    expect(await loadProfileGifts(OWNER, VISITOR, true)).toBeNull();
    expect(await loadProfileGifts({ ...OWNER, isAdmin: false }, VISITOR, false)).toBeNull();
  });
});
