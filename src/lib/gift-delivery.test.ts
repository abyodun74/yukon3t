import { beforeEach, describe, expect, it, vi } from "vitest";

// deliverGiftPurchase (src/lib/gift-delivery.ts) against an in-memory database: delivered once however often it is
// called, a box expands into its items, the rules are re-read at delivery, and the after-effects (bell + push, chat
// card through createNonE2eeMessage, live signal) never fail a delivery.

type Party = {
  id: string;
  name: string | null;
  status: string;
  isAdmin: boolean;
  isGuestPreview: boolean;
  birthDate: Date | null;
  giftsFrom: "EVERYONE" | "CONNECTIONS" | "NOBODY";
};
type Purchase = { id: string; status: string; paidAt: Date | null; productId: string };
type Send = {
  id: string;
  purchaseId: string;
  status: string;
  context: "DIRECT" | "CHAT" | "LIVE";
  conversationId: string | null;
  liveStreamId: string | null;
  senderId: string | null;
  recipientId: string;
  deliveredAt: Date | null;
};

const adult = new Date("1990-01-01T00:00:00Z");
let users: Record<string, Party>;
let purchases: Record<string, Purchase>;
let sends: Record<string, Send>;
let products: Record<string, { itemId: string; quantity: number; item: { kind: string; assetKey: string } }[]>;
let owned: { ownerId: string; itemId: string; sendId: string }[];
let notifications: Record<string, unknown>[];
let connected: boolean;
let blocked: boolean;
let hiddenPeers: string[];

const createNonE2eeMessage = vi.fn();
const afterMessageSent = vi.fn();
const sendPushToUser = vi.fn();
const sendFcmActivityToUser = vi.fn();
const publishEvent = vi.fn();
const notifyBadgeChange = vi.fn();
const captureError = vi.fn();

vi.mock("@/lib/blocks", () => ({ isBlockedEitherWay: async () => blocked }));
vi.mock("@/lib/non-e2ee-message", () => ({ createNonE2eeMessage: (d: unknown) => createNonE2eeMessage(d) }));
vi.mock("@/lib/after-message-sent", () => ({ afterMessageSent: (a: unknown) => afterMessageSent(a) }));
vi.mock("@/lib/hidden-chats", () => ({
  getHiddenPeerIds: async () => hiddenPeers,
  getMembersHidingConversation: async () => [],
}));
vi.mock("@/lib/push", () => ({ sendPushToUser: (...a: unknown[]) => sendPushToUser(...a) }));
vi.mock("@/lib/fcm", () => ({ sendFcmActivityToUser: (...a: unknown[]) => sendFcmActivityToUser(...a) }));
vi.mock("@/lib/realtime-server", () => ({
  publishEvent: (...a: unknown[]) => publishEvent(...a),
  notifyBadgeChange: (...a: unknown[]) => notifyBadgeChange(...a),
}));
vi.mock("@/lib/error-tracking", () => ({ captureError: (...a: unknown[]) => captureError(...a) }));
vi.mock("@/lib/prisma", () => {
  const prisma = {
    giftPurchase: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const p = purchases[where.id];
        if (!p) return null;
        const send = Object.values(sends).find((s) => s.purchaseId === p.id);
        return {
          id: p.id,
          status: p.status,
          product: { items: products[p.productId] },
          send: send
            ? {
                id: send.id,
                status: send.status,
                context: send.context,
                conversationId: send.conversationId,
                liveStreamId: send.liveStreamId,
                sender: send.senderId ? users[send.senderId] : null,
                recipient: users[send.recipientId],
              }
            : null,
        };
      },
      updateMany: async ({ where, data }: { where: { id: string; status: string }; data: Partial<Purchase> }) => {
        const p = purchases[where.id];
        if (!p || p.status !== where.status) return { count: 0 };
        Object.assign(p, data);
        return { count: 1 };
      },
    },
    giftSend: {
      update: async ({ where, data }: { where: { id: string }; data: Partial<Send> }) => Object.assign(sends[where.id], data),
      updateMany: async ({ where, data }: { where: { id: string; status: string }; data: Partial<Send> }) => {
        const s = sends[where.id];
        if (!s || s.status !== where.status) return { count: 0 };
        Object.assign(s, data);
        return { count: 1 };
      },
    },
    ownedGift: {
      createMany: async ({ data }: { data: { ownerId: string; itemId: string; sendId: string }[] }) => {
        owned.push(...data);
        return { count: data.length };
      },
    },
    connection: { findFirst: async () => (connected ? { id: "conn" } : null) },
    notification: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        notifications.push(data);
        return { id: `n${notifications.length}` };
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  };
  return { prisma };
});

import { deliverGiftPurchase } from "@/lib/gift-delivery";

function setup(over: Partial<Send> = {}, productId = "single") {
  purchases = { p1: { id: "p1", status: "PENDING", paidAt: null, productId } };
  sends = {
    s1: {
      id: "s1",
      purchaseId: "p1",
      status: "AWAITING_PAYMENT",
      context: "DIRECT",
      conversationId: null,
      liveStreamId: null,
      senderId: "alice",
      recipientId: "bob",
      deliveredAt: null,
      ...over,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  users = {
    alice: { id: "alice", name: "Alice", status: "ACTIVE", isAdmin: true, isGuestPreview: false, birthDate: adult, giftsFrom: "CONNECTIONS" },
    bob: { id: "bob", name: "Bob", status: "ACTIVE", isAdmin: true, isGuestPreview: false, birthDate: adult, giftsFrom: "CONNECTIONS" },
  };
  products = {
    single: [{ itemId: "gift_item_wave", quantity: 1, item: { kind: "STICKER", assetKey: "wave" } }],
    box: [
      { itemId: "gift_item_heart-burst", quantity: 1, item: { kind: "STICKER", assetKey: "heart-burst" } },
      { itemId: "gift_item_rose", quantity: 2, item: { kind: "STICKER", assetKey: "rose" } },
      { itemId: "gift_item_confetti", quantity: 1, item: { kind: "LIVE_EFFECT", assetKey: "confetti" } },
      { itemId: "gift_item_gold-ring-frame", quantity: 1, item: { kind: "FRAME", assetKey: "gold-ring-frame" } },
    ],
  };
  owned = [];
  notifications = [];
  connected = true;
  blocked = false;
  hiddenPeers = [];
  createNonE2eeMessage.mockResolvedValue({ error: null, id: "m1" });
  setup();
});

describe("deliverGiftPurchase", () => {
  it("delivers once however many times it is called: one set of owned gifts, one notification", async () => {
    expect(await deliverGiftPurchase("p1")).toBe("delivered");
    expect(await deliverGiftPurchase("p1")).toBe("already_done");
    expect(owned).toEqual([{ ownerId: "bob", itemId: "gift_item_wave", sendId: "s1" }]);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ recipientId: "bob", actorId: "alice", type: "GIFT_RECEIVED" });
    expect(sendPushToUser).toHaveBeenCalledTimes(1);
    expect(purchases.p1.status).toBe("PAID");
    expect(sends.s1.status).toBe("DELIVERED");
  });

  it("delivers once when two calls race (the guarded PENDING -> PAID claim decides)", async () => {
    const results = await Promise.all([deliverGiftPurchase("p1"), deliverGiftPurchase("p1")]);
    expect(results.sort()).toEqual(["already_done", "delivered"]);
    expect(owned).toHaveLength(1);
    expect(notifications).toHaveLength(1);
  });

  it("gives every item of a box, each as many times as it holds", async () => {
    setup({}, "box");
    expect(await deliverGiftPurchase("p1")).toBe("delivered");
    expect(owned.map((o) => o.itemId).sort()).toEqual(
      ["gift_item_confetti", "gift_item_gold-ring-frame", "gift_item_heart-burst", "gift_item_rose", "gift_item_rose"].sort(),
    );
    expect(owned.every((o) => o.ownerId === "bob" && o.sendId === "s1")).toBe(true);
  });

  it("marks the send UNDELIVERABLE when a block appeared after the gift was asked for", async () => {
    blocked = true;
    expect(await deliverGiftPurchase("p1")).toBe("undeliverable");
    expect(sends.s1.status).toBe("UNDELIVERABLE");
    expect(owned).toEqual([]);
    expect(notifications).toEqual([]);
    expect(sendPushToUser).not.toHaveBeenCalled();
    // Claimed all the same, so a retry can't deliver it later.
    expect(await deliverGiftPurchase("p1")).toBe("already_done");
    expect(owned).toEqual([]);
  });

  it("re-reads the recipient's own rules at delivery (giftsFrom, gate), but not the sender's gate", async () => {
    users.bob.giftsFrom = "NOBODY";
    expect(await deliverGiftPurchase("p1")).toBe("undeliverable");

    setup();
    users.bob.giftsFrom = "CONNECTIONS";
    users.alice.isAdmin = false; // the sender lost access after asking: what was asked for still lands
    expect(await deliverGiftPurchase("p1")).toBe("delivered");

    setup();
    users.bob.isAdmin = false; // gifts are off for the recipient: never delivered
    expect(await deliverGiftPurchase("p1")).toBe("undeliverable");
  });

  it("never delivers to an under-18 who isn't a connection", async () => {
    users.bob.birthDate = new Date("2012-01-01T00:00:00Z");
    users.bob.giftsFrom = "EVERYONE";
    connected = false;
    expect(await deliverGiftPurchase("p1")).toBe("undeliverable");
  });

  it("answers not_found for an unknown purchase and touches nothing", async () => {
    expect(await deliverGiftPurchase("nope")).toBe("not_found");
    expect(owned).toEqual([]);
  });

  it("writes a gift sent from a chat as a card through createNonE2eeMessage, quietly", async () => {
    setup({ context: "CHAT", conversationId: "c1" });
    expect(await deliverGiftPurchase("p1")).toBe("delivered");
    expect(createNonE2eeMessage).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "c1", senderId: "alice", giftSendId: "s1", content: "" }),
    );
    expect(afterMessageSent).toHaveBeenCalledWith(expect.objectContaining({ conversationId: "c1", quiet: true }));
    expect(notifications[0]).toMatchObject({ conversationId: "c1" });
  });

  it("still delivers when the chat turned secret (no card, the gift is in the Gifts area)", async () => {
    setup({ context: "CHAT", conversationId: "c1" });
    createNonE2eeMessage.mockResolvedValue({ error: "secret_chat" });
    expect(await deliverGiftPurchase("p1")).toBe("delivered");
    expect(afterMessageSent).not.toHaveBeenCalled();
    expect(owned).toHaveLength(1);
  });

  it("signals the live room with a bare `gift` kind for a gift sent in a live stream", async () => {
    setup({ context: "LIVE", liveStreamId: "ls1" });
    expect(await deliverGiftPurchase("p1")).toBe("delivered");
    expect(publishEvent).toHaveBeenCalledWith("live-stream:ls1", "changed", { kind: "gift" });
  });

  it("sends a neutral push and no named row when the recipient hides their chat with the sender", async () => {
    hiddenPeers = ["alice"];
    expect(await deliverGiftPurchase("p1")).toBe("delivered");
    expect(notifications).toEqual([]);
    expect(sendPushToUser).toHaveBeenCalledTimes(1);
    expect(sendFcmActivityToUser).toHaveBeenCalledTimes(1);
  });

  it("never fails a delivery over a notification error", async () => {
    sendPushToUser.mockRejectedValue(new Error("push down"));
    expect(await deliverGiftPurchase("p1")).toBe("delivered");
    expect(owned).toHaveLength(1);
    expect(captureError).toHaveBeenCalled();
  });
});
