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
} from "@/lib/daily";
import { getCircleMembership } from "@/lib/circle-permissions";
import { liveStreamTitleSchema } from "@/lib/validations";

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

/** Mints a view-only meeting token — owner_only_broadcast on the room (see createLiveStreamRoom) is what actually keeps a viewer from unmuting camera/mic. */
export async function joinLiveStream(liveStreamId: string) {
  const user = await requireVerifiedUser();

  if (!isCallingConfigured()) {
    return { error: "not_configured" as const };
  }

  const allowed = await checkRateLimit("liveStreamJoin", user.id);
  if (!allowed) {
    return { error: "rate_limited" as const };
  }

  const liveStream = await prisma.liveStream.findUnique({ where: { id: liveStreamId } });
  if (!liveStream || liveStream.status !== "LIVE") {
    return { error: "not_found" as const };
  }
  if (liveStream.circleId && !(await getCircleMembership(liveStream.circleId, user.id))) {
    return { error: "not_a_member" as const };
  }

  let token: string;
  try {
    token = await createMeetingToken({
      roomName: liveStream.roomName,
      userId: user.id,
      userName: user.name ?? "Guest",
      isOwner: liveStream.hostId === user.id,
    });
  } catch {
    return { error: "call_service_unavailable" as const };
  }

  await prisma.liveStreamViewer.upsert({
    where: { liveStreamId_userId: { liveStreamId, userId: user.id } },
    create: { liveStreamId, userId: user.id },
    update: { joinedAt: new Date() },
  });

  return { error: null, roomUrl: liveStream.roomUrl, token };
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
        _count: { select: { viewers: true } },
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

/** Polled by the live room to show a live viewer count. */
export async function getLiveStreamViewerCount(liveStreamId: string) {
  try {
    await requireVerifiedUser();
    const count = await prisma.liveStreamViewer.count({ where: { liveStreamId } });
    return { count };
  } catch {
    return { count: 0 };
  }
}
