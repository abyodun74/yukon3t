import type { TransactionClient } from "@/lib/prisma";
import { deliverGiftPurchase } from "@/lib/gift-delivery";
import { CHAMPION_AWARD_SKU } from "@/lib/gifts-data";
import { challengeResultHref } from "@/lib/challenges";
import { sendPushToUser } from "@/lib/push";
import { sendFcmActivityToUser } from "@/lib/fcm";
import { activityLine, nameOrSomeone } from "@/lib/push-text";
import { notifyBadgeChange } from "@/lib/realtime-server";
import { captureError } from "@/lib/error-tracking";
import type { Locale } from "@/lib/i18n/locales";

// The Champion award of a challenge win (Gift Universe Phase B, src/lib/challenges.ts), and the winners' one notice.
// An award is an ordinary gift purchase + send created by the app itself (provider SYSTEM_AWARD, no buyer, no sender),
// delivered by THE one delivery path, deliverGiftPurchase (src/lib/gift-delivery.ts), which knows nothing about why it
// was given. Cosmetic only: no cash value, not transferable, never sold. Taking one back is challenge-revoke.ts.

/** The provider transaction id of a winner row's award: one award per winner row, ever (unique per provider). */
export function championAwardTxnId(winnerRowId: string): string {
  return `challenge-award:${winnerRowId}`;
}

/**
 * Inside the declaring transaction: one PENDING Champion award per NEW winner row (a purchase of 0 and its send to the
 * winner, AWAITING_PAYMENT like any gift before delivery), each linked to its row through a guarded claim on
 * ChallengeWinner.awardSendId, so a row is awarded at most once (its providerTxnId is unique too). Returns the purchases
 * to deliver once the transaction has committed. Nothing when the award product is missing or switched off: the
 * result still stands, only without a badge.
 */
export async function createChampionAwardsInTx(
  tx: TransactionClient,
  challengeId: string,
  winners: { id: string; userId: string }[],
): Promise<string[]> {
  if (winners.length === 0) return [];
  const product = await tx.giftProduct.findFirst({
    where: { sku: CHAMPION_AWARD_SKU, active: true, webPriceMinor: 0 },
    select: { id: true, currency: true },
  });
  if (!product) return [];
  const purchaseIds: string[] = [];
  for (const winner of winners) {
    const purchase = await tx.giftPurchase.create({
      data: {
        buyerId: null,
        productId: product.id,
        provider: "SYSTEM_AWARD",
        providerTxnId: championAwardTxnId(winner.id),
        status: "PENDING",
        amountMinor: 0,
        currency: product.currency,
        rawRef: `challenge:${challengeId}`,
        send: {
          create: {
            senderId: null,
            recipientId: winner.userId,
            message: null,
            messageModeration: "PUBLISHED",
            context: "DIRECT",
            status: "AWAITING_PAYMENT",
          },
        },
      },
      select: { id: true, send: { select: { id: true } } },
    });
    const claimed = await tx.challengeWinner.updateMany({
      where: { id: winner.id, awardSendId: null },
      data: { awardSendId: purchase.send!.id },
    });
    if (claimed.count !== 1) throw new Error("challenge award already linked");
    purchaseIds.push(purchase.id);
  }
  return purchaseIds;
}

/**
 * After the transaction: delivers each award through deliverGiftPurchase. Best-effort: a failure leaves the purchase
 * PENDING (never half-given) and is reported; deliverGiftPurchase's own guarded claim makes a retry deliver it once.
 */
export async function deliverChallengeAwards(purchaseIds: string[]): Promise<void> {
  for (const id of purchaseIds) {
    try {
      await deliverGiftPurchase(id);
    } catch (err) {
      console.error("[challenges] award delivery failed", err);
      await captureError(err, { where: "deliverChallengeAwards", purchaseId: id });
    }
  }
}

/**
 * After the transaction that wrote their CHALLENGE_RESULT bell rows: the winners' push (web + FCM) and badge refresh.
 * Best-effort; the push carries the bell row's own link (challengeResultHref) and the declarer's name only: never the
 * challenge's title or the Circle's name. Push senders apply each person's own notification settings.
 */
export async function pushChallengeResult(input: {
  declarer: { id: string; name: string | null };
  winnerIds: string[];
  circleSlug: string | null;
}): Promise<void> {
  for (const recipientId of input.winnerIds) {
    try {
      const url = challengeResultHref({ circleSlug: input.circleSlug, recipientId });
      const payload = (locale: Locale) => ({
        title: nameOrSomeone(input.declarer.name, locale),
        body: activityLine("CHALLENGE_RESULT", locale),
        url,
      });
      await sendPushToUser(recipientId, payload);
      await sendFcmActivityToUser(recipientId, (locale) => ({ ...payload(locale), type: "CHALLENGE_RESULT" }));
      await notifyBadgeChange(recipientId);
    } catch (err) {
      console.error("[challenges] winner notice failed", err);
      await captureError(err, { where: "pushChallengeResult", recipientId });
    }
  }
}
