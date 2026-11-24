import { prisma } from "@/lib/prisma";
import { captureError } from "@/lib/error-tracking";
import { deliverGiftPurchase, type GiftDeliveryOutcome } from "@/lib/gift-delivery";
import { refundStuckCoinPurchase, type StuckRefundOutcome } from "@/lib/coin-wallet";

// The backstop for coin-paid gifts left PENDING (run by the sweep-stuck-gift-purchases cron,
// src/app/api/cron/sweep-stuck-gift-purchases/route.ts). createGiftIntent spends the coins (purchase PENDING + send
// AWAITING_PAYMENT + SPEND row, one transaction) and then calls deliverGiftPurchase; if that throws (a transient database
// error, the function dying between the two) the purchase stays PENDING with its coins spent until the sender taps
// "Try again" with the same request id. This sweep resolves the ones nobody retried, each exactly once:
//
//   PENDING --deliverGiftPurchase claim--> PAID (send DELIVERED)                 [delivered]
//   PENDING --deliverGiftPurchase claim--> PAID -> REFUNDED (send UNDELIVERABLE) [rules now refuse: refunded in the
//                                                                                 same transaction as the refusal]
//   PENDING --refundStuckCoinPurchase-----> REFUNDED (send UNDELIVERABLE)        [too old, or its send is gone]
//
// Every arrow out of PENDING is a guarded "WHERE status = 'PENDING'" update, so whichever path (the sender's retry,
// this sweep, a second sweep running at the same time) gets there first is the only one that does anything: a delivered
// gift is never refunded, a refunded one is never delivered, and the refund's ledger key (refund:<purchaseId>) is unique.
// PAID, REFUNDED, REVOKED and MISMATCH are terminal for this sweep.

/** A PENDING coin purchase younger than this is left alone: its own request (or the sender's Try again) may still be finishing it. */
export const GIFT_PURCHASE_STUCK_AFTER_MS = 10 * 60_000;
/**
 * A PENDING coin purchase older than this is refunded instead of retried. With the cron every 10 minutes that is about
 * 11 delivery attempts first, enough to ride out a transient failure; a failure that lasts longer is not going away by
 * itself, and the sender gets their coins back rather than waiting indefinitely.
 */
export const GIFT_PURCHASE_REFUND_AFTER_MS = 2 * 60 * 60_000;
/** At most this many purchases per run, oldest first; a backlog clears over the following runs. */
export const GIFT_PURCHASE_SWEEP_BATCH = 50;
/** A run stops starting new purchases after this long (well inside the route's maxDuration of 60s). */
export const GIFT_PURCHASE_SWEEP_BUDGET_MS = 30_000;

export type StuckPurchaseAction = "wait" | "retry" | "refund";

/**
 * What the sweep does with one PENDING coin purchase. Pure. A purchase whose send is gone (the recipient's account was
 * deleted, which cascades to the send) can never be delivered: refunded as soon as it counts as stuck.
 */
export function stuckPurchaseAction(purchase: { createdAt: Date; hasSend: boolean }, now: Date): StuckPurchaseAction {
  const age = now.getTime() - purchase.createdAt.getTime();
  if (age < GIFT_PURCHASE_STUCK_AFTER_MS) return "wait";
  if (!purchase.hasSend || age >= GIFT_PURCHASE_REFUND_AFTER_MS) return "refund";
  return "retry";
}

export type GiftPurchaseSweepResult = {
  due: number;
  /** Retried and delivered now. */
  delivered: number;
  /** Retried, but the rules now refuse it: refunded inside the delivery (deliverGiftPurchase's own refund). */
  undeliverable: number;
  /** Too old (or its send is gone): coins given back by refundStuckCoinPurchase. */
  refunded: number;
  /** Someone else (the sender's retry, another sweep) finished it first. */
  alreadyDone: number;
  /** Its row was locked by another transaction at that moment: left for the next run. */
  busy: number;
  /** The retry or refund threw: left PENDING for the next run (reported to error tracking). */
  failed: number;
  /** Not reached because the time budget ran out: left for the next run. */
  skipped: number;
};

export type GiftPurchaseSweepOptions = {
  now?: Date;
  batch?: number;
  budgetMs?: number;
  /** Clock for the time budget (tests). */
  clock?: () => number;
};

/**
 * One run of the sweep: the oldest GIFT_PURCHASE_SWEEP_BATCH coin purchases PENDING for longer than
 * GIFT_PURCHASE_STUCK_AFTER_MS (through the ("status", "createdAt") index), one at a time, until the time budget runs
 * out. Safe to run repeatedly and concurrently (see the header).
 */
export async function sweepStuckGiftPurchases(options: GiftPurchaseSweepOptions = {}): Promise<GiftPurchaseSweepResult> {
  const now = options.now ?? new Date();
  const clock = options.clock ?? Date.now;
  const deadline = clock() + (options.budgetMs ?? GIFT_PURCHASE_SWEEP_BUDGET_MS);
  const due = await prisma.giftPurchase.findMany({
    where: {
      provider: "COINS",
      status: "PENDING",
      createdAt: { lt: new Date(now.getTime() - GIFT_PURCHASE_STUCK_AFTER_MS) },
    },
    orderBy: { createdAt: "asc" },
    take: options.batch ?? GIFT_PURCHASE_SWEEP_BATCH,
    select: { id: true, createdAt: true, send: { select: { id: true } } },
  });

  const result: GiftPurchaseSweepResult = {
    due: due.length,
    delivered: 0,
    undeliverable: 0,
    refunded: 0,
    alreadyDone: 0,
    busy: 0,
    failed: 0,
    skipped: 0,
  };
  for (const [index, row] of due.entries()) {
    if (clock() >= deadline) {
      result.skipped = due.length - index;
      break;
    }
    const action = stuckPurchaseAction({ createdAt: row.createdAt, hasSend: row.send !== null }, now);
    if (action === "wait") continue; // can't happen with the query above; kept so the rule lives in one place
    try {
      if (action === "retry") {
        count(result, await deliverGiftPurchase(row.id, new Date()));
      } else {
        count(result, await refundStuckCoinPurchase(row.id, new Date()));
      }
    } catch (err) {
      result.failed++;
      console.error(`[sweep-stuck-gift-purchases] ${action} failed for purchase ${row.id}`, err);
      await captureError(err, { action: "sweep-stuck-gift-purchases", step: action, purchaseId: row.id });
    }
  }
  return result;
}

function count(result: GiftPurchaseSweepResult, outcome: GiftDeliveryOutcome | StuckRefundOutcome) {
  switch (outcome) {
    case "delivered":
      result.delivered++;
      break;
    case "undeliverable":
      result.undeliverable++;
      break;
    case "refunded":
      result.refunded++;
      break;
    case "busy":
      result.busy++;
      break;
    // "not_found" (the row went away between the query and here) is as finished as "already_done".
    default:
      result.alreadyDone++;
  }
}
