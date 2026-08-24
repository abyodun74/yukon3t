"use server";

import { revalidatePath } from "next/cache";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import {
  createCollabRoom,
  createMeetingToken,
  isCallingConfigured,
  listRoomRecordings,
  getRecordingAccessLink,
} from "@/lib/daily";
import { checkRateLimit } from "@/lib/rate-limit";
import { getCollabMembership } from "@/lib/collab-permissions";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
const STALE_AFTER_MS = 4 * 60 * 60 * 1000;

/** Joins a Collab's persistent live session room, creating it on first use — no ringing, just presence, same pattern as joinCircleVoiceRoom. */
export async function joinCollabSession(collabId: string) {
  const user = await requireVerifiedUser();

  if (!isCallingConfigured()) {
    return { error: "not_configured" as const };
  }

  const allowed = await checkRateLimit("collabSession", user.id);
  if (!allowed) {
    return { error: "rate_limited" as const };
  }

  const [collab, membership] = await Promise.all([
    prisma.collabBoardPost.findUnique({ where: { id: collabId } }),
    getCollabMembership(collabId, user.id),
  ]);
  if (!collab) {
    return { error: "not_found" as const };
  }
  if (!membership) {
    return { error: "not_a_participant" as const };
  }

  let roomName = collab.roomName;
  let roomUrl = collab.roomUrl;

  if (!roomName || !roomUrl) {
    // Only the organizer or a co-admin can start a session from cold —
    // a regular participant can join one already underway, but can't spin
    // one up on their own.
    if (membership.role !== "OWNER" && membership.role !== "MODERATOR") {
      return { error: "not_started" as const };
    }
    try {
      const room = await createCollabRoom({
        name: `collab-session-${collabId}`,
        expiresInSeconds: ONE_YEAR_SECONDS,
      });
      roomName = room.name;
      roomUrl = room.url;
      await prisma.collabBoardPost.update({
        where: { id: collabId },
        data: { roomName, roomUrl },
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
      isOwner: membership.role === "OWNER" || membership.role === "MODERATOR",
    });
  } catch {
    return { error: "call_service_unavailable" as const };
  }

  await prisma.collabSessionParticipant.upsert({
    where: { collabId_userId: { collabId, userId: user.id } },
    create: { collabId, userId: user.id },
    update: { joinedAt: new Date() },
  });

  revalidatePath(`/collab/${collabId}`);
  return { error: null, roomUrl, token };
}

/** Leaves the presence list — the room itself is persistent and isn't torn down. */
export async function leaveCollabSession(collabId: string) {
  const user = await requireVerifiedUser();

  await prisma.collabSessionParticipant.deleteMany({
    where: { collabId, userId: user.id },
  });

  revalidatePath(`/collab/${collabId}`);
  return { error: null };
}

/** Polled every few seconds by the Collab page to show who's already in the session before joining. */
export async function getCollabSessionParticipants(collabId: string) {
  try {
    await requireVerifiedUser();

    const participants = await prisma.collabSessionParticipant.findMany({
      where: { collabId, joinedAt: { gt: new Date(Date.now() - STALE_AFTER_MS) } },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { joinedAt: "asc" },
    });

    return { participants: participants.map((p) => ({ id: p.user.id, name: p.user.name ?? "Unknown" })) };
  } catch {
    return { participants: [] };
  }
}

/** Participant-only: lists cloud recordings for this collab's session room, fetched live from Daily. */
export async function listCollabRecordings(collabId: string) {
  const user = await requireVerifiedUser();

  const [collab, membership] = await Promise.all([
    prisma.collabBoardPost.findUnique({ where: { id: collabId }, select: { roomName: true } }),
    getCollabMembership(collabId, user.id),
  ]);
  if (!collab?.roomName || !membership) {
    return { recordings: [] };
  }

  const recordings = await listRoomRecordings(collab.roomName);
  return {
    recordings: recordings
      .filter((r) => r.status === "finished")
      .map((r) => ({ id: r.id, startedAt: r.start_ts, durationSeconds: r.duration ?? null })),
  };
}

/** Participant-only: fetches a fresh, short-lived download link for a recording. */
export async function getCollabRecordingLink(collabId: string, recordingId: string) {
  const user = await requireVerifiedUser();

  const [collab, membership] = await Promise.all([
    prisma.collabBoardPost.findUnique({ where: { id: collabId }, select: { roomName: true } }),
    getCollabMembership(collabId, user.id),
  ]);
  if (!collab?.roomName || !membership) {
    return { error: "forbidden" as const };
  }

  // getRecordingAccessLink takes only a bare recordingId with no room scoping
  // of its own — without cross-checking it against this collab's own room,
  // any participant of *any* collab could pass in a recordingId belonging to
  // a different (possibly private) collab and get a valid download link for
  // it. Daily is the source of truth for which recordings belong to a room.
  const recordings = await listRoomRecordings(collab.roomName);
  if (!recordings.some((r) => r.id === recordingId)) {
    return { error: "forbidden" as const };
  }

  try {
    const url = await getRecordingAccessLink(recordingId);
    return { error: null, url };
  } catch {
    return { error: "unavailable" as const };
  }
}
