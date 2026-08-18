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
 * `role: "GUEST"` or `"COHOST"` to take one of MAX_STAGE_PARTICIPANTS stage
 * slots alongside the host — their LiveStreamViewer row records the role,
 * and the host's client (see live-stream-room.tsx + getLiveStreamStageUserIds
 * below) polls for who's on stage and grants them camera/mic access via
 * call.updateParticipant() once they join the Daily room. That grant can only
 * come from the actual room owner acting live — Daily's meeting-tokens API
 * has no per-participant permissions override a joiner's own token can carry
 * (its `permissions` property is rejected outright by their API), so nothing
 * here can encode the role directly into the token itself. The host's own
 * join (isHost) always ignores the requested role — they're identified by
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

  if (!isHost && parsedRole.data) {
    const [stageCount, existing] = await Promise.all([
      prisma.liveStreamViewer.count({
        where: { liveStreamId, role: { in: ["GUEST", "COHOST"] }, userId: { not: liveStream.hostId } },
      }),
      prisma.liveStreamViewer.findUnique({
        where: { liveStreamId_userId: { liveStreamId, userId: user.id } },
      }),
    ]);
    const alreadyOnStage = existing?.role === "GUEST" || existing?.role === "COHOST";
    if (!alreadyOnStage && stageCount >= MAX_STAGE_PARTICIPANTS) {
      return { error: "stage_full" as const };
    }
    role = parsedRole.data;
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

  return { error: null, roomUrl: liveStream.roomUrl, token, role };
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

/** Fetches a fresh, short-lived download link for a recording. */
export async function getLiveStreamRecordingLink(recordingId: string) {
  await requireVerifiedUser();

  try {
    const url = await getRecordingAccessLink(recordingId);
    return { error: null, url };
  } catch {
    return { error: "unavailable" as const };
  }
}
