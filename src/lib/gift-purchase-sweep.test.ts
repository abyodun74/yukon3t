import { beforeEach, describe, expect, it, vi } from "vitest";

// The stuck coin purchase sweep (src/lib/gift-purchase-sweep.ts) with the real coin wallet (src/lib/coin-wallet.ts)
// against an in-memory database whose $transaction rolls back on a throw (the coin-wallet.test.ts pattern). Delivery is
// a stand-in with deliverGiftPurchase's contract: a guarded PENDING -> PAID claim inside one transaction, and for a gift
// the rules now refuse, the real refundCoinPurchaseInTx in that same transaction. Checked: a stuck purchase is retried
// once or refunded once, a delivered one is never refunded, a refunded one is never delivered, concurrent sweeps and a
// sweep racing the sender's own retry resolve each purchase exactly once, and a run is bounded and idempotent.

type Wallet = { userId: string; balance: number };
type Send = { id: string; recipientId: string; status: string; message: string | null; context: string };
type Purchase = {
  id: string;
  buyerId: string | null;
  productId: string;
  provider: string;
  providerTxnId: string;
  status: string;
  amountMinor: number;
  currency: string;
  quantity: number;
  createdAt: Date;
  paidAt?: Date | null;
  refundedAt?: Date | null;
  send: Send | null;
};
type Ledger = { id: string; userId: string; kind: string; amount: number; balanceAfter: number; idempotencyKey: string; purchaseId?: string | null };

let db: { wallets: Map<string, Wallet>; purchases: Purchase[]; ledger: Ledger[] };
let seq = 0;
/** Purchase ids another (simulated) transaction holds a row lock on right now. */
let rowLocks: Set<string>;

class UniqueError extends Error {
  code = "P2002";
}

function snapshot() {
  return structuredClone({ wallets: [...db.wallets.entries()], purchases: db.purchases, ledger: db.ledger });
}
function restore(snap: ReturnType<typeof snapshot>) {
  db = { wallets: new Map(snap.wallets), purchases: snap.purchases, ledger: snap.ledger };
}
const byId = (id: string) => db.purchases.find((p) => p.id === id);

type PurchaseWhere = {
  id?: string;
  provider?: string;
  status?: string;
  createdAt?: { lt: Date };
  provider_providerTxnId?: { provider: string; providerTxnId: string };
};
const matches = (p: Purchase, where: PurchaseWhere) =>
  (where.id === undefined || p.id === where.id) &&
  (where.provider === undefined || p.provider === where.provider) &&
  (where.status === undefined || p.status === where.status) &&
  (where.createdAt === undefined || p.createdAt < where.createdAt.lt);

const findMany = vi.fn();
const client = {
  coinWallet: {
    findUnique: async ({ where }: { where: { userId: string } }) => {
      const w = db.wallets.get(where.userId);
      return w ? { balance: w.balance } : null;
    },
    updateMany: async ({ where, data }: { where: { userId: string; balance: { gte: number } }; data: { balance: { decrement: number } } }) => {
      const w = db.wallets.get(where.userId);
      if (!w || w.balance < where.balance.gte) return { count: 0 };
      w.balance -= data.balance.decrement;
      return { count: 1 };
    },
    upsert: async ({ where, create, update }: { where: { userId: string }; create: Wallet; update: { balance: { increment: number } } }) => {
      const w = db.wallets.get(where.userId);
      if (w) w.balance += update.balance.increment;
      else db.wallets.set(where.userId, { ...create });
      return { balance: db.wallets.get(where.userId)!.balance };
    },
  },
  giftPurchase: {
    findUnique: async ({ where }: { where: PurchaseWhere }) => {
      const p = where.provider_providerTxnId
        ? db.purchases.find(
            (x) => x.provider === where.provider_providerTxnId!.provider && x.providerTxnId === where.provider_providerTxnId!.providerTxnId,
          )
        : byId(where.id!);
      if (!p) return null;
      return {
        id: p.id,
        buyerId: p.buyerId,
        productId: p.productId,
        quantity: p.quantity,
        status: p.status,
        send: p.send ? { id: p.send.id, recipientId: p.send.recipientId, status: p.send.status } : null,
      };
    },
    findMany: async (args: { where: PurchaseWhere; take: number; orderBy: { createdAt: "asc" } }) => {
      findMany(args);
      return db.purchases
        .filter((p) => matches(p, args.where))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .slice(0, args.take)
        .map((p) => ({ id: p.id, createdAt: p.createdAt, send: p.send ? { id: p.send.id } : null }));
    },
    create: async ({ data }: { data: Omit<Purchase, "id" | "send" | "createdAt"> & { send: { create: Send & { senderId: string } } } }) => {
      if (db.purchases.some((p) => p.provider === data.provider && p.providerTxnId === data.providerTxnId)) throw new UniqueError("dup");
      const id = `purchase${++seq}`;
      const sendId = `send${seq}`;
      const { send, ...rest } = data;
      db.purchases.push({ ...rest, id, createdAt: new Date(), send: { ...send.create, id: sendId } });
      return { id, send: { id: sendId } };
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<Purchase> }) => {
      Object.assign(byId(where.id)!, data);
      return { id: where.id };
    },
    updateMany: async ({ where, data }: { where: PurchaseWhere; data: Partial<Purchase> }) => {
      const rows = db.purchases.filter((p) => matches(p, where));
      for (const p of rows) Object.assign(p, data);
      return { count: rows.length };
    },
  },
  giftSend: {
    updateMany: async ({ where, data }: { where: { purchaseId?: string; id?: string; status: string }; data: Partial<Send> }) => {
      const rows = db.purchases
        .map((p) => (p.send && (where.purchaseId === undefined || p.id === where.purchaseId) && (where.id === undefined || p.send.id === where.id) ? p.send : null))
        .filter((s): s is Send => s !== null && s.status === where.status);
      for (const s of rows) Object.assign(s, data);
      return { count: rows.length };
    },
  },
  coinLedgerEntry: {
    create: async ({ data }: { data: Omit<Ledger, "id"> }) => {
      if (db.ledger.some((l) => l.userId === data.userId && l.idempotencyKey === data.idempotencyKey)) throw new UniqueError("dup");
      const row = { ...data, id: `ledger${++seq}` };
      db.ledger.push(row);
      return { id: row.id };
    },
  },
  // refundStuckCoinPurchase's `SELECT ... WHERE "id" = $1 FOR UPDATE SKIP LOCKED`: no row when another transaction
  // holds it (or it doesn't exist); the row whatever its status otherwise (the guarded update decides).
  $queryRaw: async (strings: TemplateStringsArray, id: string) => {
    expect(strings.join("?")).toContain("FOR UPDATE SKIP LOCKED");
    const p = byId(id);
    if (!p || rowLocks.has(id)) return [];
    return [{ id: p.id, buyerId: p.buyerId, amountMinor: p.amountMinor }];
  },
  // One transaction at a time (the row locks a real one takes serialize them the same way), rolled back on a throw.
  $transaction: (fn: (tx: unknown) => Promise<unknown>) => {
    const run = txQueue.then(async () => {
      const snap = snapshot();
      try {
        return await fn(client);
      } catch (err) {
        restore(snap);
        throw err;
      }
    });
    txQueue = run.catch(() => undefined);
    return run;
  },
};
let txQueue: Promise<unknown> = Promise.resolve();

vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return client;
  },
}));
vi.mock("@/lib/prisma-errors", () => ({ isUniqueConstraintError: (err: unknown) => (err as { code?: string })?.code === "P2002" }));
const captureError = vi.fn();
vi.mock("@/lib/error-tracking", () => ({ captureError: (...a: unknown[]) => captureError(...a) }));

// deliverGiftPurchase's contract (src/lib/gift-delivery.ts): read first (outside any transaction), then one transaction
// with the guarded PENDING -> PAID claim; a refused gift's send goes UNDELIVERABLE and a COINS one is refunded in it.
let deliveryMode: "ok" | "refuse" | "throw";
const deliveries = vi.fn();
vi.mock("@/lib/gift-delivery", () => ({
  deliverGiftPurchase: async (purchaseId: string, now = new Date()) => {
    const { refundCoinPurchaseInTx } = await import("@/lib/coin-wallet");
    const purchase = byId(purchaseId);
    if (!purchase?.send) return "not_found";
    if (purchase.status !== "PENDING") return "already_done";
    await Promise.resolve(); // the rule reads: another path can move first
    if (deliveryMode === "throw") throw new Error("transient database error");
    return client.$transaction(async (tx) => {
      const claimed = await client.giftPurchase.updateMany({ where: { id: purchaseId, status: "PENDING" }, data: { status: "PAID", paidAt: now } });
      if (claimed.count !== 1) return "already_done";
      if (deliveryMode === "refuse") {
        await client.giftSend.updateMany({ where: { id: purchase.send!.id, status: "AWAITING_PAYMENT" }, data: { status: "UNDELIVERABLE" } });
        await refundCoinPurchaseInTx(tx as never, { id: purchase.id, buyerId: purchase.buyerId, amountMinor: purchase.amountMinor }, now);
        return "undeliverable";
      }
      await client.giftSend.updateMany({ where: { id: purchase.send!.id, status: "AWAITING_PAYMENT" }, data: { status: "DELIVERED" } });
      deliveries(purchaseId);
      return "delivered";
    });
  },
}));

import {
  GIFT_PURCHASE_REFUND_AFTER_MS,
  GIFT_PURCHASE_STUCK_AFTER_MS,
  stuckPurchaseAction,
  sweepStuckGiftPurchases,
} from "@/lib/gift-purchase-sweep";
import { deliverGiftPurchase } from "@/lib/gift-delivery";
import { getCoinBalance, refundStuckCoinPurchase, spendCoinsOnGift } from "@/lib/coin-wallet";

const ME = "cme00000000001";
const BOB = "cbob0000000001";
const NOW = new Date("2026-12-02T12:00:00Z");
const MIN = 60_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

/** Spends `total` coins on a gift to Bob (as createGiftIntent would) and backdates the purchase: a send whose delivery failed. */
async function stuckPurchase(createdAt: Date, total = 50, requestId = `req-${String(seq).padStart(10, "0")}`): Promise<string> {
  const spent = await spendCoinsOnGift({
    buyerId: ME,
    productId: "gift_product_sticker.rose",
    unitPrice: total,
    quantity: 1,
    total,
    clientRequestId: requestId,
    send: { recipientId: BOB, message: null, context: "DIRECT", conversationId: null, liveStreamId: null },
  });
  if (spent.outcome !== "created") throw new Error(`setup: ${spent.outcome}`);
  byId(spent.purchaseId)!.createdAt = createdAt;
  return spent.purchaseId;
}

const refundRows = () => db.ledger.filter((l) => l.kind === "REFUND");
const sweep = (over: Parameters<typeof sweepStuckGiftPurchases>[0] = {}) => sweepStuckGiftPurchases({ now: NOW, ...over });

beforeEach(() => {
  db = { wallets: new Map([[ME, { userId: ME, balance: 1000 }]]), purchases: [], ledger: [] };
  seq = 0;
  rowLocks = new Set();
  deliveryMode = "ok";
  deliveries.mockReset();
  findMany.mockReset();
  captureError.mockReset();
});

describe("stuckPurchaseAction", () => {
  it("waits, then retries, then refunds; a send that is gone is refunded straight away", () => {
    expect(stuckPurchaseAction({ createdAt: ago(GIFT_PURCHASE_STUCK_AFTER_MS - 1), hasSend: true }, NOW)).toBe("wait");
    expect(stuckPurchaseAction({ createdAt: ago(GIFT_PURCHASE_STUCK_AFTER_MS - 1), hasSend: false }, NOW)).toBe("wait");
    expect(stuckPurchaseAction({ createdAt: ago(GIFT_PURCHASE_STUCK_AFTER_MS), hasSend: true }, NOW)).toBe("retry");
    expect(stuckPurchaseAction({ createdAt: ago(GIFT_PURCHASE_REFUND_AFTER_MS - 1), hasSend: true }, NOW)).toBe("retry");
    expect(stuckPurchaseAction({ createdAt: ago(GIFT_PURCHASE_REFUND_AFTER_MS), hasSend: true }, NOW)).toBe("refund");
    expect(stuckPurchaseAction({ createdAt: ago(GIFT_PURCHASE_STUCK_AFTER_MS), hasSend: false }, NOW)).toBe("refund");
  });
});

describe("sweepStuckGiftPurchases", () => {
  it("only looks at COINS purchases PENDING past the stuck threshold, oldest first", async () => {
    const fresh = await stuckPurchase(ago(5 * MIN)); // too fresh: its own request may still be finishing it
    await sweep();
    expect(findMany.mock.calls[0][0]).toMatchObject({
      where: { provider: "COINS", status: "PENDING", createdAt: { lt: ago(GIFT_PURCHASE_STUCK_AFTER_MS) } },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
    expect(byId(fresh)!.status).toBe("PENDING");
    expect(deliveries).not.toHaveBeenCalled();
  });

  it("stuck then retried: delivered once, coins stay spent, no refund", async () => {
    const id = await stuckPurchase(ago(15 * MIN));
    expect(await sweep()).toMatchObject({ due: 1, delivered: 1, refunded: 0, failed: 0 });
    expect(byId(id)).toMatchObject({ status: "PAID", send: { status: "DELIVERED" } });
    expect(deliveries).toHaveBeenCalledTimes(1);
    expect(await getCoinBalance(ME)).toBe(950);
    expect(refundRows()).toHaveLength(0);
  });

  it("a retry the rules now refuse is refunded by the delivery itself, once", async () => {
    const id = await stuckPurchase(ago(15 * MIN));
    deliveryMode = "refuse";
    expect(await sweep()).toMatchObject({ due: 1, undeliverable: 1, refunded: 0 });
    expect(byId(id)).toMatchObject({ status: "REFUNDED", send: { status: "UNDELIVERABLE" } });
    expect(await getCoinBalance(ME)).toBe(1000);
    expect(refundRows()).toHaveLength(1);
  });

  it("a retry that throws stays PENDING, is reported, and is retried next run", async () => {
    const id = await stuckPurchase(ago(15 * MIN));
    deliveryMode = "throw";
    expect(await sweep()).toMatchObject({ due: 1, failed: 1, delivered: 0 });
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError.mock.calls[0][1]).toMatchObject({ action: "sweep-stuck-gift-purchases", step: "retry", purchaseId: id });
    expect(byId(id)!.status).toBe("PENDING");
    expect(await getCoinBalance(ME)).toBe(950);
    deliveryMode = "ok";
    expect(await sweep()).toMatchObject({ delivered: 1 });
    expect(byId(id)!.status).toBe("PAID");
  });

  it("stuck past the refund threshold: refunded once, with one REFUND row, the send marked undeliverable", async () => {
    const id = await stuckPurchase(ago(GIFT_PURCHASE_REFUND_AFTER_MS + MIN), 75);
    expect(await sweep()).toMatchObject({ due: 1, refunded: 1, delivered: 0 });
    expect(byId(id)).toMatchObject({ status: "REFUNDED", refundedAt: expect.any(Date), send: { status: "UNDELIVERABLE" } });
    expect(deliveries).not.toHaveBeenCalled();
    expect(await getCoinBalance(ME)).toBe(1000);
    expect(refundRows()).toEqual([expect.objectContaining({ userId: ME, amount: 75, balanceAfter: 1000, idempotencyKey: `refund:${id}`, purchaseId: id })]);
  });

  it("a purchase whose send went with the recipient's account is refunded as soon as it counts as stuck", async () => {
    const id = await stuckPurchase(ago(15 * MIN));
    byId(id)!.send = null;
    expect(await sweep()).toMatchObject({ due: 1, refunded: 1 });
    expect(byId(id)!.status).toBe("REFUNDED");
    expect(await getCoinBalance(ME)).toBe(1000);
  });

  it("a refunded purchase is never delivered later (the sender's late Try again included)", async () => {
    const id = await stuckPurchase(ago(GIFT_PURCHASE_REFUND_AFTER_MS + MIN));
    await sweep();
    expect(await deliverGiftPurchase(id)).toBe("already_done");
    expect(deliveries).not.toHaveBeenCalled();
    expect(byId(id)!.status).toBe("REFUNDED");
  });

  it("a delivered purchase is never refunded, not even by a direct refund call", async () => {
    const id = await stuckPurchase(ago(GIFT_PURCHASE_REFUND_AFTER_MS + MIN));
    expect(await deliverGiftPurchase(id)).toBe("delivered");
    expect(await sweep()).toMatchObject({ due: 0 });
    expect(await refundStuckCoinPurchase(id, NOW)).toBe("already_done");
    expect(byId(id)!.status).toBe("PAID");
    expect(await getCoinBalance(ME)).toBe(950);
    expect(refundRows()).toHaveLength(0);
  });

  it("is idempotent: a re-run finds nothing and changes nothing", async () => {
    await stuckPurchase(ago(15 * MIN));
    const old = await stuckPurchase(ago(GIFT_PURCHASE_REFUND_AFTER_MS + MIN));
    expect(await sweep()).toMatchObject({ due: 2, delivered: 1, refunded: 1 });
    const before = snapshot();
    expect(await sweep()).toEqual({ due: 0, delivered: 0, undeliverable: 0, refunded: 0, alreadyDone: 0, busy: 0, failed: 0, skipped: 0 });
    expect(snapshot()).toEqual(before);
    // Even a refund forced again by id writes nothing more.
    expect(await refundStuckCoinPurchase(old, NOW)).toBe("already_done");
    expect(refundRows()).toHaveLength(1);
  });

  it("two sweeps at once resolve each purchase exactly once", async () => {
    const retried = await stuckPurchase(ago(15 * MIN));
    const refunded = await stuckPurchase(ago(GIFT_PURCHASE_REFUND_AFTER_MS + MIN));
    const [a, b] = await Promise.all([sweep(), sweep()]);
    expect(a.delivered + b.delivered).toBe(1);
    expect(a.refunded + b.refunded).toBe(1);
    expect(a.alreadyDone + b.alreadyDone).toBe(2);
    expect(deliveries).toHaveBeenCalledTimes(1);
    expect(byId(retried)!.status).toBe("PAID");
    expect(byId(refunded)!.status).toBe("REFUNDED");
    expect(refundRows()).toHaveLength(1);
    expect(await getCoinBalance(ME)).toBe(950);
  });

  it("a sweep racing the sender's own retry delivers once", async () => {
    const id = await stuckPurchase(ago(15 * MIN));
    const [swept, manual] = await Promise.all([sweep(), deliverGiftPurchase(id)]);
    expect([swept.delivered, manual === "delivered" ? 1 : 0].reduce((x, y) => x + y)).toBe(1);
    expect(deliveries).toHaveBeenCalledTimes(1);
    expect(byId(id)!.status).toBe("PAID");
    expect(refundRows()).toHaveLength(0);
  });

  it("a refunding sweep racing the sender's retry: exactly one wins, never both", async () => {
    const id = await stuckPurchase(ago(GIFT_PURCHASE_REFUND_AFTER_MS + MIN));
    const [swept, manual] = await Promise.all([sweep(), deliverGiftPurchase(id)]);
    const delivered = manual === "delivered";
    expect(swept.refunded).toBe(delivered ? 0 : 1);
    expect(byId(id)!.status).toBe(delivered ? "PAID" : "REFUNDED");
    expect(refundRows()).toHaveLength(delivered ? 0 : 1);
    expect(deliveries).toHaveBeenCalledTimes(delivered ? 1 : 0);
    expect(await getCoinBalance(ME)).toBe(delivered ? 950 : 1000);
  });

  it("a row another transaction holds is skipped (busy), then refunded by the next run", async () => {
    const id = await stuckPurchase(ago(GIFT_PURCHASE_REFUND_AFTER_MS + MIN));
    rowLocks.add(id);
    expect(await sweep()).toMatchObject({ due: 1, busy: 1, refunded: 0 });
    expect(byId(id)!.status).toBe("PENDING");
    expect(await getCoinBalance(ME)).toBe(950);
    rowLocks.clear();
    expect(await sweep()).toMatchObject({ refunded: 1 });
    expect(await getCoinBalance(ME)).toBe(1000);
  });

  it("a refund that fails rolls back whole and is retried next run", async () => {
    const id = await stuckPurchase(ago(GIFT_PURCHASE_REFUND_AFTER_MS + MIN));
    // Something already holds this purchase's refund key: the ledger insert fails and the transaction rolls back.
    db.ledger.push({ id: "x", userId: ME, kind: "REFUND", amount: 1, balanceAfter: 951, idempotencyKey: `refund:${id}` });
    expect(await sweep()).toMatchObject({ failed: 1, refunded: 0 });
    expect(byId(id)).toMatchObject({ status: "PENDING", send: { status: "AWAITING_PAYMENT" } });
    expect(await getCoinBalance(ME)).toBe(950);
    expect(captureError).toHaveBeenCalledTimes(1);
  });

  it("is bounded: at most the batch per run, oldest first, and stops at the time budget", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) ids.push(await stuckPurchase(ago(GIFT_PURCHASE_REFUND_AFTER_MS + (10 - i) * MIN), 10));
    expect(await sweep({ batch: 3 })).toMatchObject({ due: 3, refunded: 3 });
    expect(db.purchases.filter((p) => p.status === "REFUNDED").map((p) => p.id)).toEqual(ids.slice(0, 3));

    // A clock that passes the budget after two purchases: the rest are left for the next run.
    let t = 0;
    const clock = () => (t += 10);
    expect(await sweep({ batch: 50, budgetMs: 25, clock })).toMatchObject({ due: 4, refunded: 2, skipped: 2 });
    expect(await sweep()).toMatchObject({ due: 2, refunded: 2 });
    expect(await getCoinBalance(ME)).toBe(1000);
    expect(refundRows()).toHaveLength(7);
  });
});
