"use server";

import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { publishEvent } from "@/lib/realtime-server";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";
import { captureError } from "@/lib/error-tracking";
import { canAccessLiveStream } from "@/lib/live-stream-access";
import { getCircleMembership } from "@/lib/circle-permissions";
import { getHiddenPeerIds } from "@/lib/hidden-chats";
import { isBlockedWithAny } from "@/lib/blocks";
import { normalizeDiscoverSearchQuery } from "@/lib/discover-search";
import { claimStageSeat } from "@/lib/live-stage-server";
import { ejectFromRoom } from "@/lib/daily";
import {
  LIVE_INVITE_TTL_MS,
  liveInviteGone,
  liveInviteStatus,
  liveInviteeQueryWhere,
  type LiveInviteGone,
  liveInviteeUserWhere,
  openInviteWhere,
  parseInviteeIds,
} from "@/lib/live-stage";
import {
  blockedForInvite,
  canInviteToStream,
  filterByAudience,
  recallLiveInvitePushes,
  sendLiveInvites,
  stageAndInvitedIds,
  type InviteStream,
} from "@/lib/live-stream-invites-server";

// Inviting people onto a live stream's stage (rules: src/lib/live-stage.ts; server half:
// src/lib/live-stream-invites-server.ts). The host and co-hosts invite (the in-room picker; the Go live sheet goes
// through startLiveStream); the invitee accepts or declines from the stream's own page.

/** Most people the picker's search answers with. A broad query gets "keep typing", never the directory. */
const INVITE_SEARCH_LIMIT = 20;

const STREAM_SELECT = {
  id: true,
  hostId: true,
  circleId: true,
  targetUserId: true,
  selectedOnly: true,
  status: true,
  roomName: true,
} as const;

function signalStage(liveStreamId: string) {
  return publishEvent(REALTIME_CHANNELS.liveStream(liveStreamId), "changed", { kind: "stage" });
}

export type LiveInviteCandidate = {
  id: string;
  name: string | null;
  username: string | null;
  avatarUrl: string | null;
  connected: boolean;
};

/**
 * The picker's search box. `context` is either the stream being run (`liveStreamId`: host or co-host only) or the Go
 * live sheet's chosen audience (`circleId` / `targetUserId`, before the stream exists). Answers only people the
 * inviter could invite: liveInviteeUserWhere (active, verified, connected or shown in people search), not blocked
 * either way (nor with the host), not a hidden-chat peer, never the inviter, the host, anyone already on stage or
 * with an open invite, and only people the stream's audience lets watch. Same query rules and rate limits as Discover
 * people search.
 */
export async function searchLiveInvitees(
  rawQuery: string,
  context: { liveStreamId?: string; circleId?: string; targetUserId?: string },
): Promise<{ error: null | "rate_limited" | "forbidden"; items: LiveInviteCandidate[] }> {
  const me = await requireVerifiedUser();
  const query = normalizeDiscoverSearchQuery(rawQuery);
  if (!query) return { error: null, items: [] };

  const [perMinute, perHour] = await Promise.all([
    checkRateLimit("discoverSearch", me.id),
    checkRateLimit("discoverSearchHour", me.id),
  ]);
  if (!perMinute || !perHour) return { error: "rate_limited", items: [] };

  let audience: Pick<InviteStream, "circleId" | "targetUserId">;
  const excluded = new Set<string>(await getHiddenPeerIds(me.id));
  if (typeof context?.liveStreamId === "string") {
    const stream = await prisma.liveStream.findUnique({ where: { id: context.liveStreamId }, select: STREAM_SELECT });
    if (!stream || !(await canInviteToStream(stream, me.id))) return { error: "forbidden", items: [] };
    audience = stream;
    for (const id of await blockedForInvite(stream, me.id)) excluded.add(id);
    const { onStage, invited } = await stageAndInvitedIds(stream.id, new Date());
    for (const id of [...onStage, ...invited, stream.hostId]) excluded.add(id);
  } else {
    const circleId = typeof context?.circleId === "string" && context.circleId ? context.circleId : null;
    const targetUserId =
      typeof context?.targetUserId === "string" && context.targetUserId ? context.targetUserId : null;
    if (circleId && !(await getCircleMembership(circleId, me.id))) return { error: null, items: [] };
    audience = { circleId, targetUserId };
    for (const id of await blockedForInvite({ hostId: me.id }, me.id)) excluded.add(id);
  }

  const people = await prisma.user.findMany({
    where: { AND: [liveInviteeUserWhere(me.id, excluded), liveInviteeQueryWhere(query)] },
    orderBy: [{ trustScore: "desc" }, { id: "asc" }],
    take: INVITE_SEARCH_LIMIT * 2,
    select: { id: true, name: true, username: true, avatarUrl: true },
  });
  const allowed = new Set(await filterByAudience(audience, people.map((p) => p.id)));
  const visible = people.filter((p) => allowed.has(p.id));
  const ids = visible.map((p) => p.id);
  const connections = ids.length
    ? await prisma.connection.findMany({
        where: {
          status: "ACCEPTED",
          OR: [
            { requesterId: me.id, targetId: { in: ids } },
            { targetId: me.id, requesterId: { in: ids } },
          ],
        },
        select: { requesterId: true, targetId: true },
      })
    : [];
  const connectedIds = new Set(connections.map((c) => (c.requesterId === me.id ? c.targetId : c.requesterId)));
  // Connections first (the people you most likely mean), then everyone else in search order.
  const items = visible
    .map((p) => ({ ...p, connected: connectedIds.has(p.id) }))
    .sort((a, b) => Number(b.connected) - Number(a.connected))
    .slice(0, INVITE_SEARCH_LIMIT);
  return { error: null, items };
}

/** Host or co-host: invites people (at most LIVE_INVITE_MAX_PER_REQUEST) onto the stage of a stream that is live. */
export async function inviteToLiveStream(liveStreamId: string, rawInviteeIds: unknown) {
  const me = await requireVerifiedUser();
  const inviteeIds = parseInviteeIds(rawInviteeIds, me.id);
  if (!inviteeIds || inviteeIds.length === 0) return { error: "invalid" as const };

  const stream = await prisma.liveStream.findUnique({ where: { id: liveStreamId }, select: STREAM_SELECT });
  if (!stream) return { error: "not_found" as const };
  if (!(await canInviteToStream(stream, me.id))) return { error: "forbidden" as const };

  try {
    const result = await sendLiveInvites(stream, { id: me.id, name: me.name }, inviteeIds);
    if (result.error) return { error: result.error };
    await signalStage(liveStreamId);
    // "Only the people I selected": the people just invited can now see it, so open Home tabs refetch their strip.
    if (stream.selectedOnly && result.invited.length > 0) await publishEvent(REALTIME_CHANNELS.liveStreams(), "changed");
    return { error: null, invited: result.invited, refused: result.refused };
  } catch (err) {
    await captureError(err, { action: "inviteToLiveStream", liveStreamId });
    return { error: "unavailable" as const };
  }
}

/** Host or co-host: the stream's open invites (pending, not expired), oldest first, for the room's "Invited" list. */
export async function getLiveStreamInvites(liveStreamId: string) {
  // Fail-soft like the room's other polled reads: an account that can't use this (unverified) just sees none.
  const me = await requireVerifiedUser().catch(() => null);
  if (!me) return { invites: [] };
  const stream = await prisma.liveStream.findUnique({ where: { id: liveStreamId }, select: STREAM_SELECT });
  if (!stream || !(await canInviteToStream(stream, me.id))) return { invites: [] };
  const rows = await prisma.liveStreamInvite.findMany({
    where: openInviteWhere(liveStreamId, new Date()),
    orderBy: { createdAt: "asc" },
    select: { invitee: { select: { id: true, name: true, avatarUrl: true } } },
  });
  return { invites: rows.map((r) => ({ user: r.invitee })) };
}

/** Host or co-host: withdraws an open invite. Its unread bell row goes too (a push already delivered stays). */
export async function cancelLiveInvite(liveStreamId: string, inviteeId: string) {
  const me = await requireVerifiedUser();
  if (typeof inviteeId !== "string") return { error: "invalid" as const };
  const stream = await prisma.liveStream.findUnique({ where: { id: liveStreamId }, select: STREAM_SELECT });
  if (!stream) return { error: "not_found" as const };
  if (!(await canInviteToStream(stream, me.id))) return { error: "forbidden" as const };

  const cancelled = await prisma.liveStreamInvite.updateMany({
    where: { liveStreamId, inviteeId, status: "PENDING" },
    data: { status: "CANCELLED", respondedAt: new Date() },
  });
  if (cancelled.count > 0) {
    const unread = await prisma.notification.deleteMany({
      where: { type: "LIVE_STAGE_INVITE", liveStreamId, recipientId: inviteeId, readAt: null },
    });
    // Their bell row was still unread, so they haven't acted on it: the push on their devices is corrected in place
    // ("This invite was cancelled"). Only the request that cancelled it gets here (guarded write above).
    if (unread.count > 0) await recallLiveInvitePushes(liveStreamId, [inviteeId], "cancelled");
    // "Only the people I selected": a cancelled invite they never accepted was their only way in, so watching ends
    // too (canAccessLiveStream now refuses them everywhere). Someone already on stage keeps their seat, and with it
    // access, until they leave. A Daily token can't be revoked, so they are also taken out of the room.
    if (stream.selectedOnly) {
      await removeUnseatedViewer(stream, inviteeId);
      await publishEvent(REALTIME_CHANNELS.liveStreams(), "changed");
    }
    await signalStage(liveStreamId);
  }
  return { error: null };
}

/** Takes a watch-only viewer (never a stage seat) off a selectedOnly stream: their presence row and their Daily session. */
async function removeUnseatedViewer(stream: { id: string; roomName: string; status: string }, userId: string) {
  try {
    const seat = await prisma.liveStreamViewer.findUnique({
      where: { liveStreamId_userId: { liveStreamId: stream.id, userId } },
      select: { role: true },
    });
    if (seat && seat.role !== "VIEWER") return;
    const removed = await prisma.liveStreamViewer.deleteMany({
      where: { liveStreamId: stream.id, userId, role: "VIEWER" },
    });
    // Ejected whether or not a row was there: a client can sit in the room on a token minted before the cancel.
    if (stream.status === "LIVE" && stream.roomName) await ejectFromRoom(stream.roomName, [userId]);
    if (removed.count > 0) {
      await publishEvent(REALTIME_CHANNELS.liveStream(stream.id), "changed", { kind: "presence" });
    }
  } catch (err) {
    await captureError(err, { action: "cancelLiveInvite", step: "removeViewer", liveStreamId: stream.id });
  }
}

/**
 * The invitee's own open invite to this stream, for the Accept / Decline prompt: who invited them, and until when.
 * When it can't be answered any more, `gone` says why (cancelled, expired, answered, the live ended), so a stale push or
 * bell tap lands on a clear note instead of an error. Both null when there never was one, or when a block now stands
 * between them and the inviter or host.
 */
export async function getMyLiveInvite(liveStreamId: string): Promise<{
  invite: { inviter: { id: string; name: string | null; avatarUrl: string | null }; expiresAt: string } | null;
  gone: LiveInviteGone | null;
}> {
  // Polled by the room before anyone has joined: an account that can't be invited (unverified) just has none.
  const me = await requireVerifiedUser().catch(() => null);
  if (!me) return { invite: null, gone: null };
  const invite = await prisma.liveStreamInvite.findUnique({
    where: { liveStreamId_inviteeId: { liveStreamId, inviteeId: me.id } },
    select: {
      status: true,
      createdAt: true,
      invitedBy: { select: { id: true, name: true, avatarUrl: true } },
      liveStream: { select: { status: true, hostId: true } },
    },
  });
  if (!invite) return { invite: null, gone: null };
  // A block standing between them now: no invite and no reason either (nothing that hints at the block).
  if (await isBlockedWithAny(me.id, [invite.invitedBy.id, invite.liveStream.hostId])) return { invite: null, gone: null };
  const live = invite.liveStream.status === "LIVE";
  const status = liveInviteStatus(invite, live, new Date());
  if (status !== "PENDING") return { invite: null, gone: liveInviteGone(status, live) };
  return {
    invite: {
      inviter: invite.invitedBy,
      expiresAt: new Date(invite.createdAt.getTime() + LIVE_INVITE_TTL_MS).toISOString(),
    },
    gone: null,
  };
}

/**
 * The invitee answers. Declining is final for this stream (they can't be invited to it again). Accepting takes a
 * stage seat as a guest under the stage lock (claimStageSeat): `stage_full` leaves the invite open so they can try
 * again while it lasts. The invite moves PENDING -> ACCEPTED in the same transaction, guarded, so an invite cancelled
 * or expired in the meantime takes no seat. The client then joins (or reconnects) with the guest role.
 */
export async function respondToLiveInvite(liveStreamId: string, accept: boolean) {
  const me = await requireVerifiedUser();
  if (!(await checkRateLimit("liveStreamJoin", me.id))) return { error: "rate_limited" as const };

  const invite = await prisma.liveStreamInvite.findUnique({
    where: { liveStreamId_inviteeId: { liveStreamId, inviteeId: me.id } },
    select: {
      id: true,
      status: true,
      createdAt: true,
      invitedById: true,
      liveStream: { select: STREAM_SELECT },
    },
  });
  const now = new Date();
  if (!invite) return { error: "not_found" as const };
  const stream = invite.liveStream;
  if (liveInviteStatus(invite, stream.status === "LIVE" && !!stream.roomName, now) !== "PENDING") {
    // A PENDING row that has run out is written as EXPIRED the first time anyone answers it (guarded, so it never
    // overwrites a decision that landed meanwhile). Everything else already reads it as expired.
    await prisma.liveStreamInvite.updateMany({
      where: { id: invite.id, status: "PENDING" },
      data: { status: "EXPIRED", respondedAt: now },
    });
    return { error: "expired" as const };
  }
  const markRead = () =>
    prisma.notification.updateMany({
      where: { type: "LIVE_STAGE_INVITE", liveStreamId, recipientId: me.id, readAt: null },
      data: { readAt: now },
    });

  if (accept !== true) {
    await prisma.liveStreamInvite.updateMany({
      where: { id: invite.id, status: "PENDING" },
      data: { status: "DECLINED", respondedAt: now },
    });
    await markRead();
    await signalStage(liveStreamId);
    return { error: null };
  }

  if (
    !(await canAccessLiveStream(stream, me)) ||
    (await isBlockedWithAny(me.id, [stream.hostId, invite.invitedById]))
  ) {
    return { error: "unavailable" as const };
  }

  const gone = Symbol("invite-gone");
  let outcome: "admitted" | "already" | "full";
  try {
    outcome = await prisma.$transaction(async (tx) => {
      const seat = await claimStageSeat(tx, { liveStreamId, hostId: stream.hostId, userId: me.id, role: "GUEST", now });
      if (seat === "full") return seat;
      const moved = await tx.liveStreamInvite.updateMany({
        where: { id: invite.id, status: "PENDING", createdAt: { gt: new Date(now.getTime() - LIVE_INVITE_TTL_MS) } },
        data: { status: "ACCEPTED", respondedAt: now },
      });
      // Cancelled or expired while this ran: throwing rolls the seat back.
      if (moved.count === 0) throw gone;
      // A request of theirs still waiting on the host is settled by this.
      await tx.liveStreamStageRequest.updateMany({
        where: { liveStreamId, userId: me.id, status: "PENDING" },
        data: { status: "APPROVED", respondedAt: now },
      });
      return seat;
    });
  } catch (err) {
    if (err === gone) return { error: "expired" as const };
    await captureError(err, { action: "respondToLiveInvite", liveStreamId });
    return { error: "unavailable" as const };
  }
  if (outcome === "full") return { error: "stage_full" as const };

  await markRead();
  await signalStage(liveStreamId);
  return { error: null };
}
