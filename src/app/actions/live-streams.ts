"use server";

import { revalidatePath } from "next/cache";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  createLiveStreamRoom,
  createMeetingToken,
  deleteCallRoom,
  isCallingConfigured,
  listRoomRecordings,
  getRecordingAccessLink,
} from "@/lib/daily";
import { getCircleMembership } from "@/lib/circle-permissions";
import { liveStreamTitleSchema, liveStreamJoinRoleSchema } from "@/lib/validations";
import { notifySubscribers } from "@/lib/notify-subscribers";

/** Co-host + guest slots available per stream, on top of the host — unlimited viewers watch alongside them. */
const MAX_STAGE_PARTICIPANTS = 3;

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
  });
  if (!parsed.success) {
    return { error: "invalid" as const };
  }
  const { title, circleId } = parsed.data;

  const existing = await prisma.liveStream.findFirst({
    where: { hostId: user.id, status: "LIVE" },
  });
  if (existing) {
    return { error: "already_live" as const, liveStreamId: existing.id };
  }

  if (circleId && !(await getCircleMembership(circleId, user.id))) {
    return { error: "not_a_member" as const };
  }

  const liveStream = await prisma.liveStream.create({
    data: { hostId: user.id, circleId, title, roomName: "", roomUrl: "" },
  });

  let room;
  try {
    room = await createLiveStreamRoom({ name: `live-${liveStream.id}` });
  } catch {
    await prisma.liveStream.delete({ where: { id: liveStream.id } });
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
  } catch {
    await deleteCallRoom(room.name);
    await prisma.liveStream.delete({ where: { id: liveStream.id } });
    return { error: "call_service_unavailable" as const };
  }

  await prisma.liveStream.update({
    where: { id: liveStream.id },
    data: { roomName: room.name, roomUrl: room.url },
  });
  await notifySubscribers(user.id, "SUBSCRIPTION_LIVE", { liveStreamId: liveStream.id });

  revalidatePath("/home");
  return { error: null, liveStreamId: liveStream.id, roomUrl: room.url, token };
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

  revalidatePath("/home");
  revalidatePath(`/live/${liveStreamId}`);
  return { error: null };
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
 * LiveStreamViewer row records the role, and the host's client (see
 * live-stream-room.tsx + getLiveStreamStageUserIds below) polls for who's on
 * stage and grants them camera/mic access via call.updateParticipant() once
 * they're in the Daily room. That grant can only come from the actual room
 * owner acting live — Daily's meeting-tokens API has no per-participant
 * permissions override a joiner's own token can carry (its `permissions`
 * property is rejected outright by their API), so nothing here can encode
 * the role directly into the token itself. The host's own join (isHost)
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

  const liveStream = await prisma.liveStream.findUnique({ where: { id: liveStreamId } });
  if (!liveStream || liveStream.status !== "LIVE") {
    return { error: "not_found" as const };
  }
  if (liveStream.circleId && !(await getCircleMembership(liveStream.circleId, user.id))) {
    return { error: "not_a_member" as const };
  }

  const isHost = liveStream.hostId === user.id;
  let role: "VIEWER" | "GUEST" | "COHOST" = "VIEWER";
  // Non-null only when this call just filed (or re-filed) a pending
  // request rather than landing directly on stage — the client uses this to
  // show a "waiting for the host" state instead of full stage controls.
  let pendingStageRequest: "GUEST" | "COHOST" | null = null;

  if (!isHost && parsedRole.data) {
    const existing = await prisma.liveStreamViewer.findUnique({
      where: { liveStreamId_userId: { liveStreamId, userId: user.id } },
    });
    // Only skip the approval flow when their existing role already covers
    // what they're asking for now — COHOST covers any request (it's the
    // higher tier: it also carries GUEST's canSend grant, plus recording),
    // and an exact role match is obviously already covered. A GUEST asking
    // to become COHOST is a real privilege escalation (recording access —
    // see canRecord in live-stream-room.tsx) and must still go through a
    // fresh approval below, not be silently satisfied by their old GUEST
    // role.
    const alreadyOnStage = existing?.role === "COHOST" || existing?.role === parsedRole.data;
    if (alreadyOnStage) {
      // Already approved earlier on this same stream (e.g. a reconnect
      // after a dropped connection, or asking again for the same role) —
      // rejoin straight onto the stage rather than making them ask again.
      role = existing!.role;
    } else {
      // Capacity is checked at approval time (respondToStageRequest), not
      // here — a request is allowed to sit pending even while the stage is
      // momentarily full, in case a slot opens up.
      await prisma.liveStreamStageRequest.upsert({
        where: { liveStreamId_userId: { liveStreamId, userId: user.id } },
        create: { liveStreamId, userId: user.id, role: parsedRole.data, status: "PENDING" },
        update: { role: parsedRole.data, status: "PENDING", respondedAt: null },
      });
      pendingStageRequest = parsedRole.data;
    }
  }

  let token: string;
  try {
    token = await createMeetingToken({
      roomName: liveStream.roomName,
      userId: user.id,
      userName: user.name ?? "Guest",
      isOwner: isHost,
    });
  } catch {
    return { error: "call_service_unavailable" as const };
  }

  await prisma.liveStreamViewer.upsert({
    where: { liveStreamId_userId: { liveStreamId, userId: user.id } },
    create: { liveStreamId, userId: user.id, role: isHost ? "COHOST" : role },
    update: { joinedAt: new Date(), role: isHost ? "COHOST" : role },
  });

  return { error: null, roomUrl: liveStream.roomUrl, token, role, pendingStageRequest };
}

/**
 * Host-only: pending GUEST/COHOST requests waiting on a decision, oldest
 * first (so the host works through them in the order they came in). Polled
 * by live-stream-room.tsx alongside getLiveStreamStageUserIds.
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

  return { error: null };
}

/** Requester-only: withdraws their own still-pending stage request, so they can go back to just watching without waiting on a host decision. */
export async function cancelStageRequest(liveStreamId: string) {
  const user = await requireVerifiedUser();
  await prisma.liveStreamStageRequest.deleteMany({
    where: { liveStreamId, userId: user.id, status: "PENDING" },
  });
  return { error: null };
}

/**
 * Polled by a requester's own client while a stage request is outstanding,
 * to detect the host's decision (or an in-progress rejoin's already-on-stage
 * role) without forcing a full rejoin of the room.
 */
export async function getMyLiveStreamStatus(liveStreamId: string) {
  const user = await requireVerifiedUser();

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
  return { error: null };
}

/** Live streams visible to the viewer — global (no circleId) ones plus any scoped to a Circle they belong to. Backs the Home "Live now" strip. */
export async function getActiveLiveStreams() {
  try {
    const user = await requireVerifiedUser();

    const memberships = await prisma.circleMembership.findMany({
      where: { userId: user.id },
      select: { circleId: true },
    });
    const circleIds = memberships.map((m) => m.circleId);

    const streams = await prisma.liveStream.findMany({
      where: {
        status: "LIVE",
        OR: [{ circleId: null }, ...(circleIds.length ? [{ circleId: { in: circleIds } }] : [])],
      },
      orderBy: { startedAt: "desc" },
      include: {
        host: { select: { id: true, name: true, avatarUrl: true } },
        // role: "VIEWER" also excludes the host's own row (stored as COHOST — see joinLiveStream).
        _count: { select: { viewers: { where: { role: "VIEWER" } } } },
      },
    });

    return {
      streams: streams.map((s) => ({
        id: s.id,
        title: s.title,
        host: s.host,
        viewerCount: s._count.viewers,
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
 */
export async function getLiveStreamViewerCount(liveStreamId: string) {
  try {
    await requireVerifiedUser();

    const liveStream = await prisma.liveStream.findUnique({
      where: { id: liveStreamId },
      select: { hostId: true },
    });
    if (!liveStream) {
      return { count: 0, stageCount: 0, stageCapacity: MAX_STAGE_PARTICIPANTS };
    }

    const [count, stageCount] = await Promise.all([
      prisma.liveStreamViewer.count({
        where: { liveStreamId, role: "VIEWER", userId: { not: liveStream.hostId } },
      }),
      prisma.liveStreamViewer.count({
        where: { liveStreamId, role: { in: ["GUEST", "COHOST"] }, userId: { not: liveStream.hostId } },
      }),
    ]);
    return { count, stageCount, stageCapacity: MAX_STAGE_PARTICIPANTS };
  } catch {
    return { count: 0, stageCount: 0, stageCapacity: MAX_STAGE_PARTICIPANTS };
  }
}

/**
 * Host-only: the Daily `user_id`s (== our User.id, see joinLiveStream) of
 * everyone currently holding a GUEST/COHOST stage slot. Polled by the host's
 * client to know who to grant canSend to as they join the Daily room (see
 * joinLiveStream's doc comment for why this can't be baked into a token).
 */
export async function getLiveStreamStageUserIds(liveStreamId: string) {
  const user = await requireVerifiedUser();

  const liveStream = await prisma.liveStream.findUnique({
    where: { id: liveStreamId },
    select: { hostId: true },
  });
  if (!liveStream || liveStream.hostId !== user.id) {
    return { userIds: [] };
  }

  const stageViewers = await prisma.liveStreamViewer.findMany({
    where: { liveStreamId, role: { in: ["GUEST", "COHOST"] }, userId: { not: liveStream.hostId } },
    select: { userId: true },
  });
  return { userIds: stageViewers.map((v) => v.userId) };
}

/**
 * Lists cloud recordings for this stream's room, fetched live from Daily —
 * same loose "any verified user" visibility as getLiveStreamViewerCount
 * (this app doesn't gate viewing a public/circle-visible stream any harder
 * than that, so recordings of it follow the same rule).
 */
export async function listLiveStreamRecordings(liveStreamId: string) {
  try {
    await requireVerifiedUser();
  } catch {
    return { recordings: [] };
  }

  const liveStream = await prisma.liveStream.findUnique({
    where: { id: liveStreamId },
    select: { roomName: true },
  });
  if (!liveStream?.roomName) {
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
  await requireVerifiedUser();

  const liveStream = await prisma.liveStream.findUnique({
    where: { id: liveStreamId },
    select: { roomName: true },
  });
  if (!liveStream?.roomName) {
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
