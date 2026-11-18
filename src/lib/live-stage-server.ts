import type { TransactionClient } from "@/lib/prisma";
import { liveStageLockKey, stageSeatDecision } from "@/lib/live-stage";

type StageRole = "GUEST" | "COHOST";

/**
 * Takes one stage seat on a live stream, race-safe: run inside a transaction, it holds the stream's stage lock
 * (pg_advisory_xact_lock on liveStageLockKey) for the count and the write, so several people accepting invites, or the
 * host approving requests while an invite is accepted, can never take the stage past MAX_LIVE_STAGE. Every path that
 * puts someone on stage (respondToStageRequest, acceptLiveInvite) goes through this.
 *
 * Someone already holding a role that covers the one asked for (a co-host asked to be a guest, or the same role) keeps
 * it and takes no new seat. A guest moving up to co-host already holds a seat, so it is not counted twice either.
 */
export async function claimStageSeat(
  tx: TransactionClient,
  input: { liveStreamId: string; hostId: string; userId: string; role: StageRole; now?: Date },
): Promise<"admitted" | "already" | "full"> {
  const { liveStreamId, hostId, userId, role } = input;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${liveStageLockKey(liveStreamId)}))`;
  const existing = await tx.liveStreamViewer.findUnique({
    where: { liveStreamId_userId: { liveStreamId, userId } },
    select: { role: true },
  });
  if (existing?.role === "COHOST" || existing?.role === role) return "already";
  const alreadyOnStage = existing?.role === "GUEST";
  const othersOnStage = await tx.liveStreamViewer.count({
    where: { liveStreamId, role: { in: ["GUEST", "COHOST"] }, userId: { notIn: [hostId, userId] } },
  });
  if (stageSeatDecision({ alreadyOnStage, othersOnStage }) === "full") return "full";
  const joinedAt = input.now ?? new Date();
  await tx.liveStreamViewer.upsert({
    where: { liveStreamId_userId: { liveStreamId, userId } },
    create: { liveStreamId, userId, role, joinedAt },
    update: { role, joinedAt },
  });
  return "admitted";
}
