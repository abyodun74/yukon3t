"use server";

import { revalidatePath } from "next/cache";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { createCallRoom, createMeetingToken, isCallingConfigured } from "@/lib/daily";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
const STALE_AFTER_MS = 4 * 60 * 60 * 1000;

/** Joins a Circle's persistent voice room, creating it on first use — no ringing, just presence. */
export async function joinCircleVoiceRoom(circleId: string) {
  const user = await requireVerifiedUser();

  if (!isCallingConfigured()) {
    return { error: "not_configured" as const };
  }

  const [circle, membership] = await Promise.all([
    prisma.circle.findUnique({ where: { id: circleId } }),
    prisma.circleMembership.findUnique({
      where: { userId_circleId: { userId: user.id, circleId } },
    }),
  ]);
  if (!circle) {
    return { error: "not_found" as const };
  }
  if (!membership) {
    return { error: "not_a_member" as const };
  }

  let roomName = circle.voiceRoomName;
  let roomUrl = circle.voiceRoomUrl;

  if (!roomName || !roomUrl) {
    try {
      const room = await createCallRoom({
        name: `circle-voice-${circleId}`,
        expiresInSeconds: ONE_YEAR_SECONDS,
      });
      roomName = room.name;
      roomUrl = room.url;
      await prisma.circle.update({
        where: { id: circleId },
        data: { voiceRoomName: roomName, voiceRoomUrl: roomUrl },
      });
    } catch {
      return { error: "call_service_unavailable" as const };
    }
  }

  let token: string;
  try {
    token = await createMeetingToken({
      roomName,
      userId: user.id,
      userName: user.name ?? "Guest",
      isOwner: membership.role === "OWNER",
    });
  } catch {
    return { error: "call_service_unavailable" as const };
  }

  await prisma.circleVoiceParticipant.upsert({
    where: { circleId_userId: { circleId, userId: user.id } },
    create: { circleId, userId: user.id },
    update: { joinedAt: new Date() },
  });

  revalidatePath(`/circles/${circle.slug}`);
  return { error: null, roomUrl, token };
}

/** Leaves the presence list — the room itself is persistent and isn't torn down. */
export async function leaveCircleVoiceRoom(circleId: string) {
  const user = await requireVerifiedUser();

  await prisma.circleVoiceParticipant.deleteMany({
    where: { circleId, userId: user.id },
  });

  const circle = await prisma.circle.findUnique({ where: { id: circleId }, select: { slug: true } });
  if (circle) revalidatePath(`/circles/${circle.slug}`);

  return { error: null };
}

/**
 * Polled every few seconds by the Circle page to show who's already in the
 * room before joining — like getIncomingCall, it must fail soft rather than
 * throw: a session ending mid-poll is an expected condition for a
 * background poller, not an error to surface.
 */
export async function getCircleVoiceParticipants(circleId: string) {
  try {
    await requireVerifiedUser();

    const participants = await prisma.circleVoiceParticipant.findMany({
      where: { circleId, joinedAt: { gt: new Date(Date.now() - STALE_AFTER_MS) } },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { joinedAt: "asc" },
    });

    return { participants: participants.map((p) => ({ id: p.user.id, name: p.user.name ?? "Unknown" })) };
  } catch {
    return { participants: [] };
  }
}
