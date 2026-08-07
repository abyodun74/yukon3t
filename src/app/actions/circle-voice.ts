"use server";

import { revalidatePath } from "next/cache";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { createCallRoom, createMeetingToken, isCallingConfigured } from "@/lib/daily";
import { canAccessChannel } from "@/lib/channel-permissions";
import { isCircleAdmin, getCircleMembership } from "@/lib/circle-permissions";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
const STALE_AFTER_MS = 4 * 60 * 60 * 1000;

/** Joins a voice Channel's persistent room, creating it on first use — no ringing, just presence. */
export async function joinCircleVoiceRoom(channelId: string) {
  const user = await requireVerifiedUser();

  if (!isCallingConfigured()) {
    return { error: "not_configured" as const };
  }

  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    include: { circle: true },
  });
  if (!channel || channel.type !== "VOICE") {
    return { error: "not_found" as const };
  }
  if (!(await canAccessChannel(channel, channel.circle, user))) {
    return { error: "not_a_member" as const };
  }
  const circleMembership = await getCircleMembership(channel.circleId, user.id);
  const isOwnerOrAdmin = isCircleAdmin(channel.circle, circleMembership, user);

  let roomName = channel.voiceRoomName;
  let roomUrl = channel.voiceRoomUrl;

  if (!roomName || !roomUrl) {
    try {
      const room = await createCallRoom({
        name: `channel-voice-${channelId}`,
        expiresInSeconds: ONE_YEAR_SECONDS,
      });
      roomName = room.name;
      roomUrl = room.url;
      await prisma.channel.update({
        where: { id: channelId },
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
      isOwner: isOwnerOrAdmin,
    });
  } catch {
    return { error: "call_service_unavailable" as const };
  }

  await prisma.channelVoiceParticipant.upsert({
    where: { channelId_userId: { channelId, userId: user.id } },
    create: { channelId, userId: user.id },
    update: { joinedAt: new Date() },
  });

  revalidatePath(`/circles/${channel.circle.slug}`);
  return { error: null, roomUrl, token };
}

/** Leaves the presence list — the room itself is persistent and isn't torn down. */
export async function leaveCircleVoiceRoom(channelId: string) {
  const user = await requireVerifiedUser();

  await prisma.channelVoiceParticipant.deleteMany({
    where: { channelId, userId: user.id },
  });

  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { circle: { select: { slug: true } } },
  });
  if (channel) revalidatePath(`/circles/${channel.circle.slug}`);

  return { error: null };
}

/**
 * Polled every few seconds by the Circle page to show who's already in the
 * room before joining — like getIncomingCall, it must fail soft rather than
 * throw: a session ending mid-poll is an expected condition for a
 * background poller, not an error to surface.
 */
export async function getCircleVoiceParticipants(channelId: string) {
  try {
    await requireVerifiedUser();

    const participants = await prisma.channelVoiceParticipant.findMany({
      where: { channelId, joinedAt: { gt: new Date(Date.now() - STALE_AFTER_MS) } },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { joinedAt: "asc" },
    });

    return { participants: participants.map((p) => ({ id: p.user.id, name: p.user.name ?? "Unknown" })) };
  } catch {
    return { participants: [] };
  }
}
