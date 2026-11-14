import { beforeEach, describe, expect, it, vi } from "vitest";

// "Export my data" (exportMyData) now carries the requester's own gifts and challenges (src/lib/gift-export.ts):
// sections present, only exact fields (no User row), a received gift's sender shown no more than the recipient's own
// Gifts area shows it, the hidden-chats rule (left out unless the PIN unlock is live), nobody blocked either way named,
// and every list capped with a truncation note.
const ME = "user_me";
const BLOCKED = "user_blocked";
const HIDDEN_PEER = "user_hidden_peer";
const FRIEND = "user_friend";
const HIDDEN_CONV = "conv_hidden";

const me = { id: ME, isAppReviewDemo: false };
let hiddenUnlocked = false;
let hiddenState = { conversationIds: [] as string[], peerIds: [] as string[] };
let blocks: { blockerId: string; blockedId: string }[] = [];
let sentRows: unknown[] = [];
let receivedRows: unknown[] = [];
let hostedRows: unknown[] = [];
let participantRows: { challengeId: string; joinedAt: Date }[] = [];
let winnerRows: { challengeId: string; createdAt: Date }[] = [];
let joinedChallengeRows: unknown[] = [];
let pinRows: unknown[] = [];
let occasionRows: unknown[] = [];
const calls: Record<string, unknown[]> = {};
const record = (name: string, args: unknown) => {
  (calls[name] ??= []).push(args);
};

// What a careless `include` or spread would leak: present on every person fixture, must never reach the file.
const SECRETS = { email: "leak@example.com", phone: "+15550100", birthDate: new Date("1990-01-01"), passwordHash: "hash" };
const person = (id: string, name: string, status = "ACTIVE") => ({ id, name, username: `${name.toLowerCase()}_u`, status, ...SECRETS });
const item = (slug: string) => ({ slug, kind: "STICKER", universe: "LOVE", assetKey: "rose", ...SECRETS });
const product = (sku: string, slug: string) => ({ sku, isBox: false, universe: "LOVE", webPriceMinor: 0, items: [{ quantity: 1, item: item(slug) }] });

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: async (args: { select?: unknown; include?: unknown }) => {
        record("user.findUnique", args);
        if (args.select) {
          return {
            giftsFrom: "CONNECTIONS",
            giftAnniversaryOptIn: true,
            giftCultureOccasions: false,
            equippedFrameItem: item("frame-gold"),
            equippedBadgeItem: null,
          };
        }
        return { id: ME, name: "Me", avatarUrl: null, reportsFiled: [] };
      },
    },
    block: { findMany: async () => blocks },
    giftShowcasePin: { findMany: async () => pinRows },
    giftSelfOccasion: { findMany: async (a: { take: number }) => (record("giftSelfOccasion.findMany", a), occasionRows.slice(0, a.take)) },
    giftSend: {
      findMany: async (args: { where: { senderId?: string; recipientId?: string }; take: number }) => {
        record("giftSend.findMany", args);
        return (args.where.senderId ? sentRows : receivedRows).slice(0, args.take);
      },
    },
    challenge: {
      findMany: async (args: { where: { hostId?: string }; take: number }) => {
        record("challenge.findMany", args);
        return (args.where.hostId ? hostedRows : joinedChallengeRows).slice(0, args.take);
      },
    },
    challengeParticipant: { findMany: async (a: { take: number }) => participantRows.slice(0, a.take) },
    challengeWinner: { findMany: async (a: { take: number }) => winnerRows.slice(0, a.take) },
    message: { findMany: async () => [] },
  },
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ signOut: vi.fn() }));
vi.mock("@/lib/auth-guards", () => ({
  requireUser: async () => me,
  getPasswordHash: vi.fn(),
  isPasswordResetRequired: vi.fn(),
}));
vi.mock("@/lib/account-reauth", () => ({ verifyAccountReauth: async () => ({ ok: true }) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true }));
vi.mock("@/lib/hidden-chats", () => ({
  isHiddenUnlocked: async () => hiddenUnlocked,
  getHiddenState: async () => hiddenState,
}));
vi.mock("@/lib/avatar-storage", () => ({ absoluteAvatarUrl: (u: string | null) => u }));
vi.mock("@/lib/ambient-access", () => ({ activeWidgetTokensOf: vi.fn() }));
vi.mock("@/lib/passwords", () => ({ hashPassword: vi.fn(), verifyPassword: vi.fn() }));
vi.mock("@/lib/trust", () => ({ recomputeTrustScore: vi.fn() }));
vi.mock("@/lib/moderation", () => ({ moderateText: vi.fn() }));
vi.mock("@/lib/embeddings", () => ({ updateUserEmbedding: vi.fn() }));
vi.mock("@/lib/device-id", () => ({ getDeviceId: vi.fn(), getDeviceLabel: vi.fn() }));
vi.mock("@/lib/device-trust", () => ({ evaluateDevice: vi.fn(), trustDevice: vi.fn(), touchKnownDevice: vi.fn() }));
vi.mock("@/lib/device-challenge", () => ({ createDeviceChallenge: vi.fn(), verifyDeviceChallenge: vi.fn() }));
vi.mock("@/lib/client-ip", () => ({ getClientIp: async () => "203.0.113.1" }));
vi.mock("@/lib/bot-gate", () => ({ passesBotGate: async () => ({ ok: true }) }));
vi.mock("@/lib/account-media", () => ({ collectAccountMedia: vi.fn(), deleteAccountMedia: vi.fn() }));

import { exportMyData } from "./profile";
import { GIFT_EXPORT_LIMITS, receivedGiftFrom, senderSideGiftStatus } from "@/lib/gift-export";

const T = new Date("2026-11-10T12:00:00Z");

function received(over: Record<string, unknown>) {
  return {
    message: "Congrats!",
    context: "DIRECT",
    status: "OPENED",
    deliveredAt: T,
    openedAt: T,
    revokedAt: null,
    thanksForSendId: null,
    sender: person(FRIEND, "Friend"),
    purchase: { provider: "ADMIN_GRANT", amountMinor: 0, providerTxnId: "txn_secret", product: product("single.rose", "rose") },
    owned: [{ editionNumber: 7, revokedAt: null, item: { slug: "rose" } }],
    ...over,
  };
}
function sent(over: Record<string, unknown>) {
  return {
    message: "For you",
    context: "DIRECT",
    status: "DELIVERED",
    createdAt: T,
    deliveredAt: T,
    openedAt: null,
    thanksForSendId: null,
    recipient: person(FRIEND, "Friend"),
    purchase: { provider: "ADMIN_GRANT", product: product("single.rose", "rose") },
    ...over,
  };
}

async function exportGifts() {
  const result = await exportMyData({ password: "x" });
  expect(result.error).toBeNull();
  const raw = result.data as string;
  return { raw, gifts: JSON.parse(raw).giftsAndChallenges };
}

beforeEach(() => {
  hiddenUnlocked = false;
  hiddenState = { conversationIds: [], peerIds: [] };
  blocks = [];
  sentRows = [];
  receivedRows = [];
  hostedRows = [];
  participantRows = [];
  winnerRows = [];
  joinedChallengeRows = [];
  pinRows = [];
  occasionRows = [];
  for (const key of Object.keys(calls)) delete calls[key];
});

describe("exportMyData: gifts and challenges", () => {
  it("has every section, with the user's settings, equipped items, showcase and occasions", async () => {
    pinRows = [
      { position: 0, createdAt: T, ownedGift: { ownerId: ME, revokedAt: null, editionNumber: 3, send: { status: "OPENED" }, item: item("rose") } },
      // A stale pin (revoked) is left out, as on the profile.
      { position: 1, createdAt: T, ownedGift: { ownerId: ME, revokedAt: T, editionNumber: null, send: { status: "OPENED" }, item: item("orchid") } },
    ];
    occasionRows = [{ kind: "GRADUATION", declaredAt: T, removedAt: null }];
    const { gifts } = await exportGifts();
    expect(Object.keys(gifts).sort()).toEqual(
      ["challengesHosted", "challengesJoined", "equipped", "giftsReceived", "giftsSent", "selfOccasions", "settings", "showcase"].sort(),
    );
    expect(gifts.settings).toEqual({ giftsFrom: "CONNECTIONS", anniversaryOptIn: true, cultureOccasionPrompts: false });
    expect(gifts.equipped.frame).toMatchObject({ slug: "frame-gold", kind: "STICKER", universe: "LOVE" });
    expect(gifts.equipped.badge).toBeNull();
    expect(gifts.showcase).toHaveLength(1);
    expect(gifts.showcase[0]).toMatchObject({ position: 0, editionNumber: 3, item: { slug: "rose" } });
    expect(gifts.selfOccasions).toEqual({ items: [{ kind: "GRADUATION", declaredAt: T.toISOString(), removedAt: null }], truncated: false, limit: 100 });
  });

  it("never puts a User row, contact data or a purchase record in the file", async () => {
    sentRows = [sent({})];
    receivedRows = [received({})];
    hostedRows = [
      { title: "Quiz", description: null, status: "DECIDED", circleId: "c1", createdAt: T, decidedAt: T, cancelledAt: null, _count: { participants: 4 }, winners: [{ user: person(FRIEND, "Friend") }] },
    ];
    const { raw, gifts } = await exportGifts();
    for (const secret of ["leak@example.com", "+15550100", "1990-01-01", "passwordHash", "txn_secret", "amountMinor", "webPriceMinor", FRIEND]) {
      expect(raw).not.toContain(secret);
    }
    expect(gifts.giftsSent.items[0].to).toEqual({ name: "Friend", username: "friend_u" });
    expect(gifts.challengesHosted.items[0].winners).toEqual([{ name: "Friend", username: "friend_u" }]);
    // Every gift/challenge query uses an exact select, never include.
    for (const name of ["giftSend.findMany", "challenge.findMany"]) {
      for (const args of calls[name] ?? []) {
        expect(args).toHaveProperty("select");
        expect(args).not.toHaveProperty("include");
      }
    }
    const recipientSelect = (calls["giftSend.findMany"] as { select: { recipient?: unknown } }[]).find((a) => a.select.recipient)!.select.recipient;
    expect(recipientSelect).toEqual({ select: { id: true, name: true, username: true, status: true } });
  });

  it("shows a received gift's sender only as the recipient's Gifts area does: display name, award or deleted", async () => {
    receivedRows = [
      received({}),
      received({ purchase: { provider: "SYSTEM_AWARD", product: product("award.arena-champion", "arena-champion") }, sender: null }),
      received({ sender: null }),
      // Hidden or revoked: the app shows no sender and no note for these.
      received({ status: "HIDDEN_BY_RECIPIENT" }),
      received({ status: "REVOKED", revokedAt: T, openedAt: null }),
    ];
    const { raw, gifts } = await exportGifts();
    const rows = gifts.giftsReceived.items;
    expect(rows[0].from).toEqual({ name: "Friend" });
    expect(rows[0].from).not.toHaveProperty("username");
    expect(rows[0]).toMatchObject({ note: "Congrats!", status: "OPENED", copies: [{ item: "rose", editionNumber: 7, revoked: false }] });
    expect(rows[1].from).toBe("award");
    expect(rows[2].from).toBe("deleted");
    expect(rows[3]).toMatchObject({ from: "not_shown", note: null, status: "HIDDEN", hidden: true, revoked: false });
    expect(rows[4]).toMatchObject({ from: "not_shown", note: null, status: "REVOKED", revoked: true });
    expect(raw).not.toContain("friend_u");
    // Only gifts the recipient was actually given are read.
    const receivedWhere = (calls["giftSend.findMany"] as { where: { recipientId?: string; status?: unknown } }[]).find((a) => a.where.recipientId)!.where;
    expect(receivedWhere.status).toEqual({ in: ["DELIVERED", "OPENED", "HIDDEN_BY_RECIPIENT", "REVOKED"] });
  });

  it("never names anyone blocked either way (sent, received, challenge winners) and drops challenges by a blocked host", async () => {
    blocks = [{ blockerId: BLOCKED, blockedId: ME }];
    sentRows = [sent({ recipient: person(BLOCKED, "Blocker") })];
    receivedRows = [received({ sender: person(BLOCKED, "Blocker") })];
    hostedRows = [
      { title: "Quiz", description: null, status: "DECIDED", circleId: null, createdAt: T, decidedAt: T, cancelledAt: null, _count: { participants: 3 }, winners: [{ user: person(BLOCKED, "Blocker") }] },
    ];
    participantRows = [{ challengeId: "ch1", joinedAt: T }];
    const { raw, gifts } = await exportGifts();
    expect(raw).not.toContain("Blocker");
    expect(raw).not.toContain("blocker_u");
    expect(gifts.giftsSent.items[0].to).toBe("not_shown");
    expect(gifts.giftsReceived.items[0].from).toBe("not_shown");
    expect(gifts.challengesHosted.items[0].winners).toEqual(["not_shown"]);
    const joinedQuery = (calls["challenge.findMany"] as { where: { id?: unknown; OR?: unknown } }[]).find((a) => a.where.id)!;
    expect(joinedQuery.where.OR).toEqual([{ hostId: null }, { hostId: { notIn: [BLOCKED] } }]);
  });

  it("leaves out gifts tied to a hidden chat or hidden peer unless the PIN unlock is live", async () => {
    hiddenState = { conversationIds: [HIDDEN_CONV], peerIds: [HIDDEN_PEER] };
    hostedRows = [
      { title: "Quiz", description: null, status: "DECIDED", circleId: "c1", createdAt: T, decidedAt: T, cancelledAt: null, _count: { participants: 3 }, winners: [{ user: person(HIDDEN_PEER, "Secret") }] },
    ];
    const { raw, gifts } = await exportGifts();
    const sendQueries = (calls["giftSend.findMany"] as { where: { senderId?: string; AND: unknown[] } }[]).map((a) => a.where);
    const sentWhere = sendQueries.find((w) => w.senderId)!;
    const receivedWhere = sendQueries.find((w) => !w.senderId)!;
    const chatFilter = { OR: [{ conversationId: null }, { conversationId: { notIn: [HIDDEN_CONV] } }] };
    expect(sentWhere.AND).toEqual([chatFilter, { recipientId: { notIn: [HIDDEN_PEER] } }]);
    expect(receivedWhere.AND).toEqual([chatFilter, { OR: [{ senderId: null }, { senderId: { notIn: [HIDDEN_PEER] } }] }]);
    // A hidden peer is never named either.
    expect(gifts.challengesHosted.items[0].winners).toEqual(["not_shown"]);
    expect(raw).not.toContain("Secret");

    // With the unlock live, nothing is filtered (the caller passes an empty hidden state).
    hiddenUnlocked = true;
    for (const key of Object.keys(calls)) delete calls[key];
    const unlocked = await exportGifts();
    for (const args of calls["giftSend.findMany"] as { where: { AND: unknown[] } }[]) expect(args.where.AND).toEqual([]);
    expect(unlocked.gifts.challengesHosted.items[0].winners).toEqual([{ name: "Secret", username: "secret_u" }]);
  });

  it("caps every list at its most recent N and says when it was cut", async () => {
    sentRows = Array.from({ length: GIFT_EXPORT_LIMITS.giftsSent + 5 }, () => sent({}));
    receivedRows = Array.from({ length: 3 }, () => received({}));
    occasionRows = Array.from({ length: GIFT_EXPORT_LIMITS.selfOccasions + 1 }, () => ({ kind: "MILESTONE", declaredAt: T, removedAt: T }));
    const { gifts } = await exportGifts();
    expect(gifts.giftsSent.items).toHaveLength(GIFT_EXPORT_LIMITS.giftsSent);
    expect(gifts.giftsSent).toMatchObject({ truncated: true, limit: GIFT_EXPORT_LIMITS.giftsSent });
    expect(gifts.giftsReceived).toMatchObject({ truncated: false });
    expect(gifts.giftsReceived.items).toHaveLength(3);
    expect(gifts.selfOccasions).toMatchObject({ truncated: true, limit: GIFT_EXPORT_LIMITS.selfOccasions });
    expect(gifts.selfOccasions.items).toHaveLength(GIFT_EXPORT_LIMITS.selfOccasions);
    for (const args of calls["giftSend.findMany"] as { take: number; orderBy: unknown }[]) {
      expect(args.orderBy).toEqual({ createdAt: "desc" });
      expect(args.take).toBe(GIFT_EXPORT_LIMITS.giftsSent + 1);
    }
  });

  it("lists challenges joined or won, with won only for a decided one", async () => {
    participantRows = [
      { challengeId: "a", joinedAt: T },
      { challengeId: "b", joinedAt: T },
    ];
    winnerRows = [
      { challengeId: "a", createdAt: T },
      { challengeId: "b", createdAt: T },
    ];
    joinedChallengeRows = [
      { id: "a", title: "Trivia night", status: "DECIDED", circleId: "c1", createdAt: T, decidedAt: T, cancelledAt: null },
      { id: "b", title: "Cancelled one", status: "CANCELLED", circleId: null, createdAt: T, decidedAt: T, cancelledAt: T },
    ];
    const { gifts } = await exportGifts();
    expect(gifts.challengesJoined.items).toEqual([
      expect.objectContaining({ title: "Trivia night", status: "DECIDED", context: "CIRCLE", role: "participant", won: true }),
      expect.objectContaining({ title: "Cancelled one", status: "CANCELLED", context: "LIVE", won: false }),
    ]);
  });

  it("shows a sent gift's state only as the sender sees it in the app", async () => {
    sentRows = [
      sent({ context: "CHAT", status: "OPENED", openedAt: T }),
      sent({ context: "DIRECT", status: "OPENED", openedAt: T }),
      sent({ context: "DIRECT", status: "HIDDEN_BY_RECIPIENT", openedAt: T }),
      sent({ context: "CHAT", status: "REVOKED" }),
      sent({ status: "UNDELIVERABLE", deliveredAt: null }),
      sent({ recipient: person("gone", "Gone", "DELETED") }),
    ];
    const { gifts } = await exportGifts();
    const rows = gifts.giftsSent.items;
    expect(rows[0]).toMatchObject({ status: "OPENED", openedAt: T.toISOString(), note: "For you", gift: { sku: "single.rose" } });
    expect(rows[1]).toMatchObject({ status: "DELIVERED", openedAt: null });
    expect(rows[2]).toMatchObject({ status: "DELIVERED", openedAt: null });
    expect(rows[3].status).toBe("UNAVAILABLE");
    expect(rows[4].status).toBe("NOT_DELIVERED");
    expect(rows[5].to).toBe("not_shown");
  });
});

describe("gift export rules", () => {
  it("senderSideGiftStatus never reveals a report, a revoke or a hide outside a chat", () => {
    expect(senderSideGiftStatus("REVOKED", "DIRECT")).toBe("UNAVAILABLE");
    expect(senderSideGiftStatus("HIDDEN_BY_RECIPIENT", "LIVE")).toBe("DELIVERED");
    expect(senderSideGiftStatus("HIDDEN_BY_RECIPIENT", "CHAT")).toBe("HIDDEN");
    expect(senderSideGiftStatus("AWAITING_PAYMENT", "CHAT")).toBe("PENDING");
  });
  it("receivedGiftFrom names only the sender's display name, only for a gift the recipient can see", () => {
    const sender = { id: FRIEND, name: "Friend" };
    expect(receivedGiftFrom({ status: "DELIVERED", provider: "FREE", sender, withheldIds: new Set() })).toEqual({ name: "Friend" });
    expect(receivedGiftFrom({ status: "DELIVERED", provider: "FREE", sender, withheldIds: new Set([FRIEND]) })).toBe("not_shown");
    expect(receivedGiftFrom({ status: "REVOKED", provider: "FREE", sender, withheldIds: new Set() })).toBe("not_shown");
  });
});
