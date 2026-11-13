"use server";

import { revalidatePath } from "next/cache";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma, type TransactionClient } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { moderateText } from "@/lib/moderation";
import { getBlockedEitherWayIds, isBlockedEitherWay } from "@/lib/blocks";
import { canAccessLiveStream } from "@/lib/live-stream-access";
import { holdsViewerSlot } from "@/lib/live-viewer-cap";
import { publishEvent } from "@/lib/realtime-server";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";
import { challengeCreateSchema, challengeIdSchema, challengeWinnersSchema } from "@/lib/validations";
import {
  CHALLENGE_SAME_WINNER_WINDOW_MS,
  cancelRefusal,
  challengeAuditReason,
  challengeDeclareLockKey,
  challengeOpenLockKey,
  challengeRowLockKey,
  challengeTextRefusal,
  challengesEnabledFor,
  canHostLiveChallenge,
  declareRefusal,
  editRefusal,
  editableUntilFor,
  farmingRefusal,
  hostAccountOldEnough,
  joinRefusal,
  normalizeChallengeText,
  openLimitRefusal,
  runsCircle,
  winnerChanges,
  type ChallengeStatusValue,
  type DeclareRefusal,
} from "@/lib/challenges";
import { cancelChallengeInTx, revokeChallengeAward } from "@/lib/challenge-revoke";
import { createChampionAwardsInTx, deliverChallengeAwards, pushChallengeResult } from "@/lib/challenge-awards";
import {
  listCircleChallengeViews,
  listLiveChallengeViews,
  loadChallengeAccess,
  loadLiveChallengeMoments,
  type ChallengeAccess,
  type ChallengeView,
  type LiveChallengeMoment,
} from "@/lib/challenges-data";

// Challenges (Gift Universe Phase B; rules: src/lib/challenges.ts, reads: src/lib/challenges-data.ts). Every action
// re-derives the user from the session (requireVerifiedUser) and refuses with "disabled" unless challengesEnabledFor
// says challenges are on for them (Phase B: site admins only), whatever the UI shows. Answers carry ids, names and
// flags only: never a User row. Every declaration, change and cancellation writes its AuditLog row in the same
// transaction as the change itself.

export type ChallengeError =
  | "disabled"
  | "invalid"
  | "unavailable"
  | "forbidden"
  | "too_new"
  | "rate_limited"
  | "moderation"
  | "title_required"
  | "title_too_long"
  | "description_too_long"
  | "too_many_open"
  | "not_in_stream"
  | "not_open"
  | "host"
  | "already_joined"
  | "full"
  | "farming"
  | "not_decided"
  | "locked"
  | "already_cancelled"
  | DeclareRefusal;

type Result<T = object> = ({ error: null } & T) | { error: ChallengeError };

type Actor = Awaited<ReturnType<typeof requireVerifiedUser>>;

/** The gate, first thing in every action. */
async function actor(): Promise<Actor | null> {
  const user = await requireVerifiedUser();
  return challengesEnabledFor(user) ? user : null;
}

/** Serializes everything that changes one challenge's participants or result. */
async function lockChallenge(tx: TransactionClient, challengeId: string) {
  const key = challengeRowLockKey(challengeId);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

/** Tells everyone in a live room that its challenges changed (a thin signal: the room refetches what it may see). */
async function signalLive(liveStreamId: string | null) {
  if (!liveStreamId) return;
  try {
    await publishEvent(REALTIME_CHANNELS.liveStream(liveStreamId), "changed", { kind: "challenge" });
  } catch (err) {
    console.error("[challenges] live signal failed", err);
  }
}

function revalidateContext(access: Pick<ChallengeAccess["challenge"], "circle" | "liveStreamId">) {
  if (access.circle) revalidatePath(`/circles/${access.circle.slug}`);
  if (access.liveStreamId) revalidatePath(`/live/${access.liveStreamId}`);
}

// ---------- Reading ----------

/** A Circle's Challenges section: members only (to anyone else, including a site admin who isn't one, unavailable). */
export async function listCircleChallenges(
  circleId: string,
): Promise<Result<{ challenges: ChallengeView[]; canCreate: boolean }>> {
  const user = await actor();
  if (!user) return { error: "disabled" };
  const id = challengeIdSchema.safeParse(circleId);
  if (!id.success) return { error: "invalid" };
  if (!(await checkRateLimit("challengeList", user.id))) return { error: "rate_limited" };
  const [circle, membership] = await Promise.all([
    prisma.circle.findUnique({ where: { id: id.data }, select: { id: true, createdById: true } }),
    prisma.circleMembership.findUnique({
      where: { userId_circleId: { userId: user.id, circleId: id.data } },
      select: { role: true },
    }),
  ]);
  if (!circle || !membership) return { error: "unavailable" };
  const view = await listCircleChallengeViews(circle, user, membership.role);
  return { error: null, ...view };
}

/** A live room's challenges, for anyone who may see the stream (canAccessLiveStream). */
export async function listLiveChallenges(
  liveStreamId: string,
): Promise<Result<{ challenges: ChallengeView[]; canCreate: boolean }>> {
  const user = await actor();
  if (!user) return { error: "disabled" };
  const id = challengeIdSchema.safeParse(liveStreamId);
  if (!id.success) return { error: "invalid" };
  if (!(await checkRateLimit("challengeList", user.id))) return { error: "rate_limited" };
  const stream = await prisma.liveStream.findUnique({
    where: { id: id.data },
    select: { id: true, hostId: true, status: true, circleId: true, targetUserId: true },
  });
  if (!stream || !(await canAccessLiveStream(stream, user))) return { error: "unavailable" };
  const view = await listLiveChallengeViews(stream, user);
  return { error: null, ...view };
}

/** The winner moments a live room plays (a title and a count; see loadLiveChallengeMoments). */
export async function getLiveChallengeMoments(liveStreamId: string): Promise<Result<{ moments: LiveChallengeMoment[] }>> {
  const user = await actor();
  if (!user) return { error: "disabled" };
  const id = challengeIdSchema.safeParse(liveStreamId);
  if (!id.success) return { error: "invalid" };
  const stream = await prisma.liveStream.findUnique({
    where: { id: id.data },
    select: { hostId: true, circleId: true, targetUserId: true },
  });
  if (!stream || !(await canAccessLiveStream(stream, user))) return { error: "unavailable" };
  return { error: null, moments: await loadLiveChallengeMoments(id.data, user.id) };
}

// ---------- Creating ----------

/**
 * Puts up a challenge. In a Circle: by its owner or a co-admin (by membership role; no site-admin shortcut). On a live
 * stream: by its host, on their own stream, while it is live. The host's account is verified and at least 7 days
 * old; at most CHALLENGE_OPEN_MAX open per host and per Circle / stream (counted under advisory locks); 3 a day per
 * host (fail-closed limiter); title and description moderated (flagged text is refused, never stored).
 */
export async function createChallenge(input: {
  place: { context: "CIRCLE"; circleId: string } | { context: "LIVE"; liveStreamId: string };
  title: string;
  description?: string | null;
}): Promise<Result<{ challengeId: string }>> {
  const user = await actor();
  if (!user) return { error: "disabled" };
  const parsed = challengeCreateSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const title = normalizeChallengeText(parsed.data.title);
  const description = normalizeChallengeText(parsed.data.description ?? null);
  const textRefusal = challengeTextRefusal(title, description);
  if (textRefusal) return { error: textRefusal };
  const now = new Date();
  if (!hostAccountOldEnough(user.createdAt, now)) return { error: "too_new" };

  const place = parsed.data.place;
  let circleSlug: string | null = null;
  if (place.context === "CIRCLE") {
    const [circle, membership] = await Promise.all([
      prisma.circle.findUnique({ where: { id: place.circleId }, select: { id: true, slug: true, createdById: true } }),
      prisma.circleMembership.findUnique({
        where: { userId_circleId: { userId: user.id, circleId: place.circleId } },
        select: { role: true },
      }),
    ]);
    if (!circle || !membership) return { error: "unavailable" };
    if (!runsCircle({ userId: user.id, circleOwnerId: circle.createdById, role: membership.role })) return { error: "forbidden" };
    circleSlug = circle.slug;
  } else {
    const stream = await prisma.liveStream.findUnique({
      where: { id: place.liveStreamId },
      select: { id: true, hostId: true, status: true },
    });
    if (!stream) return { error: "unavailable" };
    if (!canHostLiveChallenge({ userId: user.id, streamHostId: stream.hostId, streamStatus: stream.status })) {
      return { error: "forbidden" };
    }
  }

  if (!(await checkRateLimit("challengeCreate", user.id))) return { error: "rate_limited" };
  for (const text of [title, description]) {
    if (text !== null && !(await moderateText(text)).allowed) return { error: "moderation" };
  }

  const contextKey = place.context === "CIRCLE" ? `circle:${place.circleId}` : `live:${place.liveStreamId}`;
  const outcome = await prisma.$transaction(async (tx): Promise<Result<{ challengeId: string }>> => {
    // Host first, then the context, always in this order, so two creates can't deadlock.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${challengeOpenLockKey(`host:${user.id}`)}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${challengeOpenLockKey(contextKey)}))`;
    const [openByHost, openInContext] = await Promise.all([
      tx.challenge.count({ where: { hostId: user.id, status: "OPEN" } }),
      tx.challenge.count({
        where: {
          status: "OPEN",
          ...(place.context === "CIRCLE" ? { circleId: place.circleId } : { liveStreamId: place.liveStreamId }),
        },
      }),
    ]);
    const limit = openLimitRefusal(openByHost, openInContext);
    if (limit) return { error: limit };
    const created = await tx.challenge.create({
      data: {
        title: title!,
        description,
        hostId: user.id,
        circleId: place.context === "CIRCLE" ? place.circleId : null,
        liveStreamId: place.context === "LIVE" ? place.liveStreamId : null,
      },
      select: { id: true },
    });
    return { error: null, challengeId: created.id };
  });

  if (outcome.error === null) {
    if (circleSlug) revalidatePath(`/circles/${circleSlug}`);
    if (place.context === "LIVE") await signalLive(place.liveStreamId);
  }
  return outcome;
}

// ---------- Joining and leaving ----------

/**
 * Whether `user` may take part in this challenge's context right now: a Circle's members; a live stream's viewers who
 * are in the room right now (a slot-holding viewer row, or a co-host) while it is live.
 */
async function participationRefusal(access: ChallengeAccess, user: Actor): Promise<ChallengeError | null> {
  if (!access.canSee) return "unavailable";
  if (access.challenge.liveStream) {
    const stream = access.challenge.liveStream;
    if (stream.status !== "LIVE") return "not_open";
    if (stream.hostId !== user.id) {
      const viewing = await prisma.liveStreamViewer.findUnique({
        where: { liveStreamId_userId: { liveStreamId: stream.id, userId: user.id } },
        select: { role: true, joinedAt: true },
      });
      if (!viewing || !(viewing.role === "COHOST" || holdsViewerSlot(viewing, user.lastSeenAt, new Date()))) {
        return "not_in_stream";
      }
    }
  }
  return null;
}

/** Joins an OPEN challenge (never your own; never across a block with its host). 30 a day, with leaving. */
export async function joinChallenge(challengeId: string): Promise<Result> {
  const user = await actor();
  if (!user) return { error: "disabled" };
  const id = challengeIdSchema.safeParse(challengeId);
  if (!id.success) return { error: "invalid" };
  const access = await loadChallengeAccess(id.data, user);
  if (!access) return { error: "unavailable" };
  const placeRefusal = await participationRefusal(access, user);
  if (placeRefusal) return { error: placeRefusal };
  const blocked = access.challenge.hostId !== null && (await isBlockedEitherWay(user.id, access.challenge.hostId));
  if (blocked) return { error: "unavailable" };
  if (!(await checkRateLimit("challengeJoin", user.id))) return { error: "rate_limited" };

  const outcome = await prisma.$transaction(async (tx): Promise<Result> => {
    await lockChallenge(tx, id.data);
    const fresh = await tx.challenge.findUnique({
      where: { id: id.data },
      select: {
        status: true,
        hostId: true,
        _count: { select: { participants: true } },
        participants: { where: { userId: user.id }, select: { id: true } },
      },
    });
    if (!fresh) return { error: "unavailable" };
    const refusal = joinRefusal({
      status: fresh.status as ChallengeStatusValue,
      isHost: fresh.hostId === user.id,
      alreadyJoined: fresh.participants.length > 0,
      participantCount: fresh._count.participants,
      blocked: false,
    });
    if (refusal === "already_joined") return { error: null };
    if (refusal) return { error: refusal };
    await tx.challengeParticipant.create({ data: { challengeId: id.data, userId: user.id }, select: { id: true } });
    return { error: null };
  });
  if (outcome.error === null) {
    revalidateContext(access.challenge);
    await signalLive(access.challenge.liveStreamId);
  }
  return outcome;
}

/** Leaves a challenge before it is decided (nothing changes once it has a result). */
export async function leaveChallenge(challengeId: string): Promise<Result> {
  const user = await actor();
  if (!user) return { error: "disabled" };
  const id = challengeIdSchema.safeParse(challengeId);
  if (!id.success) return { error: "invalid" };
  if (!(await checkRateLimit("challengeJoin", user.id))) return { error: "rate_limited" };
  const access = await loadChallengeAccess(id.data, user);
  if (!access) return { error: "unavailable" };
  const removed = await prisma.$transaction(async (tx) => {
    await lockChallenge(tx, id.data);
    return tx.challengeParticipant.deleteMany({
      where: { challengeId: id.data, userId: user.id, challenge: { status: "OPEN" } },
    });
  });
  if (removed.count === 0) return { error: access.challenge.status === "OPEN" ? "unavailable" : "not_open" };
  revalidateContext(access.challenge);
  await signalLive(access.challenge.liveStreamId);
  return { error: null };
}

// ---------- Results ----------

/** Shared checks before deciding or changing a result: the gate, a verified host-age account, the limiter, blocks. */
async function resultPreflight(
  challengeId: string,
  winnerIds: string[],
): Promise<{ error: ChallengeError } | { error: null; user: Actor; access: ChallengeAccess; ids: { challengeId: string; winnerIds: string[] } }> {
  const user = await actor();
  if (!user) return { error: "disabled" };
  const parsed = challengeWinnersSchema.safeParse({ challengeId, winnerIds });
  if (!parsed.success) return { error: "invalid" };
  if (!hostAccountOldEnough(user.createdAt, new Date())) return { error: "too_new" };
  const access = await loadChallengeAccess(parsed.data.challengeId, user);
  if (!access || !access.canSee) return { error: "unavailable" };
  // A winner blocked either way with the declarer can't be declared (one answer, so a block is never revealed).
  const blocked = await getBlockedEitherWayIds(user.id);
  if (parsed.data.winnerIds.some((w) => blocked.has(w))) return { error: "unavailable" };
  return { error: null, user, access, ids: parsed.data };
}

/** Per winner, the other decided challenges in the last 7 days in which this declarer already named them. */
async function priorWinsByDeclarer(
  tx: TransactionClient,
  declarerId: string,
  challengeId: string,
  winnerIds: string[],
  now: Date,
): Promise<Map<string, number>> {
  if (winnerIds.length === 0) return new Map();
  const rows = await tx.challengeWinner.findMany({
    where: {
      userId: { in: winnerIds },
      challengeId: { not: challengeId },
      challenge: {
        decidedById: declarerId,
        status: "DECIDED",
        decidedAt: { gte: new Date(now.getTime() - CHALLENGE_SAME_WINNER_WINDOW_MS) },
      },
    },
    select: { userId: true },
  });
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.userId, (counts.get(row.userId) ?? 0) + 1);
  return counts;
}

/** Creates winner rows, their awards and their one bell notice each. */
async function addWinnersInTx(
  tx: TransactionClient,
  challenge: ChallengeAccess["challenge"],
  declarerId: string,
  userIds: string[],
): Promise<string[]> {
  const rows: { id: string; userId: string }[] = [];
  for (const userId of userIds) {
    rows.push(
      await tx.challengeWinner.create({ data: { challengeId: challenge.id, userId }, select: { id: true, userId: true } }),
    );
  }
  const purchaseIds = await createChampionAwardsInTx(tx, challenge.id, rows);
  if (userIds.length > 0) {
    await tx.notification.createMany({
      data: userIds.map((recipientId) => ({
        recipientId,
        actorId: declarerId,
        type: "CHALLENGE_RESULT" as const,
        challengeId: challenge.id,
        circleId: challenge.circleId,
        liveStreamId: challenge.liveStreamId,
      })),
    });
  }
  return purchaseIds;
}

async function afterResult(
  access: ChallengeAccess,
  declarer: { id: string; name: string | null },
  purchaseIds: string[],
  notifiedIds: string[],
  revokedIds: string[] = [],
) {
  await deliverChallengeAwards(purchaseIds);
  await pushChallengeResult({ declarer, winnerIds: notifiedIds, circleSlug: access.challenge.circle?.slug ?? null });
  for (const id of [...notifiedIds, ...revokedIds]) revalidatePath(`/u/${id}`);
  revalidateContext(access.challenge);
  await signalLive(access.challenge.liveStreamId);
}

/**
 * Declares 1..10 unranked winners of an OPEN challenge: whoever may run it (its host, or the Circle's owner /
 * co-admins), with a verified account at least 7 days old, 5 a day (fail-closed limiter). Winners must have joined and
 * can never be the declarer; at least 2 people besides the declarer must have joined; nobody can be named a winner
 * by the same declarer in more than 3 challenges in 7 days. DECIDED, decidedAt / decidedById / editableUntil (+24h),
 * the winner rows, each winner's Champion award and one CHALLENGE_RESULT bell row, and the AuditLog row, all in one
 * transaction; then the awards are delivered and the winners pushed.
 */
export async function declareChallengeWinners(challengeId: string, winnerIds: string[]): Promise<Result> {
  const pre = await resultPreflight(challengeId, winnerIds);
  if (pre.error !== null) return pre;
  const { user, access, ids } = pre;
  if (!access.canRun) return { error: "forbidden" };
  if (!(await checkRateLimit("challengeDeclare", user.id))) return { error: "rate_limited" };

  const now = new Date();
  const outcome = await prisma.$transaction(async (tx): Promise<Result<{ purchaseIds: string[] }>> => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${challengeDeclareLockKey(user.id)}))`;
    await lockChallenge(tx, ids.challengeId);
    const fresh = await tx.challenge.findUnique({
      where: { id: ids.challengeId },
      select: { status: true, participants: { select: { userId: true } } },
    });
    if (!fresh) return { error: "unavailable" };
    const refusal = declareRefusal({
      status: fresh.status as ChallengeStatusValue,
      declarerId: user.id,
      participantIds: fresh.participants.map((p) => p.userId),
      winnerIds: ids.winnerIds,
    });
    if (refusal) return { error: refusal };
    const farming = farmingRefusal(await priorWinsByDeclarer(tx, user.id, ids.challengeId, ids.winnerIds, now), ids.winnerIds);
    if (farming) return { error: farming };
    const claimed = await tx.challenge.updateMany({
      where: { id: ids.challengeId, status: "OPEN" },
      data: { status: "DECIDED", decidedAt: now, decidedById: user.id, editableUntil: editableUntilFor(now) },
    });
    if (claimed.count !== 1) return { error: "not_open" };
    const purchaseIds = await addWinnersInTx(tx, access.challenge, user.id, ids.winnerIds);
    await tx.auditLog.create({
      data: {
        targetId: user.id,
        action: "CHALLENGE_DECIDED",
        reason: challengeAuditReason("decided", ids.challengeId, ids.winnerIds),
        performedBy: user.id,
      },
    });
    return { error: null, purchaseIds };
  });
  if (outcome.error !== null) return outcome;
  await afterResult(access, user, outcome.purchaseIds, ids.winnerIds);
  return { error: null };
}

/**
 * Changes a decided challenge's winners: its declarer only, within 24h of the decision (then locked; moderators can
 * still reverse it). Same winner rules as declaring (the farming check for the people added). A winner taken off has
 * their award revoked (never deleted) and their bell row removed; one added gets an award and a bell row. AuditLog
 * CHALLENGE_RESULT_EDITED in the same transaction. Counts against the same 5-a-day limiter as declaring.
 */
export async function editChallengeWinners(challengeId: string, winnerIds: string[]): Promise<Result> {
  const pre = await resultPreflight(challengeId, winnerIds);
  if (pre.error !== null) return pre;
  const { user, access, ids } = pre;
  if (!(await checkRateLimit("challengeDeclare", user.id))) return { error: "rate_limited" };

  const now = new Date();
  const outcome = await prisma.$transaction(
    async (tx): Promise<Result<{ purchaseIds: string[]; added: string[]; removed: string[] }>> => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${challengeDeclareLockKey(user.id)}))`;
      await lockChallenge(tx, ids.challengeId);
      const fresh = await tx.challenge.findUnique({
        where: { id: ids.challengeId },
        select: {
          status: true,
          decidedById: true,
          editableUntil: true,
          participants: { select: { userId: true } },
          winners: { select: { id: true, userId: true, awardSendId: true } },
        },
      });
      if (!fresh) return { error: "unavailable" };
      const editable = editRefusal({
        status: fresh.status as ChallengeStatusValue,
        decidedById: fresh.decidedById,
        editableUntil: fresh.editableUntil,
        userId: user.id,
        now,
      });
      if (editable) return { error: editable };
      const refusal = declareRefusal({
        status: fresh.status as ChallengeStatusValue,
        declarerId: user.id,
        participantIds: fresh.participants.map((p) => p.userId),
        winnerIds: ids.winnerIds,
        editing: true,
      });
      if (refusal) return { error: refusal };
      const { added, removed } = winnerChanges(
        fresh.winners.map((w) => w.userId),
        ids.winnerIds,
      );
      if (added.length === 0 && removed.length === 0) return { error: null, purchaseIds: [], added, removed };
      const farming = farmingRefusal(await priorWinsByDeclarer(tx, user.id, ids.challengeId, added, now), added);
      if (farming) return { error: farming };

      for (const winner of fresh.winners.filter((w) => removed.includes(w.userId))) {
        if (winner.awardSendId) await revokeChallengeAward(tx, winner.awardSendId, now);
        await tx.challengeWinner.delete({ where: { id: winner.id } });
      }
      if (removed.length > 0) {
        await tx.notification.deleteMany({
          where: { challengeId: ids.challengeId, type: "CHALLENGE_RESULT", recipientId: { in: removed } },
        });
      }
      const purchaseIds = await addWinnersInTx(tx, access.challenge, user.id, added);
      await tx.auditLog.create({
        data: {
          targetId: user.id,
          action: "CHALLENGE_RESULT_EDITED",
          reason: challengeAuditReason("edited", ids.challengeId, ids.winnerIds, { added, removed }),
          performedBy: user.id,
        },
      });
      return { error: null, purchaseIds, added, removed };
    },
  );
  if (outcome.error !== null) return outcome;
  await afterResult(access, user, outcome.purchaseIds, outcome.added, outcome.removed);
  return { error: null };
}

/**
 * Cancels a challenge. OPEN: whoever may run it. DECIDED: its declarer, within 24h (then only moderators, from the
 * report queue). Every award it gave is revoked and its winners' bell rows removed (cancelChallengeInTx); AuditLog
 * CHALLENGE_CANCELLED in the same transaction.
 */
export async function cancelChallenge(challengeId: string): Promise<Result> {
  const user = await actor();
  if (!user) return { error: "disabled" };
  const id = challengeIdSchema.safeParse(challengeId);
  if (!id.success) return { error: "invalid" };
  const access = await loadChallengeAccess(id.data, user);
  if (!access || !access.canSee) return { error: "unavailable" };
  if (!(await checkRateLimit("challengeManage", user.id))) return { error: "rate_limited" };

  const now = new Date();
  const outcome = await prisma.$transaction(async (tx): Promise<Result<{ winnerIds: string[] }>> => {
    await lockChallenge(tx, id.data);
    const fresh = await tx.challenge.findUnique({
      where: { id: id.data },
      select: { status: true, decidedById: true, editableUntil: true },
    });
    if (!fresh) return { error: "unavailable" };
    const refusal = cancelRefusal({
      status: fresh.status as ChallengeStatusValue,
      canRun: access.canRun,
      decidedById: fresh.decidedById,
      editableUntil: fresh.editableUntil,
      userId: user.id,
      now,
    });
    if (refusal) return { error: refusal };
    const cancelled = await cancelChallengeInTx(tx, id.data, { userId: user.id, byAdmin: false }, now);
    if (!cancelled) return { error: "unavailable" };
    await tx.auditLog.create({
      data: {
        targetId: user.id,
        action: "CHALLENGE_CANCELLED",
        reason: challengeAuditReason("cancelled", id.data, cancelled.winnerIds),
        performedBy: user.id,
      },
    });
    return { error: null, winnerIds: cancelled.winnerIds };
  });
  if (outcome.error !== null) return outcome;
  for (const winnerId of outcome.winnerIds) revalidatePath(`/u/${winnerId}`);
  revalidateContext(access.challenge);
  await signalLive(access.challenge.liveStreamId);
  return { error: null };
}
