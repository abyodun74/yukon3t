import { beforeEach, describe, expect, it, vi } from "vitest";

// Numbered editions in deliverGiftPurchase (src/lib/gift-delivery.ts): every EDITION copy takes the next number of its
// item in delivery order, under a per-item advisory lock, so concurrent deliveries never share or skip a number; a
// limited edition that has given every copy makes later gifts undeliverable; other items get no number at all. The
// database is in memory and pg_advisory_xact_lock is emulated (transactions holding the same key run one at a time).

type Owned = { ownerId: string; itemId: string; sendId: string; editionNumber?: number };
type ItemRow = { kind: string; assetKey: string; rarity: string; editionSize: number | null };

const adult = new Date("1990-01-01T00:00:00Z");
const party = (id: string) => ({
  id,
  name: id,
  status: "ACTIVE",
  isAdmin: true,
  isGuestPreview: false,
  birthDate: adult,
  giftsFrom: "EVERYONE",
});

let purchases: Record<string, { status: string; productId: string; sendId: string }>;
let sends: Record<string, { status: string }>;
let products: Record<string, { itemId: string; quantity: number; item: ItemRow }[]>;
let owned: Owned[];
const lockTails = new Map<string, Promise<void>>();
const lockedKeys: string[] = [];

const tick = () => new Promise((r) => setTimeout(r, 1));

vi.mock("@/lib/blocks", () => ({ isBlockedEitherWay: async () => false }));
vi.mock("@/lib/non-e2ee-message", () => ({ createNonE2eeMessage: vi.fn() }));
vi.mock("@/lib/after-message-sent", () => ({ afterMessageSent: vi.fn() }));
vi.mock("@/lib/hidden-chats", () => ({ getHiddenPeerIds: async () => [], getMembersHidingConversation: async () => [] }));
vi.mock("@/lib/push", () => ({ sendPushToUser: vi.fn() }));
vi.mock("@/lib/fcm", () => ({ sendFcmActivityToUser: vi.fn() }));
vi.mock("@/lib/realtime-server", () => ({ publishEvent: vi.fn(), notifyBadgeChange: vi.fn() }));
vi.mock("@/lib/error-tracking", () => ({ captureError: vi.fn() }));
vi.mock("@/lib/prisma", () => {
  function txClient(heldLocks: { release: () => void; done: Promise<void> }) {
    return {
      $executeRaw: async (_strings: TemplateStringsArray, key: string) => {
        lockedKeys.push(key);
        const previous = lockTails.get(key) ?? Promise.resolve();
        lockTails.set(key, heldLocks.done);
        await previous;
        return 1;
      },
      giftPurchase: {
        updateMany: async ({ where, data }: { where: { id: string; status: string }; data: { status: string } }) => {
          const p = purchases[where.id];
          if (!p || p.status !== where.status) return { count: 0 };
          p.status = data.status;
          return { count: 1 };
        },
      },
      giftSend: {
        update: async ({ where, data }: { where: { id: string }; data: { status: string } }) => Object.assign(sends[where.id], data),
        updateMany: async ({ where, data }: { where: { id: string; status: string }; data: { status: string } }) => {
          const s = sends[where.id];
          if (!s || s.status !== where.status) return { count: 0 };
          s.status = data.status;
          return { count: 1 };
        },
      },
      ownedGift: {
        aggregate: async ({ where }: { where: { itemId: string } }) => {
          await tick(); // let other deliveries interleave here unless the lock serializes them
          const numbers = owned.filter((o) => o.itemId === where.itemId && o.editionNumber != null).map((o) => o.editionNumber!);
          return { _max: { editionNumber: numbers.length ? Math.max(...numbers) : null } };
        },
        createMany: async ({ data }: { data: Owned[] }) => {
          await tick();
          for (const row of data) {
            if (row.editionNumber != null && owned.some((o) => o.itemId === row.itemId && o.editionNumber === row.editionNumber)) {
              throw Object.assign(new Error("unique (itemId, editionNumber)"), { code: "P2002" });
            }
          }
          owned.push(...data);
          return { count: data.length };
        },
      },
    };
  }
  const prisma = {
    giftPurchase: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const p = purchases[where.id];
        if (!p) return null;
        return {
          id: where.id,
          status: p.status,
          product: { items: products[p.productId] },
          send: {
            id: p.sendId,
            status: sends[p.sendId].status,
            context: "DIRECT",
            conversationId: null,
            liveStreamId: null,
            sender: party("alice"),
            recipient: party(`bob-${where.id}`),
          },
        };
      },
    },
    connection: { findFirst: async () => ({ id: "conn" }) },
    notification: { create: async () => ({ id: "n" }) },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      let release!: () => void;
      const done = new Promise<void>((r) => (release = r));
      try {
        return await fn(txClient({ release, done }));
      } finally {
        release();
      }
    },
  };
  return { prisma };
});

import { deliverGiftPurchase, giftEditionLockKey } from "@/lib/gift-delivery";

const ORCHID: ItemRow = { kind: "STICKER", assetKey: "gold-orchid", rarity: "EDITION", editionSize: null };
const WAVE: ItemRow = { kind: "STICKER", assetKey: "wave", rarity: "STANDARD", editionSize: null };

function addPurchases(n: number, productId: string) {
  for (let i = 0; i < n; i++) {
    const id = `${productId}-p${i}`;
    purchases[id] = { status: "PENDING", productId, sendId: `${id}-s` };
    sends[`${id}-s`] = { status: "AWAITING_PAYMENT" };
  }
  return Object.keys(purchases).filter((id) => id.startsWith(`${productId}-p`));
}

beforeEach(() => {
  purchases = {};
  sends = {};
  owned = [];
  lockTails.clear();
  lockedKeys.length = 0;
  products = {
    orchid: [{ itemId: "gift_item_gold-orchid", quantity: 1, item: ORCHID }],
    limited: [{ itemId: "gift_item_limited", quantity: 1, item: { ...ORCHID, editionSize: 3 } }],
    pair: [
      { itemId: "gift_item_gold-orchid", quantity: 2, item: ORCHID },
      { itemId: "gift_item_wave", quantity: 1, item: WAVE },
    ],
    wave: [{ itemId: "gift_item_wave", quantity: 1, item: WAVE }],
  };
});

describe("numbered editions at delivery", () => {
  it("gives concurrent deliveries the numbers 1..n, each once, under the item's lock", async () => {
    const ids = addPurchases(12, "orchid");
    const outcomes = await Promise.all(ids.map((id) => deliverGiftPurchase(id)));
    expect(outcomes.every((o) => o === "delivered")).toBe(true);
    const numbers = owned.map((o) => o.editionNumber).sort((a, b) => a! - b!);
    expect(numbers).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(new Set(lockedKeys)).toEqual(new Set([giftEditionLockKey("gift_item_gold-orchid")]));
  });

  it("numbers two copies in one box consecutively, and leaves ordinary items unnumbered", async () => {
    addPurchases(1, "orchid");
    await deliverGiftPurchase("orchid-p0");
    const [pairId] = addPurchases(1, "pair");
    expect(await deliverGiftPurchase(pairId)).toBe("delivered");
    const box = owned.filter((o) => o.sendId === `${pairId}-s`);
    expect(box.filter((o) => o.itemId === "gift_item_gold-orchid").map((o) => o.editionNumber)).toEqual([2, 3]);
    expect(box.find((o) => o.itemId === "gift_item_wave")).not.toHaveProperty("editionNumber");
  });

  it("never takes a lock or a number for a gift with no edition item", async () => {
    const [id] = addPurchases(1, "wave");
    expect(await deliverGiftPurchase(id)).toBe("delivered");
    expect(lockedKeys).toEqual([]);
    expect(owned[0]).not.toHaveProperty("editionNumber");
  });

  it("stops a limited edition at its size: later gifts are undeliverable, nothing is given", async () => {
    const ids = addPurchases(5, "limited");
    const outcomes = await Promise.all(ids.map((id) => deliverGiftPurchase(id)));
    expect(outcomes.filter((o) => o === "delivered")).toHaveLength(3);
    expect(outcomes.filter((o) => o === "undeliverable")).toHaveLength(2);
    expect(owned.map((o) => o.editionNumber).sort()).toEqual([1, 2, 3]);
    expect(Object.values(sends).filter((s) => s.status === "UNDELIVERABLE")).toHaveLength(2);
  });
});
