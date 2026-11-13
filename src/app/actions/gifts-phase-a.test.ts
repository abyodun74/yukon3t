import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Occasion } from "@/lib/gift-occasions";

// Phase A actions (app/actions/gifts.ts) against a mocked database: the picker's catalog re-checks every send rule on
// the server and builds its shelves, free gifts are appreciation-only with their own fail-closed limits, a received
// gift can be thanked once, the showcase holds three of the user's own opened gifts, self-declared occasions are
// limited and never notify, and the chat chip shows only on an occasion day.

const ME = "cme00000000001";
const BOB = "cbob0000000001";
const CHAT = "cchat000000001";
const SEND = "csend000000001";
const OWNED = "cowned00000001";

const adult = new Date("1990-01-01T00:00:00Z");
let user: Record<string, unknown>;
let recipient: Record<string, unknown> | null;
let blocked: boolean;
let connected: boolean;
let productRows: Record<string, unknown>[];
let freeProduct: Record<string, unknown> | null;
let paidProduct: Record<string, unknown> | null;
let occasions: Occasion[];
let editionGiven: number;
let received: Record<string, unknown> | null;
let conversation: Record<string, unknown> | null;
let ownedRow: Record<string, unknown> | null;
let pins: { id: string; ownedGiftId: string; position: number; ownedGift: Record<string, unknown> }[];
let selfRows: { kind: string; declaredAt: Date }[];
const limits: Record<string, boolean> = {};

const checkRateLimit = vi.fn(async (name: string, id: string) => {
  void id;
  return limits[name] ?? true;
});
const purchaseCreate = vi.fn();
const deliverGiftPurchase = vi.fn();
const pinCreate = vi.fn();
const pinDeleteMany = vi.fn();
const selfCreate = vi.fn();
const selfDeleteMany = vi.fn();
const selfUpdateMany = vi.fn();
const executeRaw = vi.fn();
const loadGiftOccasions = vi.fn(async () => occasions);
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));
vi.mock("@/lib/auth-guards", () => ({ requireVerifiedUser: async () => user, requireUser: async () => user }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (name: string, id: string) => checkRateLimit(name, id) }));
vi.mock("@/lib/moderation", () => ({ moderateText: async () => ({ allowed: true, flaggedCategories: [] }) }));
vi.mock("@/lib/blocks", () => ({ isBlockedEitherWay: async () => blocked }));
vi.mock("@/lib/hidden-chats", () => ({ isMembershipLocked: async (m: { hiddenAt: Date | null }) => m.hiddenAt !== null }));
vi.mock("@/lib/live-stream-access", () => ({ canAccessLiveStream: async () => true }));
vi.mock("@/lib/gift-delivery", () => ({ deliverGiftPurchase: (id: string) => deliverGiftPurchase(id) }));
vi.mock("@/lib/gift-occasions-data", () => ({ loadGiftOccasions: () => loadGiftOccasions() }));
vi.mock("@/lib/prisma", () => {
  const prisma: Record<string, unknown> = {
    user: { findUnique: async () => recipient, update: vi.fn(async () => ({ id: ME })) },
    connection: { findFirst: async () => (connected ? { id: "conn" } : null) },
    conversation: { findUnique: async () => conversation },
    giftProduct: {
      findMany: async () => productRows,
      findFirst: async ({ where }: { where: { webPriceMinor?: number } }) => (where.webPriceMinor === 0 ? freeProduct : paidProduct),
    },
    giftPurchase: { create: (...a: unknown[]) => purchaseCreate(...a) },
    giftSend: { findUnique: async () => received },
    ownedGift: {
      count: async () => editionGiven,
      findUnique: async () => ownedRow,
      findMany: async () => [],
    },
    giftShowcasePin: {
      findMany: async () => pins,
      create: (...a: unknown[]) => pinCreate(...a),
      deleteMany: (...a: unknown[]) => pinDeleteMany(...a),
    },
    giftSelfOccasion: {
      deleteMany: (...a: unknown[]) => selfDeleteMany(...a),
      findMany: async () => selfRows,
      create: (...a: unknown[]) => selfCreate(...a),
      updateMany: (...a: unknown[]) => selfUpdateMany(...a),
    },
    $executeRaw: (...a: unknown[]) => executeRaw(...a),
  };
  prisma.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma);
  return { prisma };
});

import {
  createGiftIntent,
  declareGiftOccasion,
  getGiftCatalog,
  getGiftOccasionChip,
  pinGiftToShowcase,
  sendFreeGift,
  sendThankYouGift,
  unpinGiftFromShowcase,
} from "@/app/actions/gifts";

const item = (slug: string, over: Record<string, unknown> = {}) => ({
  id: `gift_item_${slug}`,
  slug,
  kind: "STICKER",
  assetKey: slug,
  sortOrder: 10,
  active: true,
  rarity: "STANDARD",
  editionSize: null,
  availableFrom: null,
  availableUntil: null,
  ...over,
});
const product = (sku: string, universe: string, tags: string[], price: number, items: ReturnType<typeof item>[], over: Record<string, unknown> = {}) => ({
  sku,
  isBox: items.length > 1,
  webPriceMinor: price,
  currency: "USD",
  universe,
  rarity: "STANDARD",
  occasionTags: tags,
  availableFrom: null,
  availableUntil: null,
  items: items.map((i) => ({ quantity: 1, item: i })),
  ...over,
});
const birthday: Occasion = { kind: "BIRTHDAY", universes: ["CELEBRATE", "LOVE"], tags: ["birthday"], reasonKey: "BIRTHDAY", window: "today" };

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(limits)) delete limits[k];
  user = { id: ME, name: "Me", isAdmin: true, isGuestPreview: false, status: "ACTIVE", birthDate: adult, lastSeenAt: new Date() };
  recipient = { id: BOB, status: "ACTIVE", isAdmin: true, isGuestPreview: false, birthDate: adult, giftsFrom: "CONNECTIONS" };
  blocked = false;
  connected = true;
  occasions = [];
  editionGiven = 0;
  productRows = [
    product("sticker.cake-slice", "CELEBRATE", ["birthday"], 99, [item("cake-slice")]),
    product("sticker.rose", "LOVE", ["love"], 99, [item("rose")]),
    product("live.confetti", "CELEBRATE", ["birthday"], 199, [item("confetti", { kind: "LIVE_EFFECT" })]),
    product("badge.gg", "GAMING", ["achievement"], 199, [item("gg-badge", { kind: "BADGE" })]),
    product("free.thank-you", "LOVE", ["appreciation"], 0, [item("thank-you")]),
    product("free.mystery", "LOVE", ["birthday"], 0, [item("mystery")]),
    product("sticker.seasonal", "CULTURE", ["holiday"], 99, [item("lantern")], { availableFrom: "01-01", availableUntil: "01-02" }),
    product("sticker.retired", "CELEBRATE", ["birthday"], 99, [item("retired", { active: false })]),
    product("sticker.limited", "LUXURY", ["love"], 499, [item("limited", { rarity: "EDITION", editionSize: 2 })]),
  ];
  freeProduct = { id: "gift_product_free.thank-you", currency: "USD", webPriceMinor: 0, occasionTags: ["appreciation"] };
  paidProduct = { id: "gift_product_sticker.rose", currency: "USD", webPriceMinor: 99, universe: "LOVE", availableFrom: null, availableUntil: null };
  received = { id: SEND, recipientId: ME, senderId: BOB, status: "OPENED", thanksForSendId: null, conversationId: CHAT, thankedBy: null };
  conversation = {
    isGroup: false,
    members: [
      { userId: ME, e2eeEnabledAt: null, hiddenAt: null },
      { userId: BOB, e2eeEnabledAt: null, hiddenAt: null },
    ],
  };
  ownedRow = { id: OWNED, ownerId: ME, revokedAt: null, send: { status: "OPENED" } };
  pins = [];
  selfRows = [];
  purchaseCreate.mockResolvedValue({ id: "purchase1", send: { id: "cnewsend000001" } });
  deliverGiftPurchase.mockResolvedValue("delivered");
});

describe("getGiftCatalog(recipientId)", () => {
  it("is off for anyone gifts aren't on for, and refuses yourself", async () => {
    user = { ...user, isAdmin: false };
    expect(await getGiftCatalog(BOB)).toEqual({ error: "disabled" });
    user = { ...user, isAdmin: true };
    expect(await getGiftCatalog(ME)).toEqual({ error: "invalid" });
  });

  it("re-checks every send rule on the server before showing anything", async () => {
    blocked = true;
    expect(await getGiftCatalog(BOB)).toEqual({ error: "unavailable" });
    blocked = false;
    recipient = { ...recipient!, giftsFrom: "NOBODY" };
    expect(await getGiftCatalog(BOB)).toEqual({ error: "not_accepting" });
    recipient = { ...recipient!, giftsFrom: "EVERYONE", isAdmin: false };
    expect(await getGiftCatalog(BOB)).toEqual({ error: "unavailable" });
    recipient = { ...recipient!, isAdmin: true };
    user = { ...user, birthDate: null };
    expect(await getGiftCatalog(BOB)).toEqual({ error: "adult_only" });
    user = { ...user, birthDate: adult };
    limits.giftCatalog = false;
    expect(await getGiftCatalog(BOB)).toEqual({ error: "rate_limited" });
    expect(loadGiftOccasions).not.toHaveBeenCalled();
  });

  it("offers only what may be sent: active, in season, not sold out, free only for appreciation", async () => {
    editionGiven = 2;
    const result = await getGiftCatalog(BOB);
    if (result.error) throw new Error(result.error);
    const skus = result.products.map((p) => p.sku);
    expect(skus).toEqual(expect.arrayContaining(["sticker.cake-slice", "sticker.rose", "live.confetti", "badge.gg", "free.thank-you"]));
    for (const gone of ["free.mystery", "sticker.seasonal", "sticker.retired", "sticker.limited"]) expect(skus).not.toContain(gone);
    expect(result.shelves.rightNow).toBeNull();
    expect(result.shelves.kindWords).toEqual(["free.thank-you"]);
    expect(result.products.find((p) => p.sku === "free.thank-you")?.free).toBe(true);
    // Nothing in the catalog says how many of anything is left.
    expect(JSON.stringify(result)).not.toMatch(/left|remaining|editionSize/i);
  });

  it("puts the occasion's gifts on Right now, with the occasion, computed for this viewer", async () => {
    occasions = [birthday];
    const result = await getGiftCatalog(BOB);
    if (result.error) throw new Error(result.error);
    expect(result.shelves.rightNow?.occasions).toEqual([birthday]);
    expect(result.shelves.rightNow?.skus).toEqual(["sticker.cake-slice", "live.confetti"]);
  });

  it("in a live room: no Love & Emotion, no free gifts, live effects only", async () => {
    const result = await getGiftCatalog(BOB, "LIVE");
    if (result.error) throw new Error(result.error);
    expect(result.products.map((p) => p.sku)).toEqual(["live.confetti"]);
    expect(result.shelves.kindWords).toEqual([]);
  });
});

describe("createGiftIntent (Phase A checks)", () => {
  it("never sends a free product (those go through sendFreeGift) nor Love & Emotion into a live room", async () => {
    paidProduct = { ...paidProduct!, webPriceMinor: 0 };
    expect(await createGiftIntent("free.thank-you", BOB, null)).toEqual({ error: "invalid" });
    paidProduct = { ...paidProduct!, webPriceMinor: 99, availableFrom: "01-01", availableUntil: "01-01" };
    const today = new Date();
    if (!(today.getUTCMonth() === 0 && today.getUTCDate() === 1)) {
      expect(await createGiftIntent("sticker.rose", BOB, null)).toEqual({ error: "invalid" });
    }
    expect(purchaseCreate).not.toHaveBeenCalled();
  });
});

describe("sendFreeGift", () => {
  it("delivers a FREE purchase of 0 through the same delivery, after both free limits", async () => {
    expect(await sendFreeGift("free.thank-you", BOB, null)).toEqual({ error: null, sendId: "cnewsend000001", delivered: true });
    expect(checkRateLimit).toHaveBeenCalledWith("giftFreeDaily", ME);
    expect(checkRateLimit).toHaveBeenCalledWith("giftFreeToSameRecipient", `${ME}:${BOB}`);
    const { data } = purchaseCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data).toMatchObject({ provider: "FREE", amountMinor: 0, status: "PENDING" });
    expect(deliverGiftPurchase).toHaveBeenCalledWith("purchase1");
    expect(checkRateLimit).not.toHaveBeenCalledWith("giftIntent", expect.anything());
  });

  it("refuses when either free limit says no", async () => {
    limits.giftFreeDaily = false;
    expect(await sendFreeGift("free.thank-you", BOB, null)).toEqual({ error: "rate_limited" });
    limits.giftFreeDaily = true;
    limits.giftFreeToSameRecipient = false;
    expect(await sendFreeGift("free.thank-you", BOB, null)).toEqual({ error: "rate_limited" });
    expect(purchaseCreate).not.toHaveBeenCalled();
  });

  it("is appreciation only, never in a live room, and under the same rules as a paid gift", async () => {
    freeProduct = null;
    expect(await sendFreeGift("sticker.rose", BOB, null)).toEqual({ error: "invalid" });
    freeProduct = { id: "x", currency: "USD", webPriceMinor: 0, occasionTags: ["birthday"] };
    expect(await sendFreeGift("free.mystery", BOB, null)).toEqual({ error: "invalid" });
    freeProduct = { id: "x", currency: "USD", webPriceMinor: 0, occasionTags: ["appreciation"] };
    expect(await sendFreeGift("free.thank-you", BOB, null, { context: "LIVE", liveStreamId: "cstream0000001" } as never)).toEqual({
      error: "invalid",
    });
    blocked = true;
    expect(await sendFreeGift("free.thank-you", BOB, null)).toEqual({ error: "unavailable" });
    blocked = false;
    recipient = { ...recipient!, giftsFrom: "NOBODY" };
    expect(await sendFreeGift("free.thank-you", BOB, null)).toEqual({ error: "not_accepting" });
    expect(purchaseCreate).not.toHaveBeenCalled();
  });
});

describe("sendThankYouGift", () => {
  it("sends one free Thank You back into the same chat, linked to the gift it thanks", async () => {
    expect(await sendThankYouGift(SEND)).toMatchObject({ error: null, delivered: true });
    const { data } = purchaseCreate.mock.calls[0][0] as { data: { provider: string; send: { create: Record<string, unknown> } } };
    expect(data.provider).toBe("FREE");
    expect(data.send.create).toMatchObject({ senderId: ME, recipientId: BOB, thanksForSendId: SEND, context: "CHAT", conversationId: CHAT });
  });

  it("only once per received gift (checked first, and the unique key backs it up)", async () => {
    received = { ...received!, thankedBy: { id: "cthanks0000001" } };
    expect(await sendThankYouGift(SEND)).toEqual({ error: "already_thanked" });
    received = { ...received!, thankedBy: null };
    // Two taps racing past the check: the second insert hits the unique thanksForSendId.
    const { Prisma } = await import("@/generated/prisma/client");
    purchaseCreate.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "7" }));
    expect(await sendThankYouGift(SEND)).toEqual({ error: "already_thanked" });
  });

  it("only by its recipient, never for a Thank You itself, and to the profile when the chat can't take a card", async () => {
    received = { ...received!, recipientId: "cother00000001" };
    expect(await sendThankYouGift(SEND)).toEqual({ error: "not_found" });
    received = { ...received!, recipientId: ME, thanksForSendId: "corig000000001" };
    expect(await sendThankYouGift(SEND)).toEqual({ error: "unavailable" });
    received = { ...received!, thanksForSendId: null };
    conversation = { ...conversation!, isGroup: true };
    await sendThankYouGift(SEND);
    const { data } = purchaseCreate.mock.calls[0][0] as { data: { send: { create: Record<string, unknown> } } };
    expect(data.send.create).toMatchObject({ context: "DIRECT", conversationId: null });
  });
});

describe("the showcase", () => {
  it("pins the user's own opened gift in the first free place, under their lock", async () => {
    expect(await pinGiftToShowcase(OWNED)).toEqual({ error: null });
    expect(pinCreate).toHaveBeenCalledWith(expect.objectContaining({ data: { userId: ME, ownedGiftId: OWNED, position: 0 } }));
    expect(executeRaw).toHaveBeenCalled();
  });

  it("refuses someone else's, a revoked or a hidden gift", async () => {
    for (const row of [
      { id: OWNED, ownerId: BOB, revokedAt: null, send: { status: "OPENED" } },
      { id: OWNED, ownerId: ME, revokedAt: new Date(), send: { status: "OPENED" } },
      { id: OWNED, ownerId: ME, revokedAt: null, send: { status: "HIDDEN_BY_RECIPIENT" } },
      null,
    ]) {
      ownedRow = row;
      expect(await pinGiftToShowcase(OWNED)).toEqual({ error: "not_owned" });
    }
    expect(pinCreate).not.toHaveBeenCalled();
  });

  it("holds three; a pin that is no longer eligible frees its place", async () => {
    const ok = { ownerId: ME, revokedAt: null, send: { status: "OPENED" } };
    pins = [0, 1, 2].map((position) => ({ id: `pin${position}`, ownedGiftId: `cother0000000${position}`, position, ownedGift: ok }));
    expect(await pinGiftToShowcase(OWNED)).toEqual({ error: "full" });
    pins[1] = { ...pins[1], ownedGift: { ...ok, revokedAt: new Date() } };
    expect(await pinGiftToShowcase(OWNED)).toEqual({ error: null });
    expect(pinDeleteMany).toHaveBeenCalledWith({ where: { id: { in: ["pin1"] } } });
    expect(pinCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ position: 1 }) }));
  });

  it("unpins only the user's own", async () => {
    expect(await unpinGiftFromShowcase(OWNED)).toEqual({ error: null });
    expect(pinDeleteMany).toHaveBeenCalledWith({ where: { userId: ME, ownedGiftId: OWNED } });
  });
});

describe("self-declared occasions", () => {
  const form = (kind: string) => {
    const fd = new FormData();
    fd.set("kind", kind);
    return fd;
  };
  it("declares one, about yourself only, under your lock", async () => {
    await expect(declareGiftOccasion(form("GRADUATION"))).rejects.toThrow("REDIRECT:/settings?saved=1");
    expect(selfCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: ME, kind: "GRADUATION" }) }));
    expect(executeRaw).toHaveBeenCalled();
    expect(selfDeleteMany).toHaveBeenCalled();
  });
  it("at most one per kind per 30 days, rate-limited, and nothing else accepted", async () => {
    selfRows = [{ kind: "GRADUATION", declaredAt: new Date(Date.now() - 5 * 24 * 60 * 60_000) }];
    await expect(declareGiftOccasion(form("GRADUATION"))).rejects.toThrow("REDIRECT:/settings?error=occasion_too_soon");
    limits.giftOccasionDeclare = false;
    await expect(declareGiftOccasion(form("NEW_JOB"))).rejects.toThrow("REDIRECT:/settings?error=rate_limited");
    await expect(declareGiftOccasion(form("TOURNAMENT_WIN"))).rejects.toThrow("REDIRECT:/settings?error=invalid");
    expect(selfCreate).not.toHaveBeenCalled();
  });
});

describe("getGiftOccasionChip", () => {
  it("shows the best occasion only on an occasion day, only when a gift could be sent from this chat", async () => {
    occasions = [birthday];
    expect(await getGiftOccasionChip(BOB, CHAT)).toEqual({ error: null, occasion: { kind: "BIRTHDAY" } });
    occasions = [{ kind: "SELF_GRADUATION", universes: ["CELEBRATE"], tags: ["graduation"], reasonKey: "SELF_GRADUATION", window: "this_week" }];
    expect(await getGiftOccasionChip(BOB, CHAT)).toEqual({ error: null, occasion: null });
    occasions = [birthday];
    blocked = true;
    expect(await getGiftOccasionChip(BOB, CHAT)).toEqual({ error: null, occasion: null });
    blocked = false;
    conversation = { ...conversation!, isGroup: true };
    expect(await getGiftOccasionChip(BOB, CHAT)).toEqual({ error: null, occasion: null });
  });
});
