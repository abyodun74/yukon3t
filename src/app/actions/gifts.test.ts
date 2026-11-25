import { beforeEach, describe, expect, it, vi } from "vitest";

// app/actions/gifts.ts against a mocked database: the gate refuses non-admins in every action, every rule is checked
// (and the note moderated) before any coin moves, the limiters are wired, a paid gift is paid with Y3T Coins at the
// server's own price (never the browser's), a retry of the same request spends nothing more, opening is idempotent and
// equipping needs ownership.

const ME = "cme00000000001";
const BOB = "cbob0000000001";
const CHAT = "cchat000000001";
const STREAM = "cstream0000001";
const SEND = "csend000000001";

const adult = new Date("1990-01-01T00:00:00Z");
let user: Record<string, unknown>;
let recipient: Record<string, unknown> | null;
let product: Record<string, unknown> | null;
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
const spendCoinsOnGift = vi.fn();
const findCoinPurchase = vi.fn();
let purchaseState: { status: string; send: { status: string } } | null;
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
vi.mock("@/lib/coin-wallet", () => ({
  getCoinBalance: async () => 175,
  findCoinPurchase: (...a: unknown[]) => findCoinPurchase(...a),
  spendCoinsOnGift: (...a: unknown[]) => spendCoinsOnGift(...a),
}));
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
    giftPurchase: { create: (...a: unknown[]) => purchaseCreate(...a), findUnique: async () => purchaseState },
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
  checkGiftRecipient,
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
  thanksForSendId: null,
  thankedBy: null,
  sender: { name: "Bob", username: "bob", status: "ACTIVE" },
  purchase: {
    provider: "COINS",
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
  product = { id: "gift_product_sticker.wave", webPriceMinor: 99, coinPrice: 25, universe: "CELEBRATE", availableFrom: null, availableUntil: null };
  purchaseState = { status: "PAID", send: { status: "DELIVERED" } };
  findCoinPurchase.mockResolvedValue(null);
  spendCoinsOnGift.mockResolvedValue({ outcome: "created", purchaseId: "purchase1", sendId: SEND, balance: 175 });
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
    expect(await createGiftIntent("sticker.wave", BOB, null, { context: "DIRECT" }, { clientRequestId: "req-0000000001" })).toEqual({
      error: "disabled",
    });
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
    expect(spendCoinsOnGift).not.toHaveBeenCalled();
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

const REQ = { clientRequestId: "req-0000000001" };
const DIRECT = { context: "DIRECT" as const };

describe("createGiftIntent (paid with Y3T Coins)", () => {
  it("spends the server's own price x quantity once, then delivers through the one delivery path", async () => {
    expect(await createGiftIntent("sticker.wave", BOB, "  Hello there  ", DIRECT, { ...REQ, quantity: 3 })).toEqual({
      error: null,
      sendId: SEND,
      delivered: true,
      refunded: false,
      pending: false,
      coinBalance: 175,
    });
    expect(spendCoinsOnGift).toHaveBeenCalledTimes(1);
    expect(spendCoinsOnGift.mock.calls[0][0]).toMatchObject({
      buyerId: ME,
      productId: "gift_product_sticker.wave",
      unitPrice: 25,
      quantity: 3,
      total: 75,
      clientRequestId: REQ.clientRequestId,
      send: { recipientId: BOB, message: "Hello there", context: "DIRECT", conversationId: null, liveStreamId: null },
    });
    expect(deliverGiftPurchase).toHaveBeenCalledWith("purchase1");
    // Nothing is created outside the coin spend's own transaction.
    expect(purchaseCreate).not.toHaveBeenCalled();
  });

  it("needs a request id and a quantity of 1..10; never trusts anything else from the browser", async () => {
    expect(await createGiftIntent("sticker.wave", BOB, null, DIRECT)).toEqual({ error: "invalid" });
    expect(await createGiftIntent("sticker.wave", BOB, null, DIRECT, { clientRequestId: "x" })).toEqual({ error: "invalid" });
    expect(await createGiftIntent("sticker.wave", BOB, null, DIRECT, { ...REQ, quantity: 0 })).toEqual({ error: "invalid" });
    expect(await createGiftIntent("sticker.wave", BOB, null, DIRECT, { ...REQ, quantity: 11 })).toEqual({ error: "invalid" });
    expect(await createGiftIntent("sticker.wave", BOB, null, DIRECT, { ...REQ, quantity: 1.5 })).toEqual({ error: "invalid" });
    // A total or price the browser might add is simply not part of the request.
    await createGiftIntent("sticker.wave", BOB, null, DIRECT, { ...REQ, quantity: 2, total: 1, coinPrice: 1 } as never);
    expect(spendCoinsOnGift.mock.calls[0][0]).toMatchObject({ unitPrice: 25, total: 50 });
  });

  it("answers insufficient coins with the balance, writing nothing", async () => {
    spendCoinsOnGift.mockResolvedValue({ outcome: "insufficient", balance: 10 });
    expect(await createGiftIntent("sticker.wave", BOB, null, DIRECT, REQ)).toEqual({ error: "insufficient_coins", coinBalance: 10, total: 25 });
    expect(deliverGiftPurchase).not.toHaveBeenCalled();
  });

  it("a retry of the same request spends nothing more: it answers (and finishes) the first one, before the limiters", async () => {
    findCoinPurchase.mockResolvedValue({
      id: "purchase1",
      buyerId: ME,
      productId: "gift_product_sticker.wave",
      quantity: 1,
      status: "PENDING",
      send: { id: SEND, recipientId: BOB, status: "AWAITING_PAYMENT" },
    });
    limits.giftIntent = false;
    expect(await createGiftIntent("sticker.wave", BOB, null, DIRECT, REQ)).toMatchObject({ error: null, sendId: SEND, delivered: true });
    expect(spendCoinsOnGift).not.toHaveBeenCalled();
    expect(deliverGiftPurchase).toHaveBeenCalledWith("purchase1");
    // The same id for a different gift, person or quantity is refused, never sent.
    expect(await createGiftIntent("sticker.wave", BOB, null, DIRECT, { ...REQ, quantity: 2 })).toEqual({ error: "invalid" });
    expect(spendCoinsOnGift).not.toHaveBeenCalled();
  });

  it("a delivery that fails after the spend leaves it pending (the same request finishes it), and never throws", async () => {
    deliverGiftPurchase.mockRejectedValue(new Error("db blip"));
    purchaseState = { status: "PENDING", send: { status: "AWAITING_PAYMENT" } };
    expect(await createGiftIntent("sticker.wave", BOB, null, DIRECT, REQ)).toMatchObject({ error: null, pending: true, delivered: false });
  });

  it("says when an undeliverable gift's coins came back", async () => {
    deliverGiftPurchase.mockResolvedValue("undeliverable");
    purchaseState = { status: "REFUNDED", send: { status: "UNDELIVERABLE" } };
    expect(await createGiftIntent("sticker.wave", BOB, null, DIRECT, REQ)).toMatchObject({ error: null, refunded: true, delivered: false, pending: false });
  });

  it("checks both limiters, the second per sender and recipient", async () => {
    await createGiftIntent("sticker.wave", BOB, null, DIRECT, REQ);
    expect(checkRateLimit).toHaveBeenCalledWith("giftIntent", ME);
    expect(checkRateLimit).toHaveBeenCalledWith("giftToSameRecipient", `${ME}:${BOB}`);
    limits.giftIntent = false;
    expect(await createGiftIntent("sticker.wave", BOB, null, DIRECT, REQ)).toEqual({ error: "rate_limited" });
    limits.giftIntent = true;
    limits.giftToSameRecipient = false;
    expect(await createGiftIntent("sticker.wave", BOB, null, DIRECT, REQ)).toEqual({ error: "rate_limited" });
    expect(spendCoinsOnGift).toHaveBeenCalledTimes(1);
  });

  it("refuses a note over 140 characters before moderation or any coin moves", async () => {
    expect(await createGiftIntent("sticker.wave", BOB, "x".repeat(141), DIRECT, REQ)).toEqual({ error: "too_long" });
    expect(moderateText).not.toHaveBeenCalled();
    expect(spendCoinsOnGift).not.toHaveBeenCalled();
  });

  it("moderates the note before any coin moves, and refuses a flagged one", async () => {
    moderateText.mockResolvedValue({ allowed: false, flaggedCategories: ["harassment"] });
    expect(await createGiftIntent("sticker.wave", BOB, "something nasty", DIRECT, REQ)).toEqual({ error: "moderation" });
    expect(moderateText).toHaveBeenCalledWith("something nasty");
    expect(spendCoinsOnGift).not.toHaveBeenCalled();
    expect(deliverGiftPurchase).not.toHaveBeenCalled();
  });

  it("applies blocks, age and the recipient's rules before any coin moves", async () => {
    blocked = true;
    expect(await createGiftIntent("sticker.wave", BOB, null, DIRECT, REQ)).toEqual({ error: "unavailable" });
    blocked = false;
    user = { ...user, birthDate: null };
    expect(await createGiftIntent("sticker.wave", BOB, null, DIRECT, REQ)).toEqual({ error: "adult_only" });
    user = { ...user, birthDate: adult };
    connected = false;
    expect(await createGiftIntent("sticker.wave", BOB, null, DIRECT, REQ)).toEqual({ error: "not_accepting" });
    recipient = { ...recipient!, giftsFrom: "EVERYONE", birthDate: new Date("2011-01-01T00:00:00Z") };
    expect(await createGiftIntent("sticker.wave", BOB, null, DIRECT, REQ)).toEqual({ error: "not_accepting" });
    recipient = { ...recipient!, isAdmin: false, birthDate: adult };
    expect(await createGiftIntent("sticker.wave", BOB, null, DIRECT, REQ)).toEqual({ error: "unavailable" });
    expect(spendCoinsOnGift).not.toHaveBeenCalled();
  });

  it("refuses an unknown or removed product, one without a coin price, a missing recipient and yourself", async () => {
    product = null;
    expect(await createGiftIntent("sticker.nope", BOB, null, DIRECT, REQ)).toEqual({ error: "gift_unavailable" });
    product = { id: "p", webPriceMinor: 99, coinPrice: null, universe: "CELEBRATE", availableFrom: null, availableUntil: null };
    expect(await createGiftIntent("sticker.wave", BOB, null, DIRECT, REQ)).toEqual({ error: "gift_unavailable" });
    product = { id: "p", webPriceMinor: 99, coinPrice: 25, universe: "CELEBRATE", availableFrom: null, availableUntil: null };
    recipient = null;
    expect(await createGiftIntent("sticker.wave", BOB, null, DIRECT, REQ)).toEqual({ error: "unavailable" });
    expect(await createGiftIntent("sticker.wave", ME, null, DIRECT, REQ)).toEqual({ error: "invalid" });
    expect(await createGiftIntent("NOT A SKU", BOB, null, DIRECT, REQ)).toEqual({ error: "invalid" });
    expect(spendCoinsOnGift).not.toHaveBeenCalled();
  });

  it("from a chat: only a 1:1 with the recipient that isn't secret, and unlocked", async () => {
    const place = { context: "CHAT" as const, conversationId: CHAT };
    expect(await createGiftIntent("sticker.wave", BOB, null, place, REQ)).toMatchObject({ error: null });
    expect(spendCoinsOnGift.mock.calls[0][0]).toMatchObject({ send: { context: "CHAT", conversationId: CHAT } });
    conversation!.members[1].e2eeEnabledAt = new Date();
    conversation!.members[0].e2eeEnabledAt = new Date();
    expect(await createGiftIntent("sticker.wave", BOB, null, place, REQ)).toEqual({ error: "unavailable" });
    conversation!.members.forEach((m) => (m.e2eeEnabledAt = null));
    conversation!.isGroup = true;
    expect(await createGiftIntent("sticker.wave", BOB, null, place, REQ)).toEqual({ error: "unavailable" });
    conversation!.isGroup = false;
    conversation!.members[0].hiddenAt = new Date();
    expect(await createGiftIntent("sticker.wave", BOB, null, place, REQ)).toEqual({ error: "hidden_locked" });
    expect(spendCoinsOnGift).toHaveBeenCalledTimes(1);
  });

  it("in a live stream: to its host, from someone in it, never to an under-18 host", async () => {
    const place = { context: "LIVE" as const, liveStreamId: STREAM };
    expect(await createGiftIntent("live.confetti", BOB, null, place, REQ)).toMatchObject({ error: null });
    viewing = null;
    expect(await createGiftIntent("live.confetti", BOB, null, place, REQ)).toEqual({ error: "not_in_stream" });
    viewing = { role: "VIEWER", joinedAt: new Date(0) };
    user = { ...user, lastSeenAt: new Date(0) };
    expect(await createGiftIntent("live.confetti", BOB, null, place, REQ)).toEqual({ error: "not_in_stream" });
    viewing = { role: "VIEWER", joinedAt: new Date() };
    stream = { ...stream!, hostId: "someoneelse00" };
    expect(await createGiftIntent("live.confetti", BOB, null, place, REQ)).toEqual({ error: "unavailable" });
    stream = { ...stream!, hostId: BOB, status: "ENDED" };
    expect(await createGiftIntent("live.confetti", BOB, null, place, REQ)).toEqual({ error: "unavailable" });
    stream = { ...stream!, status: "LIVE" };
    recipient = { ...recipient!, birthDate: new Date("2011-01-01T00:00:00Z") };
    expect(await createGiftIntent("live.confetti", BOB, null, place, REQ)).toEqual({ error: "not_accepting" });
    expect(spendCoinsOnGift).toHaveBeenCalledTimes(1);
  });
});

describe("checkGiftRecipient", () => {
  it("says whether a gift could be sent, with one answer for a block", async () => {
    expect(await checkGiftRecipient(BOB)).toEqual({ error: null });
    blocked = true;
    expect(await checkGiftRecipient(BOB)).toEqual({ error: "unavailable" });
    blocked = false;
    expect(await checkGiftRecipient(ME)).toEqual({ error: "invalid" });
    user = { ...user, isAdmin: false };
    expect(await checkGiftRecipient(BOB)).toEqual({ error: "disabled" });
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
  it("names the sender by @username and offers one Thank You", async () => {
    const result = await openGift(SEND);
    expect(result).toMatchObject({
      error: null,
      gift: { senderName: "Bob", senderUsername: "bob", message: "Enjoy", canThank: true, thanked: false, isAward: false },
    });
  });
  it("never offers a second Thank You, or one for a Thank You", async () => {
    send = { ...giftView("OPENED"), thankedBy: { id: "cthanks0000001" } };
    expect(await openGift(SEND)).toMatchObject({ gift: { canThank: false, thanked: true } });
    send = { ...giftView("OPENED"), thanksForSendId: "cother00000001" };
    expect(await openGift(SEND)).toMatchObject({ gift: { canThank: false, thanked: false } });
  });
  it("withholds the sender's name, @username and note across a block, and offers no Thank You", async () => {
    blocked = true;
    const result = await openGift(SEND);
    expect(result).toMatchObject({
      error: null,
      gift: { senderName: null, senderUsername: null, message: null, canThank: false },
    });
    expect(JSON.stringify(result)).not.toMatch(/Bob|bob|Enjoy/);
  });
  it("leaves out the @username of an account that is no longer active", async () => {
    send = { ...giftView("OPENED"), sender: { name: "Bob", username: "bob", status: "DEACTIVATED" } };
    expect(await openGift(SEND)).toMatchObject({ gift: { senderName: "Bob", senderUsername: null } });
  });
  it("an award has no sender and no Thank You", async () => {
    send = { ...giftView("OPENED"), senderId: null, sender: null, purchase: { ...giftView("OPENED").purchase, provider: "SYSTEM_AWARD" } };
    expect(await openGift(SEND)).toMatchObject({ gift: { isAward: true, senderUsername: null, canThank: false } });
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
