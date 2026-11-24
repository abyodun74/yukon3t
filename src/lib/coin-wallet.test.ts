import { beforeEach, describe, expect, it, vi } from "vitest";

// src/lib/coin-wallet.ts against an in-memory database whose $transaction rolls back on a throw: a spend is all or
// nothing, never takes a wallet below zero, writes one ledger row, and a double submit spends once; a refund is written
// once; a grant is capped, audited and idempotent.

type Wallet = { userId: string; balance: number };
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
  refundedAt?: Date | null;
  send: { id: string; recipientId: string; status: string; message: string | null; context: string };
};
type Ledger = { id: string; userId: string; kind: string; amount: number; balanceAfter: number; idempotencyKey: string; purchaseId?: string | null; grantedById?: string | null; reason?: string | null };

let db: { wallets: Map<string, Wallet>; purchases: Purchase[]; ledger: Ledger[]; audit: Record<string, unknown>[] };
let seq = 0;

class UniqueError extends Error {
  code = "P2002";
}

function snapshot() {
  return structuredClone({ wallets: [...db.wallets.entries()], purchases: db.purchases, ledger: db.ledger, audit: db.audit });
}
function restore(snap: ReturnType<typeof snapshot>) {
  db = { wallets: new Map(snap.wallets), purchases: snap.purchases, ledger: snap.ledger, audit: snap.audit };
}

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
    findUnique: async ({ where }: { where: { provider_providerTxnId: { provider: string; providerTxnId: string } } }) => {
      const p = db.purchases.find(
        (x) => x.provider === where.provider_providerTxnId.provider && x.providerTxnId === where.provider_providerTxnId.providerTxnId,
      );
      return p
        ? { id: p.id, buyerId: p.buyerId, productId: p.productId, quantity: p.quantity, status: p.status, send: { id: p.send.id, recipientId: p.send.recipientId, status: p.send.status } }
        : null;
    },
    create: async ({ data }: { data: Omit<Purchase, "id" | "send"> & { send: { create: Purchase["send"] & { senderId: string } } } }) => {
      if (db.purchases.some((p) => p.provider === data.provider && p.providerTxnId === data.providerTxnId)) throw new UniqueError("dup");
      const id = `purchase${++seq}`;
      const sendId = `send${seq}`;
      const { send, ...rest } = data;
      db.purchases.push({ ...rest, id, send: { ...send.create, id: sendId } });
      return { id, send: { id: sendId } };
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<Purchase> }) => {
      Object.assign(db.purchases.find((p) => p.id === where.id)!, data);
      return { id: where.id };
    },
  },
  coinLedgerEntry: {
    findUnique: async ({ where }: { where: { userId_idempotencyKey: { userId: string; idempotencyKey: string } } }) =>
      db.ledger.find((l) => l.userId === where.userId_idempotencyKey.userId && l.idempotencyKey === where.userId_idempotencyKey.idempotencyKey) ?? null,
    create: async ({ data }: { data: Omit<Ledger, "id"> }) => {
      if (db.ledger.some((l) => l.userId === data.userId && l.idempotencyKey === data.idempotencyKey)) throw new UniqueError("dup");
      const row = { ...data, id: `ledger${++seq}` };
      db.ledger.push(row);
      return { id: row.id };
    },
  },
  auditLog: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      db.audit.push(data);
      return { id: `audit${++seq}` };
    },
  },
  // One transaction at a time (the wallet row lock a real spend takes serializes them the same way), rolled back on a
  // throw.
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

// A getter: vi.mock is hoisted above `client`, so the mock reads it only when coin-wallet.ts first uses prisma.
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return client;
  },
}));
vi.mock("@/lib/prisma-errors", () => ({ isUniqueConstraintError: (err: unknown) => (err as { code?: string })?.code === "P2002" }));

import { getCoinBalance, grantCoins, refundCoinPurchaseInTx, spendCoinsOnGift, type CoinSpendInput } from "@/lib/coin-wallet";
import { COIN_BALANCE_MAX } from "@/lib/coins";

const ME = "cme00000000001";
const BOB = "cbob0000000001";

const spend = (over: Partial<CoinSpendInput> = {}): CoinSpendInput => ({
  buyerId: ME,
  productId: "gift_product_sticker.rose",
  unitPrice: 25,
  quantity: 2,
  total: 50,
  clientRequestId: "req-0000000001",
  send: { recipientId: BOB, message: null, context: "DIRECT", conversationId: null, liveStreamId: null },
  ...over,
});

beforeEach(() => {
  db = { wallets: new Map([[ME, { userId: ME, balance: 120 }]]), purchases: [], ledger: [], audit: [] };
  seq = 0;
});

describe("spendCoinsOnGift", () => {
  it("debits, creates the PENDING purchase + send and one SPEND ledger row, all together", async () => {
    const result = await spendCoinsOnGift(spend());
    expect(result).toMatchObject({ outcome: "created", balance: 70 });
    expect(await getCoinBalance(ME)).toBe(70);
    expect(db.purchases).toHaveLength(1);
    expect(db.purchases[0]).toMatchObject({
      buyerId: ME,
      provider: "COINS",
      providerTxnId: `coins:${ME}:req-0000000001`,
      status: "PENDING",
      amountMinor: 50,
      currency: "Y3T_COIN",
      quantity: 2,
      send: { recipientId: BOB, status: "AWAITING_PAYMENT", context: "DIRECT" },
    });
    expect(db.ledger).toEqual([
      expect.objectContaining({ userId: ME, kind: "SPEND", amount: -50, balanceAfter: 70, idempotencyKey: `coins:${ME}:req-0000000001` }),
    ]);
  });

  it("refuses without enough coins and writes nothing (no wallet counts as zero)", async () => {
    expect(await spendCoinsOnGift(spend({ quantity: 5, total: 125 }))).toEqual({ outcome: "insufficient", balance: 120 });
    expect(await getCoinBalance(ME)).toBe(120);
    expect(db.purchases).toHaveLength(0);
    expect(db.ledger).toHaveLength(0);
    expect(await spendCoinsOnGift(spend({ buyerId: BOB }))).toEqual({ outcome: "insufficient", balance: 0 });
  });

  it("spends a wallet exactly to zero, never below", async () => {
    expect(await spendCoinsOnGift(spend({ unitPrice: 60, total: 120 }))).toMatchObject({ outcome: "created", balance: 0 });
    expect(await spendCoinsOnGift(spend({ clientRequestId: "req-0000000002", unitPrice: 1, quantity: 1, total: 1 }))).toEqual({
      outcome: "insufficient",
      balance: 0,
    });
  });

  it("a double submit of the same request spends once and answers the first purchase", async () => {
    const first = await spendCoinsOnGift(spend());
    const again = await spendCoinsOnGift(spend());
    expect(again).toMatchObject({ outcome: "duplicate", purchaseId: (first as { purchaseId: string }).purchaseId, balance: 70 });
    expect(await getCoinBalance(ME)).toBe(70);
    expect(db.purchases).toHaveLength(1);
    expect(db.ledger).toHaveLength(1);
  });

  it("two submits racing past the first check: the loser's debit is rolled back with its transaction", async () => {
    const [a, b] = await Promise.all([spendCoinsOnGift(spend()), spendCoinsOnGift(spend())]);
    expect([a.outcome, b.outcome].sort()).toEqual(["created", "duplicate"]);
    expect(await getCoinBalance(ME)).toBe(70);
    expect(db.purchases).toHaveLength(1);
    expect(db.ledger).toHaveLength(1);
  });

  it("the same request id for a different gift, person or quantity is a conflict, never a second spend", async () => {
    await spendCoinsOnGift(spend());
    expect(await spendCoinsOnGift(spend({ quantity: 1, total: 25 }))).toEqual({ outcome: "key_conflict" });
    expect(await spendCoinsOnGift(spend({ productId: "other" }))).toEqual({ outcome: "key_conflict" });
    expect(await getCoinBalance(ME)).toBe(70);
  });

  it("two different requests at once can't overdraw the wallet", async () => {
    const results = await Promise.all([
      spendCoinsOnGift(spend({ clientRequestId: "req-aaaaaaaa1", unitPrice: 50, quantity: 2, total: 100 })),
      spendCoinsOnGift(spend({ clientRequestId: "req-bbbbbbbb2", unitPrice: 50, quantity: 2, total: 100 })),
    ]);
    expect(results.map((r) => r.outcome).sort()).toEqual(["created", "insufficient"]);
    expect(await getCoinBalance(ME)).toBe(20);
  });

  it("refuses a total that isn't price x quantity (a caller bug, never a silent spend)", async () => {
    await expect(spendCoinsOnGift(spend({ total: 1 }))).rejects.toThrow("bad total");
    expect(await getCoinBalance(ME)).toBe(120);
  });
});

describe("refundCoinPurchaseInTx", () => {
  it("gives the coins back once, marks the purchase REFUNDED and writes one REFUND row", async () => {
    const created = (await spendCoinsOnGift(spend())) as { purchaseId: string };
    const purchase = { id: created.purchaseId, buyerId: ME, amountMinor: 50 };
    await client.$transaction((tx) => refundCoinPurchaseInTx(tx as never, purchase, new Date()));
    expect(await getCoinBalance(ME)).toBe(120);
    expect(db.purchases[0].status).toBe("REFUNDED");
    expect(db.ledger.map((l) => [l.kind, l.amount, l.balanceAfter])).toEqual([
      ["SPEND", -50, 70],
      ["REFUND", 50, 120],
    ]);
    // A second refund of the same purchase fails on its unique key, and its transaction changes nothing.
    await expect(client.$transaction((tx) => refundCoinPurchaseInTx(tx as never, purchase, new Date()))).rejects.toThrow();
    expect(await getCoinBalance(ME)).toBe(120);
  });

  it("credits nothing when the buyer's account is gone", async () => {
    const created = (await spendCoinsOnGift(spend())) as { purchaseId: string };
    await client.$transaction((tx) => refundCoinPurchaseInTx(tx as never, { id: created.purchaseId, buyerId: null, amountMinor: 50 }, new Date()));
    expect(db.ledger.filter((l) => l.kind === "REFUND")).toHaveLength(0);
    expect(db.purchases[0].status).toBe("REFUNDED");
  });
});

describe("grantCoins", () => {
  const grant = (over: Partial<Parameters<typeof grantCoins>[0]> = {}) =>
    grantCoins({ adminId: "cadmin00000001", userId: BOB, amount: 500, reason: "Launch test", formId: "form-00000001", ...over });

  it("credits a new or existing wallet, with a GRANT ledger row and an audit row", async () => {
    expect(await grant()).toMatchObject({ outcome: "granted", balance: 500 });
    expect(await grant({ formId: "form-00000002", amount: 250 })).toMatchObject({ outcome: "granted", balance: 750 });
    expect(db.ledger.map((l) => [l.kind, l.amount, l.balanceAfter, l.grantedById])).toEqual([
      ["GRANT", 500, 500, "cadmin00000001"],
      ["GRANT", 250, 750, "cadmin00000001"],
    ]);
    expect(db.audit).toHaveLength(2);
    expect(db.audit[0]).toMatchObject({ targetId: BOB, action: "COINS_GRANTED", performedBy: "cadmin00000001" });
  });

  it("grants once per form, however often it is submitted", async () => {
    await grant();
    expect(await grant()).toEqual({ outcome: "duplicate", balance: 500 });
    expect(await getCoinBalance(BOB)).toBe(500);
    expect(db.audit).toHaveLength(1);
  });

  it("never takes a wallet past the cap, and refuses a bad amount", async () => {
    db.wallets.set(BOB, { userId: BOB, balance: COIN_BALANCE_MAX - 100 });
    expect(await grant({ amount: 101 })).toEqual({ outcome: "balance_cap", balance: COIN_BALANCE_MAX - 100 });
    expect(await getCoinBalance(BOB)).toBe(COIN_BALANCE_MAX - 100);
    expect(db.ledger).toHaveLength(0);
    expect(db.audit).toHaveLength(0);
    expect(await grant({ amount: 0 })).toEqual({ outcome: "invalid_amount" });
  });
});
