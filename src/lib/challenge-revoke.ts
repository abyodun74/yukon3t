import type { TransactionClient } from "@/lib/prisma";
import { revokeGiftSend } from "@/lib/gift-revoke";

// Taking a challenge's awards back (Gift Universe Phase B, src/lib/challenges.ts). Its own small module, like
// gift-revoke.ts, so the moderation code that calls it (removeModeratedContent) doesn't pull in the delivery side's
// push and realtime senders. Everything here runs inside the caller's transaction, next to its AuditLog row.

/**
 * Revokes one Champion award (never deletes it): a purchase not yet delivered can no longer be (PENDING -> REVOKED,
 * so deliverGiftPurchase's guarded claim finds nothing), and the send and every item it gave are revoked through the
 * same revokeGiftSend a moderator's gift removal uses (which also takes the badge off the profile if it was worn).
 */
export async function revokeChallengeAward(tx: TransactionClient, sendId: string, now = new Date()) {
  await tx.giftPurchase.updateMany({ where: { send: { id: sendId }, status: "PENDING" }, data: { status: "REVOKED" } });
  return revokeGiftSend(tx, sendId, now);
}

export type CancelledChallenge = {
  hostId: string | null;
  circleId: string | null;
  liveStreamId: string | null;
  /** It had a result (DECIDED) before this cancel. */
  wasDecided: boolean;
  winnerIds: string[];
};

/**
 * Cancels a challenge, whoever asks (its host / declarer, or a site admin reversing it from the report queue: `byAdmin`):
 * CANCELLED, every award it gave revoked, and every winner's CHALLENGE_RESULT bell row removed. The winner rows stay as
 * the record of what was declared; a cancelled challenge no longer counts for anything (its CHALLENGE_WIN occasion
 * ends with it, since that needs a DECIDED challenge). Null when there is no such challenge; a challenge already
 * cancelled is left as it is.
 */
export async function cancelChallengeInTx(
  tx: TransactionClient,
  challengeId: string,
  by: { userId: string | null; byAdmin: boolean },
  now = new Date(),
): Promise<CancelledChallenge | null> {
  const challenge = await tx.challenge.findUnique({
    where: { id: challengeId },
    select: {
      id: true,
      status: true,
      hostId: true,
      circleId: true,
      liveStreamId: true,
      winners: { select: { userId: true, awardSendId: true } },
    },
  });
  if (!challenge) return null;
  const out: CancelledChallenge = {
    hostId: challenge.hostId,
    circleId: challenge.circleId,
    liveStreamId: challenge.liveStreamId,
    wasDecided: challenge.status === "DECIDED",
    winnerIds: challenge.winners.map((w) => w.userId),
  };
  if (challenge.status === "CANCELLED") return out;
  const claimed = await tx.challenge.updateMany({
    where: { id: challenge.id, status: { not: "CANCELLED" } },
    data: { status: "CANCELLED", cancelledAt: now, cancelledById: by.userId, cancelledByAdmin: by.byAdmin },
  });
  if (claimed.count !== 1) return out;
  for (const winner of challenge.winners) {
    if (winner.awardSendId) await revokeChallengeAward(tx, winner.awardSendId, now);
  }
  await tx.notification.deleteMany({ where: { challengeId: challenge.id, type: "CHALLENGE_RESULT" } });
  return out;
}
