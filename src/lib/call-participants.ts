import { prisma } from "@/lib/prisma";
import { deleteCallRoom } from "@/lib/daily";
import { notifyMissedCall } from "@/lib/missed-call";
import { sendVoipCallCancelToUser } from "@/lib/apns-voip";
import { publishEvents } from "@/lib/realtime-server";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";
import { shouldEndAfterLeave } from "@/lib/call-resilience";

/**
 * Server-side rules for a call that has had people added to it, shared by
 * actions/calls.ts and the timeout-missed-calls cron. A plain 1:1 call has
 * no CallParticipant rows and never comes through here.
 */

export function isLiveParticipantStatus(status: string) {
  return status === "RINGING" || status === "JOINED";
}

/**
 * Whether iOS reported this call to CallKit on this person's device — true
 * for whoever was rung (the original callee, anyone added later), never for
 * a backfilled caller row. Only those devices are sent the "call is over"
 * VoIP push.
 */
export function wasRungForCall(call: { calleeId: string }, row: { userId: string; invitedById: string | null }) {
  return row.userId === call.calleeId || row.invitedById !== null;
}

export async function signalCallUsers(userIds: Iterable<string>) {
  await publishEvents(
    [...new Set(userIds)].map((userId) => ({ channel: REALTIME_CHANNELS.callSignal(userId), event: "changed" })),
  );
}

/**
 * The first step of every transaction that changes who is in a call: a
 * no-op write guarded on ACCEPTED. It takes the Call row's lock, so an
 * invite, an answer and the check for whether the call is over run one at a
 * time, and it says whether the call is still connected at all.
 */
export async function lockConnectedCall(
  tx: Pick<typeof prisma, "call">,
  callId: string,
) {
  const { count } = await tx.call.updateMany({
    where: { id: callId, status: "ACCEPTED" },
    data: { status: "ACCEPTED" },
  });
  return count > 0;
}

/**
 * Ends the call if shouldEndAfterLeave says it is over — run after anyone
 * leaves, declines or rings out. Ending it marks the row ENDED, deletes the
 * Daily room, turns anyone still being rung into a missed call and tells
 * whoever was left. Returns whether it ended the call; false also covers
 * "someone else already did".
 */
export async function settleCall(callId: string) {
  const outcome = await prisma.$transaction(async (tx) => {
    if (!(await lockConnectedCall(tx, callId))) return null;
    const live = await tx.callParticipant.findMany({
      where: { callId, status: { in: ["RINGING", "JOINED"] } },
    });
    const joined = live.filter((p) => p.status === "JOINED");
    const ringing = live.filter((p) => p.status === "RINGING");
    if (!shouldEndAfterLeave({ joined: joined.length, ringing: ringing.length })) return null;

    const now = new Date();
    const call = await tx.call.update({ where: { id: callId }, data: { status: "ENDED", endedAt: now } });
    await tx.callParticipant.updateMany({
      where: { callId, status: "RINGING" },
      data: { status: "MISSED", respondedAt: now },
    });
    await tx.callParticipant.updateMany({
      where: { callId, status: "JOINED" },
      data: { status: "LEFT", leftAt: now },
    });
    return { call, joined, ringing };
  });
  if (!outcome) return false;

  const { call, joined, ringing } = outcome;
  await deleteCallRoom(call.roomName);
  await signalCallUsers([...joined, ...ringing].map((p) => p.userId));
  await Promise.all(
    joined
      .filter((p) => wasRungForCall(call, p))
      .map((p) => sendVoipCallCancelToUser(p.userId, callId).catch(() => {})),
  );
  await notifyMissedInvitees(call, ringing);
  return true;
}

/** Clears each invitee's native ring and leaves the usual missed-call notice, named after whoever added them. */
export async function notifyMissedInvitees(
  call: { id: string; callerId: string },
  invitees: { userId: string; invitedById: string | null }[],
) {
  if (invitees.length === 0) return;
  const inviterIds = [...new Set(invitees.map((p) => p.invitedById ?? call.callerId))];
  const inviters = await prisma.user.findMany({ where: { id: { in: inviterIds } }, select: { id: true, name: true } });
  const nameById = new Map(inviters.map((u) => [u.id, u.name]));
  await Promise.all(
    invitees.map((p) => {
      const inviterId = p.invitedById ?? call.callerId;
      return notifyMissedCall({
        callId: call.id,
        callerId: inviterId,
        callerName: nameById.get(inviterId) ?? "Someone",
        calleeId: p.userId,
      });
    }),
  );
}

/**
 * For a call that has just been ended as a whole by something other than
 * settleCall (the stale-ACCEPTED sweep): closes whatever participant rows
 * were still open and returns them, so the caller can tell those people.
 */
export async function closeParticipantRows(callId: string) {
  const live = await prisma.callParticipant.findMany({
    where: { callId, status: { in: ["RINGING", "JOINED"] } },
  });
  if (live.length === 0) return live;
  const now = new Date();
  await prisma.callParticipant.updateMany({
    where: { callId, status: "RINGING" },
    data: { status: "MISSED", respondedAt: now },
  });
  await prisma.callParticipant.updateMany({
    where: { callId, status: "JOINED" },
    data: { status: "LEFT", leftAt: now },
  });
  return live;
}
