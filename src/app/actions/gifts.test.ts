import { beforeEach, describe, expect, it, vi } from "vitest";

// app/actions/gifts.ts against a mocked database: the gate refuses non-admins in every action, every rule is checked
// (and the note moderated) before anything is written, the limiters are wired, opening is idempotent and equipping
// needs ownership.

const ME = "cme00000000001";
const BOB = "cbob0000000001";
const CHAT = "cchat000000001";
const STREAM = "cstream0000001";
const SEND = "csend000000001";

const adult = new Date("1990-01-01T00:00:00Z");
let user: Record<string, unknown>;
let recipient: Record<string, unknown> | null;
let product: { id: string; currency: string } | null;
let conversation: { isGroup: boolean; members: { userId: string; e2eeEnabledAt: Date | null; hiddenAt: Date | null }[] } | null;
let stream: Record<string, unknown> | null;
let viewing: { role: string; joinedAt: Date } | null;
let connected: boolean;
let blocked: boolean;
let send: Record<string, unknown> | null;
let item: { id: string; kind: string } | null;
let ownedRows: { revokedAt: Date | null }[];
const limits: Record<string, boolean> = {};

const checkRateLimit = vi.fn(async (...args: [name: string, id: string]) => limits[args[0]] ?? true);
const moderateText = vi.fn();
const deliverGiftPurchase = vi.fn();
const purchaseCreate = vi.fn();
const sendUpdateMany = vi.fn();
const userUpdate = vi.fn();
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));
vi.mock("@/lib/auth-guards", () => ({
  requireVerifiedUser: async () => user,
  requireUser: async () => user,
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (name: string, id: string) => checkRateLimit(name, id) }));
vi.mock("@/lib/moderation", () => ({ moderateText: (t: string) => moderateText(t) }));
vi.mock("@/lib/blocks", () => ({ isBlockedEitherWay: async () => blocked }));
vi.mock("@/lib/hidden-chats", () => ({ isMembershipLocked: async (m: { hiddenAt: Date | null }) => m.hiddenAt !== null }));
vi.mock("@/lib/live-stream-access", () => ({ canAccessLiveStream: async () => true }));
vi.mock("@/lib/gift-delivery", () => ({ deliverGiftPurchase: (id: string) => deliverGiftPurchase(id) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: async () => recipient,
      update: (...a: unknown[]) => userUpdate(...a),
    },
    giftProduct: { findFirst: async () => product, findMany: async () => [] },
    conversation: { findUnique: async () => conversation },
    liveStream: { findUnique: async () => stream },
    liveStreamViewer: { findUnique: async () => viewing },
    connection: { findFirst: async () => (connected ? { id: "conn" } : null) },
    giftPurchase: { create: (...a: unknown[]) => purchaseCreate(...a) },
    giftSend: {
      findFirst: async () => send,
      findUnique: async () => send,
      findMany: async () => [],
      updateMany: (...a: unknown[]) => sendUpdateMany(...a),
    },
    giftItem: { findUnique: async () => item },
    // openGift asks for a send's numbered copies (none here); equipGift for the user's copies of an item.
    ownedGift: { findMany: async (args?: { where?: { sendId?: string } }) => (args?.where?.sendId ? [] : ownedRows) },
    conversationMember: { findUnique: async () => ({ hiddenAt: null }) },
  },
}));

import {
  createGiftIntent,
  equipGift,
  getGiftCatalog,
  getGiftChatCard,
  getLiveGiftEffects,
  hideGift,
  openGift,
  unequipGift,
  updateGiftsFrom,
} from "@/app/actions/gifts";

const giftView = (status: string) => ({
  id: SEND,
  status,
  message: "Enjoy",
  recipientId: ME,
  senderId: BOB,
  conversationId: CHAT,
  sender: { name: "Bob" },
  purchase: {
    product: {
      sku: "box.say-hi",
      isBox: true,
      items: [
        { item: { slug: "wave", kind: "STICKER", assetKey: "wave", sortOrder: 10 } },
        { item: { slug: "coffee", kind: "STICKER", assetKey: "coffee", sortOrder: 40 } },
      ],
    },
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(limits)) delete limits[k];
  user = { id: ME, name: "Me", isAdmin: true, isGuestPreview: false, status: "ACTIVE", birthDate: adult, lastSeenAt: new Date() };
  recipient = { id: BOB, status: "ACTIVE", isAdmin: true, isGuestPreview: false, birthDate: adult, giftsFrom: "CONNECTIONS" };
  product = { id: "gift_product_sticker.wave", currency: "USD" };
  conversation = {
    isGroup: false,
    members: [
      { userId: ME, e2eeEnabledAt: null, hiddenAt: null },
      { userId: BOB, e2eeEnabledAt: null, hiddenAt: null },
    ],
  };
  stream = { id: STREAM, status: "LIVE", hostId: BOB, circleId: null, targetUserId: null };
  viewing = { role: "VIEWER", joinedAt: new Date() };
  connected = true;
  blocked = false;
  send = giftView("DELIVERED");
  item = { id: "gift_item_aurora-frame", kind: "FRAME" };
  ownedRows = [{ revokedAt: null }];
  moderateText.mockResolvedValue({ allowed: true, flaggedCategories: [] });
  purchaseCreate.mockResolvedValue({ id: "purchase1", send: { id: SEND } });
  deliverGiftPurchase.mockResolvedValue("delivered");
  sendUpdateMany.mockResolvedValue({ count: 1 });
  userUpdate.mockResolvedValue({ id: ME });
});

describe("the gate (giftsEnabledFor): non-admins get nothing from any action", () => {
  beforeEach(() => {
    user = { ...user, isAdmin: false };
  });
  it("refuses every gift action", async () => {
    expect(await getGiftCatalog(BOB)).toEqual({ error: "disabled" });
    expect(await createGiftIntent("sticker.wave", BOB, null)).toEqual({ error: "disabled" });
    expect(await openGift(SEND)).toEqual({ error: "disabled" });
    expect(await hideGift(SEND)).toEqual({ error: "disabled" });
    expect(await equipGift("aurora-frame")).toEqual({ error: "disabled" });
    expect(await unequipGift("FRAME")).toEqual({ error: "disabled" });
    expect(await getGiftChatCard(SEND)).toEqual({ error: "disabled" });
    expect(await getLiveGiftEffects(STREAM)).toEqual({ error: "disabled" });
    const fd = new FormData();
    fd.set("giftsFrom", "EVERYONE");
    await expect(updateGiftsFrom(fd)).rejects.toThrow("REDIRECT:/settings?error=other");
    expect(purchaseCreate).not.toHaveBeenCalled();
    expect(deliverGiftPurchase).not.toHaveBeenCalled();
    expect(sendUpdateMany).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
  });
  it("refuses the guest identity even if it were an admin", async () => {
    user = { ...user, isAdmin: true, isGuestPreview: true };
    expect(await createGiftIntent("sticker.wave", BOB, null)).toEqual({ error: "disabled" });
  });
});

describe("createGiftIntent", () => {
  it("creates one PENDING admin-grant purchase with its send, then delivers it", async () => {
    expect(await createGiftIntent("sticker.wave", BOB, "  Hello there  ")).toEqual({
      error: null,
      sendId: SEND,
      delivered: true,
    });
    expect(purchaseCreate).toHaveBeenCalledTimes(1);
    const { data } = purchaseCreate.mock.calls[0][0] as { data: Record<string, unknown> & { send: { create: Record<string, unknown> } } };
    expect(data).toMatchObject({ buyerId: ME, provider: "ADMIN_GRANT", status: "PENDING", amountMinor: 0 });
    expect(data.send.create).toMatchObject({
      senderId: ME,
      recipientId: BOB,
      message: "Hello there",
      context: "DIRECT",
      status: "AWAITING_PAYMENT",
    });
    expect(deliverGiftPurchase).toHaveBeenCalledWith("purchase1");
  });

  it("checks both limiters, the second per sender and recipient", async () => {
    await createGiftIntent("sticker.wave", BOB, null);
    expect(checkRateLimit).toHaveBeenCalledWith("giftIntent", ME);
    expect(checkRateLimit).toHaveBeenCalledWith("giftToSameRecipient", `${ME}:${BOB}`);
    limits.giftIntent = false;
    expect(await createGiftIntent("sticker.wave", BOB, null)).toEqual({ error: "rate_limited" });
    limits.giftIntent = true;
    limits.giftToSameRecipient = false;
    expect(await createGiftIntent("sticker.wave", BOB, null)).toEqual({ error: "rate_limited" });
    expect(purchaseCreate).toHaveBeenCalledTimes(1);
  });

  it("refuses a note over 140 characters before moderation or any write", async () => {
    expect(await createGiftIntent("sticker.wave", BOB, "x".repeat(141))).toEqual({ error: "too_long" });
    expect(moderateText).not.toHaveBeenCalled();
    expect(purchaseCreate).not.toHaveBeenCalled();
  });

  it("moderates the note before anything is created, and refuses a flagged one", async () => {
    moderateText.mockResolvedValue({ allowed: false, flaggedCategories: ["harassment"] });
    expect(await createGiftIntent("sticker.wave", BOB, "something nasty")).toEqual({ error: "moderation" });
    expect(moderateText).toHaveBeenCalledWith("something nasty");
    expect(purchaseCreate).not.toHaveBeenCalled();
    expect(deliverGiftPurchase).not.toHaveBeenCalled();
  });

  it("applies blocks, age and the recipient's rules before anything is written", async () => {
    blocked = true;
    expect(await createGiftIntent("sticker.wave", BOB, null)).toEqual({ error: "unavailable" });
    blocked = false;
    user = { ...user, birthDate: null };
    expect(await createGiftIntent("sticker.wave", BOB, null)).toEqual({ error: "adult_only" });
    user = { ...user, birthDate: adult };
    connected = false;
    expect(await createGiftIntent("sticker.wave", BOB, null)).toEqual({ error: "not_accepting" });
    recipient = { ...recipient!, giftsFrom: "EVERYONE", birthDate: new Date("2011-01-01T00:00:00Z") };
    expect(await createGiftIntent("sticker.wave", BOB, null)).toEqual({ error: "not_accepting" });
    recipient = { ...recipient!, isAdmin: false, birthDate: adult };
    expect(await createGiftIntent("sticker.wave", BOB, null)).toEqual({ error: "unavailable" });
    expect(purchaseCreate).not.toHaveBeenCalled();
  });

  it("refuses an unknown product, a missing recipient and yourself", async () => {
    product = null;
    expect(await createGiftIntent("sticker.nope", BOB, null)).toEqual({ error: "invalid" });
    product = { id: "p", currency: "USD" };
    recipient = null;
    expect(await createGiftIntent("sticker.wave", BOB, null)).toEqual({ error: "unavailable" });
    expect(await createGiftIntent("sticker.wave", ME, null)).toEqual({ error: "invalid" });
    expect(await createGiftIntent("NOT A SKU", BOB, null)).toEqual({ error: "invalid" });
    expect(purchaseCreate).not.toHaveBeenCalled();
  });

  it("from a chat: only a 1:1 with the recipient that isn't secret, and unlocked", async () => {
    const place = { context: "CHAT" as const, conversationId: CHAT };
    expect(await createGiftIntent("sticker.wave", BOB, null, place)).toMatchObject({ error: null });
    expect((purchaseCreate.mock.calls[0][0] as { data: { send: { create: Record<string, unknown> } } }).data.send.create).toMatchObject({
      context: "CHAT",
      conversationId: CHAT,
    });
    conversation!.members[1].e2eeEnabledAt = new Date();
    conversation!.members[0].e2eeEnabledAt = new Date();
    expect(await createGiftIntent("sticker.wave", BOB, null, place)).toEqual({ error: "unavailable" });
    conversation!.members.forEach((m) => (m.e2eeEnabledAt = null));
    conversation!.isGroup = true;
    expect(await createGiftIntent("sticker.wave", BOB, null, place)).toEqual({ error: "unavailable" });
    conversation!.isGroup = false;
    conversation!.members[0].hiddenAt = new Date();
    expect(await createGiftIntent("sticker.wave", BOB, null, place)).toEqual({ error: "hidden_locked" });
    expect(purchaseCreate).toHaveBeenCalledTimes(1);
  });

  it("in a live stream: to its host, from someone in it, never to an under-18 host", async () => {
    const place = { context: "LIVE" as const, liveStreamId: STREAM };
    expect(await createGiftIntent("live.confetti", BOB, null, place)).toMatchObject({ error: null });
    viewing = null;
    expect(await createGiftIntent("live.confetti", BOB, null, place)).toEqual({ error: "not_in_stream" });
    viewing = { role: "VIEWER", joinedAt: new Date(0) };
    user = { ...user, lastSeenAt: new Date(0) };
    expect(await createGiftIntent("live.confetti", BOB, null, place)).toEqual({ error: "not_in_stream" });
    viewing = { role: "VIEWER", joinedAt: new Date() };
    stream = { ...stream!, hostId: "someoneelse00" };
    expect(await createGiftIntent("live.confetti", BOB, null, place)).toEqual({ error: "unavailable" });
    stream = { ...stream!, hostId: BOB, status: "ENDED" };
    expect(await createGiftIntent("live.confetti", BOB, null, place)).toEqual({ error: "unavailable" });
    stream = { ...stream!, status: "LIVE" };
    recipient = { ...recipient!, birthDate: new Date("2011-01-01T00:00:00Z") };
    expect(await createGiftIntent("live.confetti", BOB, null, place)).toEqual({ error: "not_accepting" });
    expect(purchaseCreate).toHaveBeenCalledTimes(1);
  });
});

describe("openGift", () => {
  it("opens a delivered gift once and shows it again after (idempotent)", async () => {
    const first = await openGift(SEND);
    expect(first).toMatchObject({ error: null, gift: { sendId: SEND, senderName: "Bob", productSku: "box.say-hi" } });
    expect(sendUpdateMany).toHaveBeenCalledTimes(1);
    expect(sendUpdateMany.mock.calls[0][0]).toMatchObject({ where: { id: SEND, recipientId: ME, status: "DELIVERED" } });
    send = giftView("OPENED");
    const second = await openGift(SEND);
    expect(second).toEqual(first);
    expect(sendUpdateMany).toHaveBeenCalledTimes(1);
  });
  it("finds nothing that isn't the caller's delivered gift", async () => {
    send = null;
    expect(await openGift(SEND)).toEqual({ error: "not_found" });
    send = giftView("REVOKED");
    expect(await openGift(SEND)).toEqual({ error: "not_found" });
  });
  it("is limited by giftOpen", async () => {
    limits.giftOpen = false;
    expect(await openGift(SEND)).toEqual({ error: "rate_limited" });
  });
});

describe("equipGift / unequipGift", () => {
  it("wears a frame the user owns", async () => {
    expect(await equipGift("aurora-frame")).toEqual({ error: null });
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ME }, data: { equippedFrameItemId: "gift_item_aurora-frame" } }),
    );
  });
  it("wears a badge in the badge slot", async () => {
    item = { id: "gift_item_supporter-star", kind: "BADGE" };
    await equipGift("supporter-star");
    expect(userUpdate.mock.calls[0][0]).toMatchObject({ data: { equippedBadgeItemId: "gift_item_supporter-star" } });
  });
  it("refuses what the user doesn't own (or only owned a revoked copy of), or isn't wearable", async () => {
    ownedRows = [];
    expect(await equipGift("aurora-frame")).toEqual({ error: "not_owned" });
    ownedRows = [{ revokedAt: new Date() }];
    expect(await equipGift("aurora-frame")).toEqual({ error: "not_owned" });
    ownedRows = [{ revokedAt: null }];
    item = { id: "gift_item_wave", kind: "STICKER" };
    expect(await equipGift("wave")).toEqual({ error: "not_owned" });
    item = null;
    expect(await equipGift("ghost")).toEqual({ error: "not_owned" });
    expect(userUpdate).not.toHaveBeenCalled();
  });
  it("takes a frame or badge off", async () => {
    expect(await unequipGift("BADGE")).toEqual({ error: null });
    expect(userUpdate.mock.calls[0][0]).toMatchObject({ data: { equippedBadgeItemId: null } });
    expect(await unequipGift("STICKER" as never)).toEqual({ error: "invalid" });
  });
});

describe("hideGift and the chat card", () => {
  it("hides only the caller's own delivered or opened gift", async () => {
    expect(await hideGift(SEND)).toEqual({ error: null });
    expect(sendUpdateMany.mock.calls[0][0]).toMatchObject({
      where: { id: SEND, recipientId: ME, status: { in: ["DELIVERED", "OPENED"] } },
      data: { status: "HIDDEN_BY_RECIPIENT" },
    });
    sendUpdateMany.mockResolvedValue({ count: 0 });
    expect(await hideGift(SEND)).toEqual({ error: "not_found" });
  });
  it("shows the card to the two people in the chat only, never across a block", async () => {
    expect(await getGiftChatCard(SEND)).toMatchObject({ error: null, card: { isRecipient: true, status: "DELIVERED" } });
    blocked = true;
    expect(await getGiftChatCard(SEND)).toEqual({ error: "unavailable" });
    blocked = false;
    send = { ...giftView("DELIVERED"), recipientId: "cother00000001" };
    expect(await getGiftChatCard(SEND)).toEqual({ error: "unavailable" });
    send = giftView("REVOKED");
    expect(await getGiftChatCard(SEND)).toEqual({ error: "unavailable" });
  });
});

describe("updateGiftsFrom", () => {
  it("saves a valid choice and refuses anything else", async () => {
    const fd = new FormData();
    fd.set("giftsFrom", "NOBODY");
    await expect(updateGiftsFrom(fd)).rejects.toThrow("REDIRECT:/settings?saved=1");
    expect(userUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { giftsFrom: "NOBODY" } }));
    fd.set("giftsFrom", "SOMEONE");
    await expect(updateGiftsFrom(fd)).rejects.toThrow("REDIRECT:/settings?error=invalid");
  });
});
