"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireVerifiedUser, requireVerifiedViewer } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  createLiveStreamRoom,
  createMeetingToken,
  deleteCallRoom,
  ejectFromRoom,
  isCallingConfigured,
  listRoomRecordings,
  getRecordingAccessLink,
} from "@/lib/daily";
import { getCircleMembership } from "@/lib/circle-permissions";
import { canAccessLiveStream } from "@/lib/live-stream-access";
import { liveStreamTitleSchema, liveStreamJoinRoleSchema, liveStreamCommentSchema } from "@/lib/validations";
import { moderateText } from "@/lib/moderation";
import { publishEvent } from "@/lib/realtime-server";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";
import type { LiveStreamSignalKind } from "@/lib/live-stream-signal";
import { captureError } from "@/lib/error-tracking";
import { isUniqueConstraintError } from "@/lib/prisma-errors";
import { liveChatPageQuery } from "@/lib/live-chat-page";
import { announceLiveStream } from "@/lib/live-stream-announce";
import { existingLiveDecision, liveStartLockKey } from "@/lib/live-stream-start";
import {
  LIVE_TOKEN_TTL_SECONDS,
  holdsViewerSlot,
  isStreamFull,
  isViewerCapExempt,
  liveViewerLockKey,
  otherViewingsWhere,
  slotHoldingViewerWhere,
  viewerCapDecision,
} from "@/lib/live-viewer-cap";

/** Co-host + guest slots available per stream, on top of the host — up to MAX_LIVE_VIEWERS (live-viewer-cap.ts) watch alongside them. */
const MAX_STAGE_PARTICIPANTS = 3;

/** Most live streams Home's "Live now" strip and feed cards list at once (newest first). */
const ACTIVE_LIVE_STREAMS_LIMIT = 30;

/**
 * Every publish onto a stream's own channel says what changed, so listeners
 * refetch only that (see live-stream-signal.ts). The kind is the whole
 * payload — never comment text, a user id or anything else: the channel is
 * public and Circle-/person-private streams publish on it too.
 */
function publishLiveStreamSignal(liveStreamId: string, kind: LiveStreamSignalKind) {
  return publishEvent(REALTIME_CHANNELS.liveStream(liveStreamId), "changed", { kind });
}

/** Starts a new live stream — rejects if the host already has one running (see LiveStream.status). */
export async function startLiveStream(formData: FormData) {
  const user = await requireVerifiedUser();

  if (!isCallingConfigured()) {
    return { error: "not_configured" as const };
  }

  const allowed = await checkRateLimit("liveStreamStart", user.id);
  if (!allowed) {
    return { error: "rate_limited" as const };
  }

  const parsed = liveStreamTitleSchema.safeParse({
    title: formData.get("title"),
    circleId: formData.get("circleId") || undefined,
    targetUserId: formData.get("targetUserId") || undefined,
  });
  if (!parsed.success) {
    return { error: "invalid" as const };
  }
  const { title, circleId, targetUserId } = parsed.data;
  // The title is shown to everyone on Home's "Live now" (and in invites): same text gate as posts, refused if flagged
  // (a stream has no hidden/held state to put it in).
  const titleCheck = await moderateText(title);
  if (!titleCheck.allowed) {
    return { error: "moderation" as const };
  }

  if (circleId && !(await getCircleMembership(circleId, user.id))) {
    return { error: "not_a_member" as const };
  }

  if (targetUserId) {
    // Re-validated server-side, never trusted from the client: the picker
    // only ever offers the host's own accepted Connections, but a request
    // is independently callable with any id — without this, anyone could
    // start a stream "with" an arbitrary user (who'd then get a
    // LIVE_STREAM_INVITE notification/push naming them, out of nowhere).
    const isConnection = await prisma.connection.findFirst({
      where: {
        status: "ACCEPTED",
        OR: [
          { requesterId: user.id, targetId: targetUserId },
          { requesterId: targetUserId, targetId: user.id },
        ],
      },
      select: { id: true },
    });
    if (!isConnection) {
      return { error: "not_a_connection" as const };
    }
  }

  // Check-and-create under a per-host advisory lock: a double tap, a second device or a client retry can't create a
  // second stream (and a second Daily room and a second round of notifications) for the same host. The lock is
  // per host, so other people going live at the same moment never wait on it.
  const now = new Date();
  const claim = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${liveStartLockKey(user.id)}))`;
    const existing = await tx.liveStream.findFirst({
      where: { hostId: user.id, status: "LIVE" },
      orderBy: { startedAt: "desc" },
      select: { id: true, roomName: true, startedAt: true },
    });
    const decision = existingLiveDecision(existing, now);
    if (decision === "already_live") return { alreadyLiveId: existing!.id };
    if (decision === "reclaim") {
      // A start of theirs that died before its room was attached: end it rather than block them with "already
      // live" until the inactivity cron gets to it.
      await tx.liveStream.update({ where: { id: existing!.id }, data: { status: "ENDED", endedAt: now } });
    }
    const created = await tx.liveStream.create({
      data: { hostId: user.id, circleId, targetUserId, title, roomName: "", roomUrl: "" },
      select: { id: true },
    });
    return { liveStreamId: created.id };
  });
  if ("alreadyLiveId" in claim) {
    return { error: "already_live" as const, liveStreamId: claim.alreadyLiveId };
  }
  const liveStreamId = claim.liveStreamId;

  // Every failure from here on removes this half-made stream, so it never shows on Home or blocks the next try.
  const abandon = async () => {
    await prisma.liveStream.deleteMany({ where: { id: liveStreamId, roomName: "" } }).catch(() => undefined);
  };

  let room;
  try {
    room = await createLiveStreamRoom({ name: `live-${liveStreamId}` });
  } catch (err) {
    await captureError(err, { action: "startLiveStream", step: "createRoom" });
    await abandon();
    return { error: "call_service_unavailable" as const };
  }

  let token: string;
  try {
    token = await createMeetingToken({
      roomName: room.name,
      userId: user.id,
      userName: user.name ?? "Guest",
      isOwner: true,
    });
  } catch (err) {
    await captureError(err, { action: "startLiveStream", step: "createToken" });
    await deleteCallRoom(room.name);
    await abandon();
    return { error: "call_service_unavailable" as const };
  }

  try {
    await prisma.liveStream.update({
      where: { id: liveStreamId },
      data: { roomName: room.name, roomUrl: room.url },
    });
  } catch (err) {
    await captureError(err, { action: "startLiveStream", step: "attachRoom" });
    await deleteCallRoom(room.name);
    await abandon();
    return { error: "call_service_unavailable" as const };
  }

  // Everything else is secondary and runs after the host already has their answer: telling the audience
  // (announceLiveStream: exactly once, retried by the end-inactive-streams cron if this run is lost or fails) and
  // nudging open Home tabs. Neither can delay or fail going live.
  after(async () => {
    await announceLiveStream(liveStreamId);
  });
  after(async () => {
    await publishEvent(REALTIME_CHANNELS.liveStreams(), "changed");
  });

  revalidatePath("/home");
  return { error: null, liveStreamId, roomUrl: room.url, token };
}

/** Host-only: ends the stream and best-effort tears down the Daily room. */
export async function endLiveStream(liveStreamId: string) {
  const user = await requireVerifiedUser();

  const liveStream = await prisma.liveStream.findUnique({ where: { id: liveStreamId } });
  if (!liveStream || liveStream.hostId !== user.id) {
    return { error: "not_found" as const };
  }
  if (liveStream.status === "ENDED") {
    return { error: null };
  }

  await prisma.liveStream.update({
    where: { id: liveStreamId },
    data: { status: "ENDED", endedAt: new Date() },
  });
  await deleteCallRoom(liveStream.roomName);
  await publishEvent(REALTIME_CHANNELS.liveStreams(), "changed");

  revalidatePath("/home");
  revalidatePath(`/live/${liveStreamId}`);
  return { error: null };
}

/**
 * Polled by the host and any COHOST from live-stream-room.tsx's existing
 * poll loop — bumps LiveStream.lastHostActivityAt so the
 * end-inactive-streams cron knows the stream is still being actively run.
 * Plain viewers/guests silently no-op (not an error) since they don't drive
 * this signal.
 */
export async function recordLiveStreamHeartbeat(liveStreamId: string) {
  const user = await requireVerifiedUser();

  // The host's beat is one guarded write on their own stream's row (nothing shared with any other stream).
  const hostBeat = await prisma.liveStream.updateMany({
    where: { id: liveStreamId, hostId: user.id, status: "LIVE" },
    data: { lastHostActivityAt: new Date() },
  });
  if (hostBeat.count > 0) return { error: null };

  const viewer = await prisma.liveStreamViewer.findUnique({
    where: { liveStreamId_userId: { liveStreamId, userId: user.id } },
    select: { role: true },
  });
  if (viewer?.role !== "COHOST") {
    return { error: null };
  }
  const coHostBeat = await prisma.liveStream.updateMany({
    where: { id: liveStreamId, status: "LIVE" },
    data: { lastHostActivityAt: new Date() },
  });
  return coHostBeat.count > 0 ? { error: null } : { error: "not_found" as const };
}

/**
 * Mints a meeting token for the room. Plain viewers get a view-only token —
 * owner_only_broadcast on the room (see createLiveStreamRoom) is what
 * actually keeps them from unmuting camera/mic. A caller can instead request
 * `role: "GUEST"` or `"COHOST"` to ask for one of MAX_STAGE_PARTICIPANTS
 * stage slots alongside the host — as of the stage-request workflow below,
 * that request no longer grants the role immediately: it creates a PENDING
 * LiveStreamStageRequest and the caller still joins as a plain VIEWER,
 * watching, until the host explicitly approves it via respondToStageRequest.
 * Once approved (or immediately, for someone re-joining who was already
 * GUEST/COHOST from an earlier approval on this same stream), their
 * LiveStreamViewer row records the role, and the guest's own client
 * (live-stream-room.tsx) notices the approval and reconnects with a fresh
 * token from this action, which carries is_owner for an approved GUEST/COHOST
 * (see the reconnect-on-approval comment in live-stream-room.tsx for why
 * only is_owner lifts Daily's viewer gate). The host's own join (isHost)
 * always ignores the requested role — they're identified by
 * LiveStream.hostId, not by their LiveStreamViewer row, and are excluded
 * from both the viewer and stage tallies below.
 */
export async function joinLiveStream(liveStreamId: string, requestedRole?: "GUEST" | "COHOST") {
  const user = await requireVerifiedUser();

  if (!isCallingConfigured()) {
    return { error: "not_configured" as const };
  }

  const allowed = await checkRateLimit("liveStreamJoin", user.id);
  if (!allowed) {
    return { error: "rate_limited" as const };
  }

  const parsedRole = liveStreamJoinRoleSchema.safeParse(requestedRole);
  if (!parsedRole.success) {
    return { error: "invalid" as const };
  }

  // Everything below is wrapped in one try/catch: a transient DB hiccup on
  // any of these plain (un-try/catched) prisma calls — confirmed happening
  // in production, see the "Postgres pool error: terminating connection due
  // to administrator command" entries Neon's serverless Postgres logs when
  // it drops an idle connection out from under the pool — used to propagate
  // as an unhandled rejection all the way to the client. requestJoin() in
  // live-stream-room.tsx had no .catch() on this call, so that rejection
  // left the screen stuck on "Joining live stream…" forever, on any
  // platform, with no error shown and no way forward short of leaving the
  // page — confirmed live via a real user's screenshot. Turning it into a
  // returned error is what actually makes that .catch() fallback
  // reachable-but-rare instead of the normal path for any transient blip.
  try {
    const liveStream = await prisma.liveStream.findUnique({ where: { id: liveStreamId } });
    // No room yet: a start still in progress (or one that failed part-way), nothing to join.
    if (!liveStream || liveStream.status !== "LIVE" || !liveStream.roomName) {
      return { error: "not_found" as const };
    }
    if (!(await canAccessLiveStream(liveStream, user))) {
      return { error: "not_a_member" as const };
    }

    const isHost = liveStream.hostId === user.id;
    const now = new Date();
    // This person's own presence row on this stream, if any: what decides an already-approved stage role, whether
    // they already hold a viewer slot (a reload or reconnect), and whether they're a co-host (exempt from the cap).
    const existing = await prisma.liveStreamViewer.findUnique({
      where: { liveStreamId_userId: { liveStreamId, userId: user.id } },
      select: { role: true, joinedAt: true },
    });
    let role: "VIEWER" | "GUEST" | "COHOST" = "VIEWER";
    // Only skip the approval flow when their existing role already covers
    // what they're asking for now — COHOST covers any request (it's the
    // higher tier: it also carries GUEST's canSend grant, plus recording),
    // and an exact role match is obviously already covered. A GUEST
    // asking to become COHOST is a real privilege escalation (recording
    // access — see canRecord in live-stream-room.tsx) and must still go
    // through a fresh approval below, not be silently satisfied by their
    // old GUEST role. Already approved earlier on this same stream (e.g. a
    // reconnect after a dropped connection, or asking again for the same
    // role) rejoins straight onto the stage rather than making them ask again.
    const alreadyOnStage =
      !isHost && !!parsedRole.data && (existing?.role === "COHOST" || existing?.role === parsedRole.data);
    if (alreadyOnStage) role = existing!.role;

    // The viewer cap (live-viewer-cap.ts): counting who holds a slot and writing this person's row happen under one
    // per-stream lock, so two people racing for the last slot can't both get it. The host, co-hosts and admins are
    // always let in; someone who already holds a slot (a reload, a reconnect) is never refused or counted twice.
    const exempt = isViewerCapExempt({ isHost, isAdmin: user.isAdmin, existingRole: existing?.role });
    const alreadyHoldsSlot = holdsViewerSlot(existing, user.lastSeenAt, now);
    const rowRole = isHost ? "COHOST" : role;
    const claim = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${liveViewerLockKey(liveStreamId)}))`;
      if (!exempt && !alreadyHoldsSlot) {
        const othersHoldingSlots = await tx.liveStreamViewer.count({
          where: { liveStreamId, userId: { notIn: [user.id, liveStream.hostId] }, ...slotHoldingViewerWhere(now) },
        });
        if (viewerCapDecision({ exempt, alreadyHoldsSlot, othersHoldingSlots }) === "full") return "full" as const;
      }
      await tx.liveStreamViewer.upsert({
        where: { liveStreamId_userId: { liveStreamId, userId: user.id } },
        create: { liveStreamId, userId: user.id, role: rowRole, joinedAt: now },
        update: { joinedAt: now, role: rowRole },
      });
      // One viewing per person: getting into this stream ends their viewing of any other (its slot is free at once,
      // and nobody is ever counted in two streams). Only after this stream's claim succeeded, so a refused (full)
      // join leaves the previous viewing alone. Never a co-host seat, and never anything on a stream they host:
      // hosting isn't a viewing, and watching someone else never ends their own live (otherViewingsWhere).
      const left = await tx.liveStreamViewer.findMany({
        where: otherViewingsWhere(user.id, liveStreamId),
        select: { liveStreamId: true, liveStream: { select: { roomName: true, status: true } } },
      });
      if (left.length > 0) {
        await tx.liveStreamViewer.deleteMany({
          where: { ...otherViewingsWhere(user.id, liveStreamId), liveStreamId: { in: left.map((l) => l.liveStreamId) } },
        });
      }
      return { left };
    });
    if (claim === "full") {
      // Nothing written and no Daily token minted: a full stream costs one locked count, not a Daily API call.
      return { error: "stream_full" as const };
    }
    if (claim.left.length > 0) {
      // After the answer, never part of it: tell the streams they left (their counts moved) and take this person's
      // session out of those rooms, since a Daily token can't be revoked and the server doesn't trust the client to
      // have left. Both are best-effort and can't fail or slow this join.
      const left = claim.left;
      const userId = user.id;
      after(async () => {
        await Promise.allSettled(
          left.flatMap((l) => [
            publishLiveStreamSignal(l.liveStreamId, "presence"),
            l.liveStream.status === "LIVE" ? ejectFromRoom(l.liveStream.roomName, [userId]) : Promise.resolve(),
          ]),
        );
      });
    }

    // Non-null only when this call just filed (or re-filed) a pending
    // request rather than landing directly on stage — the client uses this
    // to show a "waiting for the host" state instead of full stage
    // controls. Filed only once they're actually in, so a refused (full)
    // join never leaves a request in front of the host.
    let pendingStageRequest: "GUEST" | "COHOST" | null = null;
    if (!isHost && parsedRole.data && !alreadyOnStage) {
      // Capacity is checked at approval time (respondToStageRequest), not
      // here — a request is allowed to sit pending even while the stage
      // is momentarily full, in case a slot opens up.
      await prisma.liveStreamStageRequest.upsert({
        where: { liveStreamId_userId: { liveStreamId, userId: user.id } },
        create: { liveStreamId, userId: user.id, role: parsedRole.data, status: "PENDING" },
        update: { role: parsedRole.data, status: "PENDING", respondedAt: null },
      });
      pendingStageRequest = parsedRole.data;
    }

    let token: string;
    try {
      token = await createMeetingToken({
        roomName: liveStream.roomName,
        userId: user.id,
        userName: user.name ?? "Guest",
        // is_owner is what actually lifts owner_only_broadcast for an
        // approved guest/co-host — see createMeetingToken. role is already
        // "VIEWER" unless the alreadyOnStage branch above set it from an
        // existing GUEST/COHOST row, so this is true exactly when they're
        // actually approved. This does mean an approved stage participant
        // becomes a real Daily meeting owner (can mute/eject others, admin
        // recording, etc.) — an accepted tradeoff, not an oversight: it's
        // the only thing Daily's own docs describe as lifting this
        // restriction, and confirmed live that permissions.canSend alone
        // does not.
        isOwner: isHost || role === "GUEST" || role === "COHOST",
        expiresInSeconds: LIVE_TOKEN_TTL_SECONDS,
      });
    } catch {
      // A slot this call took (no row before) is given back; a refreshed existing row is left as it was claimed.
      if (!existing) {
        await prisma.liveStreamViewer.deleteMany({ where: { liveStreamId, userId: user.id } }).catch(() => undefined);
      }
      return { error: "call_service_unavailable" as const };
    }

    // A plain watch-only join — a real viewer's or a Home feed card's
    // preview (live-stream-preview-embed.tsx), which are the same call —
    // only moves the counts, so it's "presence", which listeners throttle.
    // Asking for a stage role is "stage": it may have just filed a request
    // the host needs to see straight away.
    await publishLiveStreamSignal(liveStreamId, !isHost && parsedRole.data ? "stage" : "presence");

    return { error: null, roomUrl: liveStream.roomUrl, token, role, pendingStageRequest };
  } catch (err) {
    // Swallowing this silently was itself a gap: the client-facing "try
    // again" UX now works (see live-stream-room.tsx), but with nothing
    // logged here there was no way to tell what's actually causing this —
    // a genuine device network issue, the Postgres pool termination race
    // (see the comment above), or something else entirely. Logging it is
    // what makes the next occurrence actually diagnosable via Netlify
    // function logs instead of another guess.
    console.error("joinLiveStream failed:", err);
    await captureError(err, { action: "joinLiveStream", liveStreamId });
    return { error: "unavailable" as const };
  }
}

/**
 * Host-only: pending GUEST/COHOST requests waiting on a decision, oldest
 * first (so the host works through them in the order they came in). Fetched
 * by live-stream-room.tsx's fetchStage.
 */
export async function getLiveStreamStageRequests(liveStreamId: string) {
  const user = await requireVerifiedUser();

  const liveStream = await prisma.liveStream.findUnique({
    where: { id: liveStreamId },
    select: { hostId: true },
  });
  if (!liveStream || liveStream.hostId !== user.id) {
    return { requests: [] };
  }

  const requests = await prisma.liveStreamStageRequest.findMany({
    where: { liveStreamId, status: "PENDING" },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { id: true, name: true, avatarUrl: true } } },
  });

  return {
    requests: requests.map((r) => ({ id: r.id, role: r.role as "GUEST" | "COHOST", user: r.user })),
  };
}

/**
 * Host-only: approves or declines a pending stage request. Approving is what
 * actually turns it into a LiveStreamViewer role change — respondToStageRequest
 * is the only place that happens for a non-host outside of the
 * already-on-stage reconnect shortcut in joinLiveStream above. Capacity
 * (MAX_STAGE_PARTICIPANTS) is enforced here, not at request time, since a
 * request can sit pending through a momentarily full stage.
 */
export async function respondToStageRequest(requestId: string, approve: boolean) {
  const user = await requireVerifiedUser();

  const request = await prisma.liveStreamStageRequest.findUnique({
    where: { id: requestId },
    include: { liveStream: { select: { hostId: true } } },
  });
  if (!request) {
    return { error: "not_found" as const };
  }
  if (request.liveStream.hostId !== user.id) {
    return { error: "forbidden" as const };
  }
  // Already handled (e.g. a double-click, or the requester cancelled in the
  // meantime) — idempotent no-op rather than an error.
  if (request.status !== "PENDING") {
    return { error: null };
  }

  if (approve) {
    const stageCount = await prisma.liveStreamViewer.count({
      where: {
        liveStreamId: request.liveStreamId,
        role: { in: ["GUEST", "COHOST"] },
        userId: { not: request.liveStream.hostId },
      },
    });
    if (stageCount >= MAX_STAGE_PARTICIPANTS) {
      return { error: "stage_full" as const };
    }

    await prisma.liveStreamViewer.upsert({
      where: { liveStreamId_userId: { liveStreamId: request.liveStreamId, userId: request.userId } },
      create: { liveStreamId: request.liveStreamId, userId: request.userId, role: request.role },
      update: { role: request.role },
    });
  }

  await prisma.liveStreamStageRequest.update({
    where: { id: requestId },
    data: { status: approve ? "APPROVED" : "DECLINED", respondedAt: new Date() },
  });
  await publishLiveStreamSignal(request.liveStreamId, "stage");

  return { error: null };
}

/** Requester-only: withdraws their own still-pending stage request, so they can go back to just watching without waiting on a host decision. */
export async function cancelStageRequest(liveStreamId: string) {
  const user = await requireVerifiedUser();
  await prisma.liveStreamStageRequest.deleteMany({
    where: { liveStreamId, userId: user.id, status: "PENDING" },
  });
  await publishLiveStreamSignal(liveStreamId, "stage");
  return { error: null };
}

/**
 * Polled by a requester's own client while a stage request is outstanding,
 * to detect the host's decision (or an in-progress rejoin's already-on-stage
 * role) without forcing a full rejoin of the room.
 */
export async function getMyLiveStreamStatus(liveStreamId: string) {
  const user = await requireVerifiedViewer();

  const [request, viewer] = await Promise.all([
    prisma.liveStreamStageRequest.findUnique({
      where: { liveStreamId_userId: { liveStreamId, userId: user.id } },
      select: { status: true, role: true },
    }),
    prisma.liveStreamViewer.findUnique({
      where: { liveStreamId_userId: { liveStreamId, userId: user.id } },
      select: { role: true },
    }),
  ]);

  return {
    role: (viewer?.role ?? "VIEWER") as "VIEWER" | "GUEST" | "COHOST",
    requestStatus: request?.status ?? null,
    requestedRole: (request?.role ?? null) as "GUEST" | "COHOST" | null,
  };
}

export async function leaveLiveStream(liveStreamId: string) {
  const user = await requireVerifiedUser();

  await prisma.liveStreamViewer.deleteMany({ where: { liveStreamId, userId: user.id } });
  await publishLiveStreamSignal(liveStreamId, "presence");
  return { error: null };
}

/**
 * The Home "Live now" strip: streams started for "Everyone" (no circleId, no
 * targetUserId) and for a PUBLIC Circle. A stream started for a PRIVATE
 * Circle or sub-circle never appears here — not even to that Circle's own
 * members; it's shown on that Circle's page instead
 * (src/app/circles/[slug]/page.tsx), to its members only. A stream started
 * for one specific person never appears here either, for anyone, including
 * that person — their only way in is the LIVE_STREAM_INVITE notification's
 * own link, same as a PRIVATE Circle's members rely on CIRCLE_LIVE.
 */
export async function getActiveLiveStreams() {
  try {
    await requireVerifiedViewer();

    const streams = await prisma.liveStream.findMany({
      where: {
        status: "LIVE",
        // A start still attaching its room isn't listed until it can be joined.
        roomName: { not: "" },
        targetUserId: null,
        OR: [{ circleId: null }, { circle: { visibility: "PUBLIC" } }],
      },
      orderBy: { startedAt: "desc" },
      // Bounded: every open Home tab runs this on each live-streams signal, so its cost must not grow with how
      // many people are live at once.
      take: ACTIVE_LIVE_STREAMS_LIMIT,
      include: {
        host: { select: { id: true, name: true, avatarUrl: true } },
        // role: "VIEWER" also excludes the host's own row (stored as COHOST — see joinLiveStream).
        _count: { select: { viewers: { where: { role: "VIEWER" } } } },
      },
    });

    // Which of them are at the viewer cap, so a feed card can say "Full" instead of trying to play: one grouped count
    // over at most ACTIVE_LIVE_STREAMS_LIMIT streams (LiveStreamViewer is indexed on liveStreamId).
    const slotsHeld = new Map<string, number>();
    if (streams.length > 0) {
      const groups = await prisma.liveStreamViewer.groupBy({
        by: ["liveStreamId"],
        where: { liveStreamId: { in: streams.map((s) => s.id) }, ...slotHoldingViewerWhere(new Date()) },
        _count: { _all: true },
      });
      for (const g of groups) slotsHeld.set(g.liveStreamId, g._count._all);
    }

    return {
      streams: streams.map((s) => ({
        id: s.id,
        title: s.title,
        host: s.host,
        viewerCount: s._count.viewers,
        full: isStreamFull(slotsHeld.get(s.id) ?? 0),
      })),
    };
  } catch {
    return { streams: [] };
  }
}

/**
 * Polled by the live room to show a live watching-viewer count plus how many
 * of the MAX_STAGE_PARTICIPANTS co-host/guest stage slots are filled. The
 * host is excluded from both counts (see joinLiveStream's doc comment).
 * `withFull` (the Home feed card only) also answers whether the stream is at
 * its viewer cap, so the card can stop showing "Full" once a slot opens; the
 * room itself doesn't ask, so its frequent refetches cost no extra count.
 */
export async function getLiveStreamViewerCount(liveStreamId: string, options?: { withFull?: boolean }) {
  const empty = { count: 0, stageCount: 0, stageCapacity: MAX_STAGE_PARTICIPANTS, full: false };
  try {
    const user = await requireVerifiedViewer();

    const liveStream = await prisma.liveStream.findUnique({
      where: { id: liveStreamId },
      select: { hostId: true, circleId: true, targetUserId: true },
    });
    if (!liveStream || !(await canAccessLiveStream(liveStream, user))) {
      return empty;
    }

    const [count, stageCount, slotsHeld] = await Promise.all([
      prisma.liveStreamViewer.count({
        where: { liveStreamId, role: "VIEWER", userId: { not: liveStream.hostId } },
      }),
      prisma.liveStreamViewer.count({
        where: { liveStreamId, role: { in: ["GUEST", "COHOST"] }, userId: { not: liveStream.hostId } },
      }),
      options?.withFull === true
        ? prisma.liveStreamViewer.count({
            where: { liveStreamId, userId: { not: liveStream.hostId }, ...slotHoldingViewerWhere(new Date()) },
          })
        : Promise.resolve(0),
    ]);
    return { count, stageCount, stageCapacity: MAX_STAGE_PARTICIPANTS, full: isStreamFull(slotsHeld) };
  } catch {
    return empty;
  }
}

/**
 * Lists cloud recordings for this stream's room, fetched live from Daily.
 * Same access rule as the stream itself (canAccessLiveStream): an "Everyone"
 * or PUBLIC-Circle stream's recordings are open to any verified user, a
 * PRIVATE Circle's only to that Circle's members, and a stream started with
 * one specific person's only to that person.
 */
export async function listLiveStreamRecordings(liveStreamId: string) {
  let user;
  try {
    user = await requireVerifiedUser();
  } catch {
    return { recordings: [] };
  }

  const liveStream = await prisma.liveStream.findUnique({
    where: { id: liveStreamId },
    select: { roomName: true, circleId: true, targetUserId: true, hostId: true },
  });
  if (!liveStream?.roomName || !(await canAccessLiveStream(liveStream, user))) {
    return { recordings: [] };
  }

  const recordings = await listRoomRecordings(liveStream.roomName);
  return {
    recordings: recordings
      .filter((r) => r.status === "finished")
      .map((r) => ({ id: r.id, startedAt: r.start_ts, durationSeconds: r.duration ?? null })),
  };
}

/**
 * Fetches a fresh, short-lived download link for a recording. Requires the
 * caller's own liveStreamId (previously took only a bare recordingId, which
 * getRecordingAccessLink itself can't scope to a room) so this can verify
 * the recording actually belongs to that stream's own room before minting a
 * link — otherwise any verified user who obtained a recordingId from one
 * stream (e.g. via listLiveStreamRecordings) could pass it here unscoped and
 * download a recording from a different, possibly Circle-restricted, stream.
 */
export async function getLiveStreamRecordingLink(liveStreamId: string, recordingId: string) {
  const user = await requireVerifiedUser();

  const liveStream = await prisma.liveStream.findUnique({
    where: { id: liveStreamId },
    select: { roomName: true, circleId: true, targetUserId: true, hostId: true },
  });
  if (!liveStream?.roomName || !(await canAccessLiveStream(liveStream, user))) {
    return { error: "unavailable" as const };
  }

  const recordings = await listRoomRecordings(liveStream.roomName);
  if (!recordings.some((r) => r.id === recordingId)) {
    return { error: "unavailable" as const };
  }

  try {
    const url = await getRecordingAccessLink(recordingId);
    return { error: null, url };
  } catch {
    return { error: "unavailable" as const };
  }
}

/**
 * Host-only: marks one in-progress Daily recording to be auto-posted to the
 * Home Feed (or into the stream's own Circle) once it finishes processing —
 * the "Record & Post" button's server half (see live-stream-room.tsx). All
 * this does is create the LiveStreamRecordingPost row; the
 * process-live-stream-recordings cron and lib/live-stream-recording-post.ts
 * do the actual work, including the same content-moderation review every
 * other video post goes through.
 *
 * Host-only rather than host-or-co-host (a co-host *can* record — see
 * canRecord in live-stream-room.tsx): the resulting Post is authored by the
 * host, so letting a co-host publish to the host's own profile/feed would be
 * a different, bigger permission than recording. The button isn't shown to
 * co-hosts either, so this check is a backstop, not the UX.
 *
 * Refuses outright for a targetUserId-scoped stream regardless of what the
 * client asked for: there's no Post visibility tier for "private to exactly
 * one other person," so auto-posting one would be a real content-exposure
 * bug. The client gates the button on the same condition
 * (recordingAutoPostAvailable), but this is the check that actually matters.
 */
export async function requestLiveStreamRecordingPost(liveStreamId: string, recordingId: string) {
  const user = await requireVerifiedUser();

  const liveStream = await prisma.liveStream.findUnique({
    where: { id: liveStreamId },
    select: { hostId: true, circleId: true, targetUserId: true },
  });
  if (!liveStream || liveStream.hostId !== user.id) {
    return { error: "not_found" as const };
  }
  if (liveStream.targetUserId) {
    return { error: "not_available" as const };
  }

  try {
    await prisma.liveStreamRecordingPost.create({
      data: {
        liveStreamId,
        recordingId,
        // Frozen here, not re-derived later: the scoping decision belongs to
        // the moment the host tapped the button (see the model's own doc
        // comment in schema.prisma).
        hostId: liveStream.hostId,
        circleId: liveStream.circleId,
        status: "PENDING",
      },
    });
  } catch (err) {
    // recordingId is @unique — a second call for the same recording (a
    // client-side retry after a network blip, a double-tap) is a harmless
    // no-op, not an error worth surfacing. Any other failure still is.
    if (isUniqueConstraintError(err)) {
      return { error: null };
    }
    throw err;
  }

  return { error: null };
}

/**
 * Posts a message to a live stream's own text-chat overlay — separate from
 * Daily's built-in room chat (enabled on every room but rendered inside its
 * cross-origin prebuilt iframe, so this app can't style/position it as the
 * always-visible scrolling feed the UI actually shows). Same visibility
 * rule as joining (canAccessLiveStream): a Circle-scoped stream requires
 * membership, a person-scoped one requires being that specific person.
 */
export async function sendLiveStreamComment(liveStreamId: string, formData: FormData) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("liveStreamComment", user.id);
  if (!allowed) {
    return { error: "rate_limited" as const };
  }

  const liveStream = await prisma.liveStream.findUnique({ where: { id: liveStreamId } });
  if (!liveStream || liveStream.status !== "LIVE") {
    return { error: "not_found" as const };
  }
  if (!(await canAccessLiveStream(liveStream, user))) {
    return { error: "not_a_member" as const };
  }

  const parsed = liveStreamCommentSchema.safeParse({ content: formData.get("content") });
  if (!parsed.success) {
    return { error: "invalid" as const };
  }

  const modResult = await moderateText(parsed.data.content);
  if (!modResult.allowed) {
    return { error: "moderation" as const };
  }

  await prisma.liveStreamComment.create({
    data: { liveStreamId, authorId: user.id, content: parsed.data.content },
  });
  await publishLiveStreamSignal(liveStreamId, "comment");

  return { error: null };
}

/**
 * Polled by the stream's chat overlay — same fail-soft shape as
 * getLiveStreamViewerCount (a polling loop shouldn't surface a transient
 * blip as a visible error). `afterId` is a plain cursor (this comment's id
 * or later), not a timestamp, avoiding any clock-skew edge case between
 * client and server. Every answer is capped (src/lib/live-chat-page.ts), with or without a cursor.
 */
export async function getLiveStreamComments(liveStreamId: string, afterId?: string) {
  try {
    const user = await requireVerifiedViewer();

    // Same rule as joining: without this anyone signed in who had a restricted stream's id (Circle- or person-scoped) could read its chat.
    const liveStream = await prisma.liveStream.findUnique({
      where: { id: liveStreamId },
      select: { hostId: true, circleId: true, targetUserId: true },
    });
    if (!liveStream || !(await canAccessLiveStream(liveStream, user))) {
      return { comments: [] };
    }

    // The cursor only counts when it is a comment of THIS stream; anything else is treated as no cursor.
    const after =
      typeof afterId === "string" && afterId
        ? await prisma.liveStreamComment.findFirst({
            where: { id: afterId, liveStreamId },
            select: { createdAt: true, id: true },
          })
        : null;

    // Every answer is capped (liveChatPageQuery): the first fetch is the latest LIVE_CHAT_FIRST_PAGE comments, each
    // later one at most LIVE_CHAT_PAGE_MAX after the cursor (the client advances its cursor to the last one it got,
    // so a burst larger than that arrives over the next fetches instead of in one unbounded response).
    const { args, newestFirst } = liveChatPageQuery(liveStreamId, after);
    const rows = await prisma.liveStreamComment.findMany({
      where: args.where,
      orderBy: args.orderBy,
      take: args.take,
      include: { author: { select: { id: true, name: true, avatarUrl: true } } },
    });
    const comments = newestFirst ? rows.reverse() : rows;

    return {
      comments: comments.map((c) => ({
        id: c.id,
        content: c.content,
        createdAt: c.createdAt,
        author: c.author,
      })),
    };
  } catch {
    return { comments: [] };
  }
}
