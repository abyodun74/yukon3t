"use server";

import { revalidatePath } from "next/cache";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { createCallRoom, createMeetingToken, isCallingConfigured } from "@/lib/daily";
import { canAccessChannel } from "@/lib/channel-permissions";
import { isCircleAdmin, getCircleMembership } from "@/lib/circle-permissions";
import { checkRateLimit } from "@/lib/rate-limit";

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

/**
 * Any circle member with access to a voice Channel can invite another
 * circle member to it — not admin-gated, per product decision. Mirrors
 * inviteToCollab's create/reset-if-declined/no-op-otherwise pattern.
 */
export async function inviteToVoiceChannel(channelId: string, inviteeId: string) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("voiceChannelInvite", user.id);
  if (!allowed) {
    return { error: "rate_limited" as const };
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
  const inviteeMembership = await getCircleMembership(channel.circleId, inviteeId);
  if (!inviteeMembership) {
    return { error: "not_a_member" as const };
  }

  const existingInvite = await prisma.channelVoiceInvite.findUnique({
    where: { channelId_inviteeId: { channelId, inviteeId } },
  });
  // Already-pending or already-accepted invitees are a no-op re-invite —
  // only a brand-new invitee and a DECLINED one being re-invited need action.
  if (existingInvite && existingInvite.status !== "DECLINED") {
    return { error: null };
  }

  if (existingInvite) {
    await prisma.channelVoiceInvite.update({
      where: { id: existingInvite.id },
      data: { status: "PENDING", respondedAt: null },
    });
  } else {
    await prisma.channelVoiceInvite.create({
      data: { channelId, inviterId: user.id, inviteeId },
    });
  }
  await prisma.notification.create({
    data: {
      recipientId: inviteeId,
      actorId: user.id,
      type: "VOICE_CHANNEL_INVITE",
      channelId,
      circleId: channel.circleId,
    },
  });

  revalidatePath(`/circles/${channel.circle.slug}`);
  return { error: null };
}

/** Invitee only: accepts or declines a pending ChannelVoiceInvite. A pure RSVP — does not join the Daily room. */
export async function respondToVoiceChannelInvite(inviteId: string, accept: boolean) {
  const user = await requireVerifiedUser();

  const invite = await prisma.channelVoiceInvite.findUnique({
    where: { id: inviteId },
    include: { channel: { include: { circle: true } } },
  });
  if (!invite) {
    return { error: "not_found" as const };
  }
  if (invite.inviteeId !== user.id) {
    return { error: "forbidden" as const };
  }
  // Already handled — idempotent no-op rather than an error.
  if (invite.status !== "PENDING") {
    return { error: null };
  }

  await prisma.channelVoiceInvite.update({
    where: { id: inviteId },
    data: { status: accept ? "ACCEPTED" : "DECLINED", respondedAt: new Date() },
  });

  if (accept) {
    await prisma.notification.create({
      data: {
        recipientId: invite.inviterId,
        actorId: user.id,
        type: "VOICE_CHANNEL_INVITE_ACCEPTED",
        channelId: invite.channelId,
        circleId: invite.channel.circleId,
      },
    });
  }

  revalidatePath(`/circles/${invite.channel.circle.slug}`);
  return { error: null };
}

/** Pending/accepted/declined invite counts for a voice Channel, shown next to the invite button. */
export async function getVoiceChannelInviteCounts(channelId: string) {
  await requireVerifiedUser();

  const counts = await prisma.channelVoiceInvite.groupBy({
    by: ["status"],
    where: { channelId },
    _count: true,
  });

  const result = { pending: 0, accepted: 0, declined: 0 };
  for (const row of counts) {
    if (row.status === "PENDING") result.pending = row._count;
    else if (row.status === "ACCEPTED") result.accepted = row._count;
    else if (row.status === "DECLINED") result.declined = row._count;
  }
  return result;
}

/** Pending voice-channel invites addressed to the caller, for a notification-bell entry. */
export async function getMyVoiceChannelInvites() {
  const user = await requireVerifiedUser();

  return prisma.channelVoiceInvite.findMany({
    where: { inviteeId: user.id, status: "PENDING" },
    include: {
      channel: { select: { id: true, name: true, circle: { select: { slug: true, name: true } } } },
      inviter: { select: { id: true, name: true, avatarUrl: true } },
    },
  });
}
