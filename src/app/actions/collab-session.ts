"use server";

import { revalidatePath } from "next/cache";
import { requireVerifiedUser, requireVerifiedViewer } from "@/lib/auth-guards";
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
import { publishEvent, notifyBadgeChange } from "@/lib/realtime-server";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";
import { sendCollabInvites } from "@/lib/collab-invites-server";
import { pushActivityNotificationToMany } from "@/lib/notify-push";
import { captureError } from "@/lib/error-tracking";
import {
  COLLAB_SESSION_NOTIFY_COOLDOWN_MS,
  COLLAB_SESSION_STALE_AFTER_MS,
  canStartCollabSession,
  hasStartInvites,
  parseStartSessionOptions,
  sessionStartedRecipients,
  shouldNotifySessionStarted,
} from "@/lib/collab-session-start";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

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

  return enterCollabSession(user, collab, membership.role);
}

/**
 * The join itself, shared by joinCollabSession and startCollabSession once each has authorized the caller as a
 * participant and spent its rate limit. Not exported: an export of this file is a callable Server Action.
 */
async function enterCollabSession(
  user: { id: string; name: string | null },
  collab: { id: string; roomName: string | null; roomUrl: string | null },
  role: string,
) {
  const collabId = collab.id;
  let roomName = collab.roomName;
  let roomUrl = collab.roomUrl;

  if (!roomName || !roomUrl) {
    // Only the organizer or a co-admin can start a session from cold —
    // a regular participant can join one already underway, but can't spin
    // one up on their own.
    if (!canStartCollabSession(role)) {
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
      isOwner: canStartCollabSession(role),
    });
  } catch {
    return { error: "call_service_unavailable" as const };
  }

  await prisma.collabSessionParticipant.upsert({
    where: { collabId_userId: { collabId, userId: user.id } },
    create: { collabId, userId: user.id },
    update: { joinedAt: new Date() },
  });
  await publishEvent(REALTIME_CHANNELS.collabSession(collabId), "changed");

  revalidatePath(`/collab/${collabId}`);
  return { error: null, roomUrl, token };
}

/**
 * Organizer/co-admin of a PRIVATE collab, from the "Start session" sheet: optionally invites more people and/or the
 * members of Circles they created (the same sendCollabInvites as inviteToCollab, with all its rules), joins the
 * session exactly like joinCollabSession, then — with `notify` on — tells the other participants it's live.
 *
 * Order matters: an invite error (rate_limited, forbidden, too_large, invalid) returns before anything else happens,
 * so the session isn't started and nobody is notified. Participants are notified only after the join succeeded, so
 * "the session is live" never goes out for a session that failed to start; if the join itself fails after invites
 * were sent, those invites stand (they're ordinary invites) and the error is returned with their counts. The
 * notification is best-effort: a failure there never keeps the starter out of the room.
 */
export async function startCollabSession(
  collabId: string,
  input: { notify: boolean; userIds: string[]; circleIds: string[] },
) {
  const user = await requireVerifiedUser();
  const noInvites = { invited: 0, skipped: 0, circleNames: [] as string[] };

  const options = parseStartSessionOptions(input);
  if (!options) {
    return { error: "invalid" as const, ...noInvites };
  }
  if (!isCallingConfigured()) {
    return { error: "not_configured" as const, ...noInvites };
  }
  if (!(await checkRateLimit("collabSession", user.id))) {
    return { error: "rate_limited" as const, ...noInvites };
  }

  const [collab, membership] = await Promise.all([
    prisma.collabBoardPost.findUnique({
      where: { id: collabId },
      select: { id: true, authorId: true, visibility: true, roomName: true, roomUrl: true },
    }),
    getCollabMembership(collabId, user.id),
  ]);
  if (!collab) {
    return { error: "not_found" as const, ...noInvites };
  }
  if (!membership) {
    return { error: "not_a_participant" as const, ...noInvites };
  }
  if (!canStartCollabSession(membership.role)) {
    return { error: "forbidden" as const, ...noInvites };
  }
  if (collab.visibility !== "PRIVATE") {
    return { error: "not_private" as const, ...noInvites };
  }

  let invites = noInvites;
  if (hasStartInvites(options)) {
    // The same limiter inviteToCollab spends before inviting.
    if (!(await checkRateLimit("collabModerate", user.id))) {
      return { error: "rate_limited" as const, ...noInvites };
    }
    const sent = await sendCollabInvites(user.id, collab, {
      inviteeIds: options.userIds,
      circleIds: options.circleIds,
    });
    if (sent.error) {
      return { error: sent.error, ...noInvites };
    }
    invites = { invited: sent.invited, skipped: sent.skipped, circleNames: sent.circleNames };
  }

  const joined = await enterCollabSession(user, collab, membership.role);
  if (joined.error) {
    return { error: joined.error, ...invites };
  }

  if (options.notify) {
    try {
      await notifyCollabSessionStarted(collabId, user);
    } catch (err) {
      console.error("[collab-session] session-started notification failed", err);
      await captureError(err, { action: "startCollabSession", collabId });
    }
  }

  return { error: null, ...invites, roomUrl: joined.roomUrl, token: joined.token };
}

/**
 * COLLAB_SESSION_STARTED bell rows + FCM push to every participant but the starter, at most once per collab per
 * COLLAB_SESSION_NOTIFY_COOLDOWN_MS. The cooldown needs no table of its own: the newest COLLAB_SESSION_STARTED row
 * for this collab is the last fan-out (looked up through the participants' recipientId/createdAt index rather than
 * by collabId, which has no index). The check and the insert run in one transaction that first locks the collab's
 * row (a no-op update, same trick as lockConnectedCall), so two admins starting at the same moment can't both pass.
 */
async function notifyCollabSessionStarted(collabId: string, starter: { id: string; name: string | null }) {
  const participants = await prisma.collabParticipant.findMany({ where: { collabId }, select: { userId: true } });
  const participantIds = participants.map((p) => p.userId);
  const recipientIds = sessionStartedRecipients(participantIds, starter.id);
  if (recipientIds.length === 0) return;

  const now = new Date();
  const sent = await prisma.$transaction(async (tx) => {
    await tx.collabBoardPost.updateMany({
      where: { id: collabId, visibility: "PRIVATE" },
      data: { visibility: "PRIVATE" },
    });
    const last = await tx.notification.findFirst({
      where: {
        recipientId: { in: participantIds },
        type: "COLLAB_SESSION_STARTED",
        collabId,
        createdAt: { gt: new Date(now.getTime() - COLLAB_SESSION_NOTIFY_COOLDOWN_MS) },
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (!shouldNotifySessionStarted({ notifyRequested: true, lastSentAt: last?.createdAt ?? null, now })) {
      return false;
    }
    await tx.notification.createMany({
      data: recipientIds.map((recipientId) => ({
        recipientId,
        actorId: starter.id,
        type: "COLLAB_SESSION_STARTED" as const,
        collabId,
      })),
    });
    return true;
  });
  if (!sent) return;

  await pushActivityNotificationToMany(recipientIds, "COLLAB_SESSION_STARTED", starter.name, `/collab/${collabId}`);
  await Promise.all(recipientIds.map((recipientId) => notifyBadgeChange(recipientId)));
}

/** Leaves the presence list — the room itself is persistent and isn't torn down. */
export async function leaveCollabSession(collabId: string) {
  const user = await requireVerifiedUser();

  await prisma.collabSessionParticipant.deleteMany({
    where: { collabId, userId: user.id },
  });
  await publishEvent(REALTIME_CHANNELS.collabSession(collabId), "changed");

  revalidatePath(`/collab/${collabId}`);
  return { error: null };
}

/** Polled every few seconds by the Collab page to show who's already in the session before joining. */
export async function getCollabSessionParticipants(collabId: string) {
  try {
    await requireVerifiedViewer();

    const participants = await prisma.collabSessionParticipant.findMany({
      where: { collabId, joinedAt: { gt: new Date(Date.now() - COLLAB_SESSION_STALE_AFTER_MS) } },
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
