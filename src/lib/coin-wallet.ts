import { prisma, type TransactionClient } from "@/lib/prisma";
import { isUniqueConstraintError } from "@/lib/prisma-errors";
import {
  COIN_BALANCE_MAX,
  COIN_CURRENCY,
  coinGrantKey,
  coinPurchaseKey,
  coinRefundKey,
  grantRefusal,
  sameCoinRequest,
} from "@/lib/coins";

// The server half of Y3T Coins (rules: src/lib/coins.ts). In a lib file, not a "use server" one: callers have done every
// authorization check (the admin gate for a grant; the gift gate, the send rules and the product for a spend) and pass
// the server's own price and total. Every balance change happens in ONE transaction with its ledger row:
// - a spend is a guarded decrement (balance >= total), so two spends at once can't take a wallet below zero, and the
//   purchase and its send are created in the same transaction under a unique idempotency key, so a double submit
//   can't spend twice;
// - a refund (a coin-paid gift that couldn't be delivered) is written inside deliverGiftPurchase's own transaction, at
//   most once (its ledger key is unique).
// Delivery itself (deliverGiftPurchase) runs after the spend commits; anything that goes wrong after that (an
// animation, a push, a chat card) never undoes a settled send.

/** A person's coin balance (0 without a wallet yet). */
export async function getCoinBalance(userId: string): Promise<number> {
  const wallet = await prisma.coinWallet.findUnique({
    where: { userId },
    select: { balance: true },
  });
  return wallet?.balance ?? 0;
}

export type CoinSpendInput = {
  buyerId: string;
  productId: string;
  /** The product's coin price, read from the database by the caller (never the browser's). */
  unitPrice: number;
  quantity: number;
  /** unitPrice x quantity, computed by the caller with coinTotal. */
  total: number;
  clientRequestId: string;
  send: {
    recipientId: string;
    message: string | null;
    context: "DIRECT" | "CHAT" | "LIVE";
    conversationId: string | null;
    liveStreamId: string | null;
  };
};

export type CoinSpendOutcome =
  | { outcome: "created"; purchaseId: string; sendId: string; balance: number }
  | {
      outcome: "duplicate";
      purchaseId: string;
      sendId: string;
      purchaseStatus: string;
      sendStatus: string;
      balance: number;
    }
  | { outcome: "key_conflict" }
  | { outcome: "insufficient"; balance: number };

/** The purchase already filed under a coin idempotency key, with what a retry needs to answer again. */
export async function findCoinPurchase(
  buyerId: string,
  clientRequestId: string,
) {
  return prisma.giftPurchase.findUnique({
    where: {
      provider_providerTxnId: {
        provider: "COINS",
        providerTxnId: coinPurchaseKey(buyerId, clientRequestId),
      },
    },
    select: {
      id: true,
      buyerId: true,
      productId: true,
      quantity: true,
      status: true,
      send: { select: { id: true, recipientId: true, status: true } },
    },
  });
}

async function duplicateOutcome(
  input: CoinSpendInput,
): Promise<CoinSpendOutcome> {
  const existing = await findCoinPurchase(input.buyerId, input.clientRequestId);
  if (
    !existing?.send ||
    !sameCoinRequest(
      {
        buyerId: existing.buyerId,
        productId: existing.productId,
        quantity: existing.quantity,
        recipientId: existing.send.recipientId,
      },
      {
        buyerId: input.buyerId,
        productId: input.productId,
        quantity: input.quantity,
        recipientId: input.send.recipientId,
      },
    )
  ) {
    return { outcome: "key_conflict" };
  }
  return {
    outcome: "duplicate",
    purchaseId: existing.id,
    sendId: existing.send.id,
    purchaseStatus: existing.status,
    sendStatus: existing.send.status,
    balance: await getCoinBalance(input.buyerId),
  };
}

class InsufficientCoins extends Error {
  constructor(readonly balance: number) {
    super("insufficient_coins");
  }
}

/**
 * Spends coins on one gift purchase, atomically: the guarded debit, the PENDING purchase (provider COINS, its
 * idempotency key as providerTxnId, amountMinor = coins, currency COIN_CURRENCY) with its AWAITING_PAYMENT send, and the
 * SPEND ledger row, all or nothing. The same request again (same buyer + request id) answers "duplicate" with what was
 * created the first time and spends nothing; a different request under the same key answers "key_conflict".
 */
export async function spendCoinsOnGift(
  input: CoinSpendInput,
): Promise<CoinSpendOutcome> {
  if (input.total !== input.unitPrice * input.quantity || input.total < 1)
    throw new Error("spendCoinsOnGift: bad total");
  const key = coinPurchaseKey(input.buyerId, input.clientRequestId);

  // A retry of a request that already went through: answer it again, spend nothing.
  const already = await findCoinPurchase(input.buyerId, input.clientRequestId);
  if (already) return duplicateOutcome(input);

  try {
    return await prisma.$transaction(async (tx) => {
      const debited = await tx.coinWallet.updateMany({
        where: { userId: input.buyerId, balance: { gte: input.total } },
        data: { balance: { decrement: input.total } },
      });
      if (debited.count !== 1) {
        const wallet = await tx.coinWallet.findUnique({
          where: { userId: input.buyerId },
          select: { balance: true },
        });
        throw new InsufficientCoins(wallet?.balance ?? 0);
      }
      const wallet = await tx.coinWallet.findUnique({
        where: { userId: input.buyerId },
        select: { balance: true },
      });
      const balance = wallet?.balance ?? 0;
      const purchase = await tx.giftPurchase.create({
        data: {
          buyerId: input.buyerId,
          productId: input.productId,
          provider: "COINS",
          providerTxnId: key,
          status: "PENDING",
          amountMinor: input.total,
          currency: COIN_CURRENCY,
          rawRef: "coins",
          quantity: input.quantity,
          send: {
            create: {
              senderId: input.buyerId,
              recipientId: input.send.recipientId,
              message: input.send.message,
              messageModeration: "PUBLISHED",
              context: input.send.context,
              conversationId: input.send.conversationId,
              liveStreamId: input.send.liveStreamId,
              status: "AWAITING_PAYMENT",
            },
          },
        },
        select: { id: true, send: { select: { id: true } } },
      });
      await tx.coinLedgerEntry.create({
        data: {
          userId: input.buyerId,
          kind: "SPEND",
          amount: -input.total,
          balanceAfter: balance,
          idempotencyKey: key,
          purchaseId: purchase.id,
        },
        select: { id: true },
      });
      return {
        outcome: "created" as const,
        purchaseId: purchase.id,
        sendId: purchase.send!.id,
        balance,
      };
    });
  } catch (err) {
    if (err instanceof InsufficientCoins)
      return { outcome: "insufficient", balance: err.balance };
    // Two submits of the same request raced past the check above: the loser's whole transaction (debit included) was
    // rolled back, so it answers as the duplicate it is.
    if (isUniqueConstraintError(err)) return duplicateOutcome(input);
    throw err;
  }
}

/**
 * Gives a coin-paid purchase's coins back, inside the caller's transaction (deliverGiftPurchase, when the gift turned
 * out to be undeliverable after its PENDING -> PAID claim): the purchase becomes REFUNDED, the buyer's wallet is
 * credited and one REFUND ledger row is written (its key is unique, so this can never run twice for one purchase). A
 * buyer whose account is gone has no wallet to credit: nothing to do.
 */
export async function refundCoinPurchaseInTx(
  tx: TransactionClient,
  purchase: { id: string; buyerId: string | null; amountMinor: number },
  now: Date,
): Promise<void> {
  await tx.giftPurchase.update({
    where: { id: purchase.id },
    data: { status: "REFUNDED", refundedAt: now },
    select: { id: true },
  });
  if (!purchase.buyerId || purchase.amountMinor < 1) return;
  const wallet = await tx.coinWallet.upsert({
    where: { userId: purchase.buyerId },
    create: { userId: purchase.buyerId, balance: purchase.amountMinor },
    update: { balance: { increment: purchase.amountMinor } },
    select: { balance: true },
  });
  await tx.coinLedgerEntry.create({
    data: {
      userId: purchase.buyerId,
      kind: "REFUND",
      amount: purchase.amountMinor,
      balanceAfter: wallet.balance,
      idempotencyKey: coinRefundKey(purchase.id),
      purchaseId: purchase.id,
    },
    select: { id: true },
  });
}

export type CoinGrantOutcome =
  | { outcome: "granted"; balance: number; entryId: string }
  | { outcome: "duplicate"; balance: number }
  | { outcome: "invalid_amount" }
  | { outcome: "balance_cap"; balance: number };

class GrantCap extends Error {
  constructor(readonly balance: number) {
    super("balance_cap");
  }
}

/**
 * An admin grants coins (the caller checked requireAdmin and the recipient). One transaction: the wallet credit (capped
 * at COIN_BALANCE_MAX), the GRANT ledger row under the form's own key (a double submit grants once) and the
 * COINS_GRANTED audit row. Nothing is ever sold: this is the only way coins come into existence.
 */
export async function grantCoins(input: {
  adminId: string;
  userId: string;
  amount: number;
  reason: string;
  formId: string;
}): Promise<CoinGrantOutcome> {
  const idempotencyKey = coinGrantKey(input.formId);
  const existing = await prisma.coinLedgerEntry.findUnique({
    where: { userId_idempotencyKey: { userId: input.userId, idempotencyKey } },
    select: { id: true },
  });
  if (existing)
    return {
      outcome: "duplicate",
      balance: await getCoinBalance(input.userId),
    };
  if (grantRefusal(input.amount, 0) === "invalid_amount")
    return { outcome: "invalid_amount" };

  // Two attempts: a first-ever wallet created by two transactions at once makes one of them fail on the wallet's key;
  // that one simply runs again (its own ledger key is what decides "duplicate").
  for (let attempt = 0; ; attempt++) {
    try {
      return await grantOnce(input, idempotencyKey);
    } catch (err) {
      if (err instanceof GrantCap)
        return { outcome: "balance_cap", balance: err.balance };
      if (!isUniqueConstraintError(err)) throw err;
      const done = await prisma.coinLedgerEntry.findUnique({
        where: {
          userId_idempotencyKey: { userId: input.userId, idempotencyKey },
        },
        select: { id: true },
      });
      if (done)
        return {
          outcome: "duplicate",
          balance: await getCoinBalance(input.userId),
        };
      if (attempt >= 1) throw err;
    }
  }
}

function grantOnce(
  input: { adminId: string; userId: string; amount: number; reason: string },
  idempotencyKey: string,
): Promise<CoinGrantOutcome> {
  return prisma.$transaction(async (tx) => {
    const wallet = await tx.coinWallet.upsert({
      where: { userId: input.userId },
      create: { userId: input.userId, balance: input.amount },
      update: { balance: { increment: input.amount } },
      select: { balance: true },
    });
    if (wallet.balance > COIN_BALANCE_MAX)
      throw new GrantCap(wallet.balance - input.amount);
    const entry = await tx.coinLedgerEntry.create({
      data: {
        userId: input.userId,
        kind: "GRANT",
        amount: input.amount,
        balanceAfter: wallet.balance,
        idempotencyKey,
        grantedById: input.adminId,
        reason: input.reason,
      },
      select: { id: true },
    });
    await tx.auditLog.create({
      data: {
        targetId: input.userId,
        action: "COINS_GRANTED",
        reason: `Granted ${input.amount} Y3T Coins (ledger ${entry.id}, balance ${wallet.balance}): ${input.reason}`,
        performedBy: input.adminId,
      },
      select: { id: true },
    });
    return {
      outcome: "granted" as const,
      balance: wallet.balance,
      entryId: entry.id,
    };
  });
}
