import { prisma } from "@/lib/prisma";
import { getBlockedEitherWayIds } from "@/lib/blocks";
import { checkRateLimit } from "@/lib/rate-limit";
import { sendPushToUser } from "@/lib/push";
import { sendFcmActivityToUser } from "@/lib/fcm";
import { activityLine, nameOrSomeone, pushText } from "@/lib/push-text";
import type { Locale } from "@/lib/i18n/locales";
import { captureError } from "@/lib/error-tracking";
import {
  inviteSendDecision,
  LIVE_INVITE_MAX_PENDING,
  LIVE_INVITE_MAX_SENDS,
  LIVE_INVITE_TTL_MS,
  LIVE_INVITE_PAIR_DAILY_MAX,
  LIVE_INVITE_PAIR_WINDOW_MS,
  liveInviteeUserWhere,
  liveInviteHref,
  liveInvitePushKey,
  LIVE_INVITE_SWEEP_LIMIT,
  openInviteWhere,
  type LiveInviteRecallReason,
} from "@/lib/live-stage";
import {
  addsToSelectedAudience,
  LIVE_SELECTED_AUDIENCE_MAX,
  selectedAudienceInviteWhere,
} from "@/lib/live-audience";

// The server half of live stage invites (pure rules: src/lib/live-stage.ts). Shared by startLiveStream (people picked
// in the Go live sheet) and inviteToLiveStream (the in-room picker), so both apply exactly the same checks.

export type InviteStream = {
  id: string;
  hostId: string;
  circleId: string | null;
  targetUserId: string | null;
  /** "Only the people I selected": these invites are the stream's allow-list (src/lib/live-audience.ts). */
  selectedOnly: boolean;
  status: "LIVE" | "ENDED";
  roomName: string;
};

/** Why one person wasn't invited. `unavailable` covers blocks, privacy and the audience rule alike, so it reveals none of them. */
export type InviteRefusal = "unavailable" | "declined" | "limit" | "on_stage";

/** Locked per stream while invites are written, so two requests can't both slip under LIVE_INVITE_MAX_PENDING. */
export function liveInviteWriteLockKey(liveStreamId: string) {
  return `live-invites:${liveStreamId}`;
}

/**
 * Whether `inviterId` may invite people to this stream: its host, or a co-host on it (a COHOST LiveStreamViewer row),
 * while it is live with a room. Nobody else, viewers and guests included.
 */
export async function canInviteToStream(stream: InviteStream, inviterId: string) {
  if (stream.status !== "LIVE" || !stream.roomName) return false;
  if (stream.hostId === inviterId) return true;
  const row = await prisma.liveStreamViewer.findUnique({
    where: { liveStreamId_userId: { liveStreamId: stream.id, userId: inviterId } },
    select: { role: true },
  });
  return row?.role === "COHOST";
}

/**
 * The people among `ids` who may be invited under this stream's audience (canAccessLiveStream, in bulk). For
 * Everyone / a Circle / one person an invite never widens who may watch: Everyone or a PUBLIC Circle: all of them; a
 * PRIVATE Circle: its members; one specific person: only them. For "Only the people I selected" (selectedOnly) the
 * invite is what lets them watch, so all of them (blocks and eligibility are checked by the caller, the allow-list cap
 * by sendLiveInvites).
 */
export async function filterByAudience(
  stream: Pick<InviteStream, "circleId" | "targetUserId"> & { selectedOnly?: boolean },
  ids: string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  if (stream.selectedOnly) return ids;
  if (stream.targetUserId) return ids.filter((id) => id === stream.targetUserId);
  if (!stream.circleId) return ids;
  const circle = await prisma.circle.findUnique({ where: { id: stream.circleId }, select: { visibility: true } });
  if (!circle) return [];
  if (circle.visibility === "PUBLIC") return ids;
  const members = await prisma.circleMembership.findMany({
    where: { circleId: stream.circleId, userId: { in: ids } },
    select: { userId: true },
  });
  const memberIds = new Set(members.map((m) => m.userId));
  return ids.filter((id) => memberIds.has(id));
}

/** Everyone blocked either way with the inviter, and with the host too when a co-host is inviting. */
export async function blockedForInvite(stream: Pick<InviteStream, "hostId">, inviterId: string) {
  const blocked = await getBlockedEitherWayIds(inviterId);
  if (stream.hostId !== inviterId) {
    for (const id of await getBlockedEitherWayIds(stream.hostId)) blocked.add(id);
  }
  return blocked;
}

/** Ids of people on this stream's stage (guests and co-hosts) and of anyone with an open invite to it. */
export async function stageAndInvitedIds(liveStreamId: string, now: Date) {
  const [onStage, invited] = await Promise.all([
    prisma.liveStreamViewer.findMany({
      where: { liveStreamId, role: { in: ["GUEST", "COHOST"] } },
      select: { userId: true },
    }),
    prisma.liveStreamInvite.findMany({ where: openInviteWhere(liveStreamId, now), select: { inviteeId: true } }),
  ]);
  return { onStage: new Set(onStage.map((r) => r.userId)), invited: new Set(invited.map((r) => r.inviteeId)) };
}

/**
 * The people among `ids` that `inviterId` may invite to this stream at all: eligible accounts (liveInviteeUserWhere),
 * not blocked either way with the inviter or the host, never the host, and within the audience (filterByAudience).
 * Needs no stream row (only who hosts it and its audience), so startLiveStream can check the Go live sheet's picks
 * before it creates anything. Which rule refused someone is never returned.
 */
export async function invitableIds(
  stream: Pick<InviteStream, "hostId" | "circleId" | "targetUserId" | "selectedOnly">,
  inviterId: string,
  ids: string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const blocked = await blockedForInvite(stream, inviterId);
  blocked.add(stream.hostId);
  const eligibleRows = await prisma.user.findMany({
    where: { AND: [liveInviteeUserWhere(inviterId, blocked), { id: { in: ids } }] },
    select: { id: true },
  });
  const allowed = new Set(await filterByAudience(stream, eligibleRows.map((u) => u.id)));
  // In the order asked, so the start's picks keep their order.
  return ids.filter((id) => allowed.has(id));
}

/**
 * Invites `inviteeIds` to come on stage. The caller has already checked that `inviterId` may invite here
 * (canInviteToStream). For each person: eligible (liveInviteeUserWhere, not blocked either way, within the audience),
 * not already on stage, and their row for this stream allows it (inviteSendDecision); then the stream's open-invite cap
 * and the inviter's per-person 24h cap. The inviter's hourly limit (`liveInvite`) is charged for the people actually
 * invited, all or none. Rows and bell notifications are written in one transaction; pushes go out after it, best
 * effort, in each invitee's language. Idempotent: inviting someone whose invite is still open changes nothing and
 * counts as invited.
 */
export async function sendLiveInvites(
  stream: InviteStream,
  inviter: { id: string; name: string | null },
  inviteeIds: string[],
  now = new Date(),
): Promise<
  | { error: "rate_limited" }
  | { error: null; invited: string[]; refused: { userId: string; reason: InviteRefusal }[] }
> {
  const refused: { userId: string; reason: InviteRefusal }[] = [];
  if (inviteeIds.length === 0) return { error: null, invited: [], refused };

  const eligible = await invitableIds(stream, inviter.id, inviteeIds);
  const eligibleSet = new Set(eligible);
  for (const id of inviteeIds) if (!eligibleSet.has(id)) refused.push({ userId: id, reason: "unavailable" });
  if (eligible.length === 0) return { error: null, invited: [], refused };

  const [onStageRows, existingRows, pairRows] = await Promise.all([
    prisma.liveStreamViewer.findMany({
      where: { liveStreamId: stream.id, userId: { in: eligible }, role: { in: ["GUEST", "COHOST"] } },
      select: { userId: true },
    }),
    prisma.liveStreamInvite.findMany({
      where: { liveStreamId: stream.id, inviteeId: { in: eligible } },
      select: { inviteeId: true, status: true, createdAt: true, sendCount: true },
    }),
    prisma.liveStreamInvite.groupBy({
      by: ["inviteeId"],
      where: {
        invitedById: inviter.id,
        inviteeId: { in: eligible },
        createdAt: { gt: new Date(now.getTime() - LIVE_INVITE_PAIR_WINDOW_MS) },
      },
      _count: { _all: true },
    }),
  ]);
  const onStage = new Set(onStageRows.map((r) => r.userId));
  const existingBy = new Map(existingRows.map((r) => [r.inviteeId, r]));
  const pairCount = new Map(pairRows.map((r) => [r.inviteeId, r._count._all]));

  const alreadyInvited: string[] = [];
  const toSend: { userId: string; kind: "create" | "resend" }[] = [];
  for (const userId of eligible) {
    if (onStage.has(userId)) {
      refused.push({ userId, reason: "on_stage" });
      continue;
    }
    const decision = inviteSendDecision(existingBy.get(userId), now);
    if (decision === "noop") alreadyInvited.push(userId);
    else if (decision === "declined") refused.push({ userId, reason: "declined" });
    else if (decision === "too_many" || (pairCount.get(userId) ?? 0) >= LIVE_INVITE_PAIR_DAILY_MAX) {
      refused.push({ userId, reason: "limit" });
    } else toSend.push({ userId, kind: decision });
  }
  if (toSend.length === 0) return { error: null, invited: alreadyInvited, refused };

  if (!(await checkRateLimit("liveInvite", inviter.id, { rate: toSend.length }))) return { error: "rate_limited" };

  const { written: sent, accepted } = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${liveInviteWriteLockKey(stream.id)}))`;
    const open = await tx.liveStreamInvite.count({ where: openInviteWhere(stream.id, now) });
    const room = Math.max(0, LIVE_INVITE_MAX_PENDING - open);
    const withinPending = toSend.slice(0, room);
    for (const over of toSend.slice(room)) refused.push({ userId: over.userId, reason: "limit" });
    // "Only the people I selected": each invite to someone not yet on the allow-list adds them to it, up to
    // LIVE_SELECTED_AUDIENCE_MAX (counted under this same lock, so racing requests can't pass it together).
    let accepted = withinPending;
    if (stream.selectedOnly) {
      let allowed = await tx.liveStreamInvite.count({ where: selectedAudienceInviteWhere(stream.id) });
      accepted = [];
      for (const item of withinPending) {
        if (addsToSelectedAudience(existingBy.get(item.userId)?.status)) {
          if (allowed >= LIVE_SELECTED_AUDIENCE_MAX) {
            refused.push({ userId: item.userId, reason: "limit" });
            continue;
          }
          allowed++;
        }
        accepted.push(item);
      }
    }
    // Re-checked under the lock: a racing request for the same person may have written their row since it was read,
    // and only the request that actually writes it notifies them.
    const written: string[] = [];
    const createIds = accepted.filter((a) => a.kind === "create").map((a) => a.userId);
    const appeared = new Set(
      createIds.length === 0
        ? []
        : (
            await tx.liveStreamInvite.findMany({
              where: { liveStreamId: stream.id, inviteeId: { in: createIds } },
              select: { inviteeId: true },
            })
          ).map((r) => r.inviteeId),
    );
    for (const { userId, kind } of accepted) {
      if (kind === "create") {
        if (appeared.has(userId)) continue;
        await tx.liveStreamInvite.create({
          data: { liveStreamId: stream.id, inviteeId: userId, invitedById: inviter.id, createdAt: now },
        });
        written.push(userId);
      } else {
        const resent = await tx.liveStreamInvite.updateMany({
          where: {
            liveStreamId: stream.id,
            inviteeId: userId,
            sendCount: { lt: LIVE_INVITE_MAX_SENDS },
            OR: [
              { status: { in: ["CANCELLED", "EXPIRED"] } },
              { status: "PENDING", createdAt: { lte: new Date(now.getTime() - LIVE_INVITE_TTL_MS) } },
            ],
          },
          data: {
            status: "PENDING",
            invitedById: inviter.id,
            createdAt: now,
            respondedAt: null,
            sendCount: { increment: 1 },
          },
        });
        if (resent.count > 0) written.push(userId);
      }
    }
    if (written.length > 0) {
      const ids = written;
      // One bell row per open invite: an older unread one for the same stream is replaced, not stacked.
      await tx.notification.deleteMany({
        where: { type: "LIVE_STAGE_INVITE", liveStreamId: stream.id, recipientId: { in: ids }, readAt: null },
      });
      await tx.notification.createMany({
        data: ids.map((recipientId) => ({
          recipientId,
          actorId: inviter.id,
          type: "LIVE_STAGE_INVITE" as const,
          liveStreamId: stream.id,
        })),
      });
    }
    return { written, accepted: accepted.map((a) => a.userId) };
  });

  await Promise.allSettled(sent.map((userId) => pushInvite(stream.id, userId, inviter.name)));
  return { error: null, invited: [...alreadyInvited, ...accepted], refused };
}

async function pushInvite(liveStreamId: string, recipientId: string, inviterName: string | null) {
  const key = liveInvitePushKey(liveStreamId);
  const payload = (locale: Locale) => ({
    title: nameOrSomeone(inviterName, locale),
    body: activityLine("LIVE_STAGE_INVITE", locale),
    url: liveInviteHref(liveStreamId),
  });
  try {
    // Sent under the invite's replacement key, so a later correction (recallLiveInvitePushes) takes its place.
    await Promise.allSettled([
      sendPushToUser(recipientId, (locale) => ({ ...payload(locale), tag: key })),
      sendFcmActivityToUser(recipientId, (locale) => ({ ...payload(locale), type: "LIVE_STAGE_INVITE" }), {
        replaceKey: key,
      }),
    ]);
  } catch (err) {
    await captureError(err, { action: "pushLiveInvite", liveStreamId });
  }
}

/**
 * Corrects an invite push already on the invitees' devices: a quiet notification under the same replacement key
 * ("This invite was cancelled" / "has expired" / "The live has ended", in each recipient's language) that takes the
 * original's place where the platform supports it (src/lib/push-replace.ts). It cannot delete anything: if the
 * original was already dismissed, this shows as a new, quiet notification. So it is sent only to people who haven't
 * acted on the invite (the caller passes only invitees whose bell row was still unread when the invite was settled).
 * Its tap target is the same invite URL, which then says the invite is no longer available. Best effort, never throws.
 */
export async function recallLiveInvitePushes(
  liveStreamId: string,
  recipientIds: string[],
  reason: LiveInviteRecallReason,
) {
  if (recipientIds.length === 0) return;
  const key = liveInvitePushKey(liveStreamId);
  const payload = (locale: Locale) => {
    const t = pushText(locale).liveInviteRecall;
    return { title: t.title, body: t[reason], url: liveInviteHref(liveStreamId) };
  };
  await Promise.allSettled(
    recipientIds.flatMap((recipientId) => [
      sendPushToUser(recipientId, (locale) => ({ ...payload(locale), tag: key, silent: true })),
      sendFcmActivityToUser(recipientId, (locale) => ({ ...payload(locale), type: "LIVE_STAGE_INVITE_RECALL" }), {
        replaceKey: key,
        quiet: true,
      }),
    ]),
  ).catch(() => undefined);
}

/**
 * Settles open invites that can no longer be accepted and corrects their pushes: every PENDING invite past its TTL,
 * or on a live that has ended (`liveStreamId` narrows it to one stream, for the host's own End). Each row moves
 * PENDING -> EXPIRED with a guarded write, so a racing run (or an answer landing meanwhile) settles it once; for those
 * it settled, the invitee's still-unread bell row is deleted and only those invitees (who never acted on it) get the
 * correction push. At most LIVE_INVITE_SWEEP_LIMIT per call. Never throws.
 */
export async function settleLiveInvites(options: { now?: Date; liveStreamId?: string } = {}) {
  const now = options.now ?? new Date();
  try {
    const due = await prisma.liveStreamInvite.findMany({
      where: {
        status: "PENDING",
        ...(options.liveStreamId ? { liveStreamId: options.liveStreamId } : {}),
        OR: [
          { createdAt: { lte: new Date(now.getTime() - LIVE_INVITE_TTL_MS) } },
          { liveStream: { status: "ENDED" } },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: LIVE_INVITE_SWEEP_LIMIT,
      select: { id: true, liveStreamId: true, inviteeId: true, liveStream: { select: { status: true } } },
    });
    const settled: typeof due = [];
    for (const invite of due) {
      const moved = await prisma.liveStreamInvite.updateMany({
        where: { id: invite.id, status: "PENDING" },
        data: { status: "EXPIRED", respondedAt: now },
      });
      if (moved.count > 0) settled.push(invite);
    }
    if (settled.length === 0) return { settled: 0, recalled: 0 };

    const byStream = new Map<string, { ended: boolean; inviteeIds: string[] }>();
    for (const invite of settled) {
      const entry = byStream.get(invite.liveStreamId) ?? { ended: invite.liveStream.status === "ENDED", inviteeIds: [] };
      entry.inviteeIds.push(invite.inviteeId);
      byStream.set(invite.liveStreamId, entry);
    }
    let recalled = 0;
    for (const [liveStreamId, { ended, inviteeIds }] of byStream) {
      // One delete per invitee: a row that was still unread (deleted here) means they never acted on the invite.
      const recipients: string[] = [];
      for (const recipientId of new Set(inviteeIds)) {
        const unread = await prisma.notification.deleteMany({
          where: { type: "LIVE_STAGE_INVITE", liveStreamId, recipientId, readAt: null },
        });
        if (unread.count > 0) recipients.push(recipientId);
      }
      await recallLiveInvitePushes(liveStreamId, recipients, ended ? "ended" : "expired");
      recalled += recipients.length;
    }
    return { settled: settled.length, recalled };
  } catch (err) {
    await captureError(err, { action: "settleLiveInvites" });
    return { settled: 0, recalled: 0 };
  }
}
