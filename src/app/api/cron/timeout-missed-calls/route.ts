import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deleteCallRoom } from "@/lib/daily";
import { isCronAuthorized } from "@/lib/cron-auth";
import { notifyMissedCall } from "@/lib/missed-call";
import { sendVoipCallCancelToUser } from "@/lib/apns-voip";
import { publishEvent } from "@/lib/realtime-server";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";
import { CALL_RING_TIMEOUT_MS, CALL_ROOM_LIFETIME_SECONDS } from "@/lib/call-resilience";
import {
  closeParticipantRows,
  notifyMissedInvitees,
  settleCall,
  signalCallUsers,
  wasRungForCall,
} from "@/lib/call-participants";

// A RINGING row older than this is leftover backlog rather than a call that
// just rang out (this cron was written well before it was first scheduled,
// and can fall behind again after an outage) — telling the callee about it
// now would be a "missed call" push for something that happened hours or
// weeks ago. Those are closed out silently.
const NOTIFY_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * Triggered on a schedule, same pattern as the other src/app/api/cron/*
 * routes — protected by CRON_SECRET, not a user session. Covers the case
 * startCall/endCall don't: nobody ever hangs up or responds (the caller
 * leaves the tab open, the app is killed, etc.), so the Call row would
 * otherwise sit at RINGING forever and the callee never learns they missed
 * it. The native ring UI already gives up client-side after 55s
 * (CallForegroundService.RING_TIMEOUT_MS in the Android app) — this cutoff
 * is a little past that so, by the time this runs, the ring has already
 * stopped locally either way.
 *
 * Also sweeps the same kind of leftover one state later: a call that was
 * answered and then never ended by either side (see sweepStaleAccepted),
 * and times out a ring to someone being added to a connected call (see
 * timeOutRingingParticipants).
 */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [missed, ended, missedInvites] = await Promise.all([
    timeOutRinging(),
    sweepStaleAccepted(),
    timeOutRingingParticipants(),
  ]);

  return NextResponse.json({ error: null, missed, ended, missedInvites });
}

async function timeOutRinging() {
  const cutoff = new Date(Date.now() - CALL_RING_TIMEOUT_MS);
  const notifyCutoff = new Date(Date.now() - NOTIFY_MAX_AGE_MS);

  const stale = await prisma.call.findMany({
    where: { status: "RINGING", createdAt: { lte: cutoff } },
    include: { caller: { select: { id: true, name: true } } },
    // Newest first, so a backlog bigger than one tick's `take` never delays
    // a call that only just rang out.
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  let missed = 0;
  await Promise.all(
    stale.map(async (call) => {
      // Guarded on status: the callee may accept/decline between the
      // findMany above and this update, and that response should win — a
      // 0-count result means it beat us to it, so skip the notification too.
      const { count } = await prisma.call.updateMany({
        where: { id: call.id, status: "RINGING" },
        data: { status: "MISSED", endedAt: new Date() },
      });
      if (count === 0) return;

      missed++;
      // Before the backlog cutoff below, not after: a room now outlives that
      // cutoff by hours (CALL_ROOM_LIFETIME_SECONDS), where it used to have
      // expired by itself by then.
      await deleteCallRoom(call.roomName);
      if (call.createdAt < notifyCutoff) return;

      // Nothing else tells either side's open UI (the caller's "Calling"
      // sheet, the callee's in-app ring banner) that the status changed —
      // same signal endCall publishes, but to both parties since neither of
      // them triggered this.
      await Promise.all([
        publishEvent(REALTIME_CHANNELS.callSignal(call.callerId), "changed"),
        publishEvent(REALTIME_CHANNELS.callSignal(call.calleeId), "changed"),
      ]);
      await notifyMissedCall({
        callId: call.id,
        callerId: call.callerId,
        callerName: call.caller.name ?? "Someone",
        calleeId: call.calleeId,
      });
    }),
  );

  return missed;
}

/**
 * Closes a call still at ACCEPTED after its Daily room has expired. A
 * connected call is normally ended by one of its two clients — a hang-up, a
 * reconnect that ran out of retries, or the wait for a vanished peer running
 * out (see call-resilience.ts) — but all of those need a client that is
 * still running and online; when neither is (both apps killed, both
 * offline), nothing else ever moves the row, and startCall answers
 * "already_calling" for that pair from then on.
 *
 * Age is measured from createdAt, which is when the room was created and so
 * what its expiry counts from: past CALL_ROOM_LIFETIME_SECONDS the room has
 * ejected everyone and nobody can still be on the call, however long ago it
 * was actually answered. Anything younger may be a real call in progress
 * and is left alone.
 */
async function sweepStaleAccepted() {
  const cutoff = new Date(Date.now() - CALL_ROOM_LIFETIME_SECONDS * 1000);

  const stale = await prisma.call.findMany({
    where: { status: "ACCEPTED", createdAt: { lte: cutoff } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  let ended = 0;
  await Promise.all(
    stale.map(async (call) => {
      // Guarded on status, same as above: either side's endCall may land
      // between the findMany and this update, and has then already done
      // everything below itself.
      const { count } = await prisma.call.updateMany({
        where: { id: call.id, status: "ACCEPTED" },
        data: { status: "ENDED", endedAt: new Date() },
      });
      if (count === 0) return;

      ended++;
      // The room should be gone by its own expiry by now — this just makes
      // sure of it.
      await deleteCallRoom(call.roomName);
      await Promise.all([
        publishEvent(REALTIME_CHANNELS.callSignal(call.callerId), "changed"),
        publishEvent(REALTIME_CHANNELS.callSignal(call.calleeId), "changed"),
      ]);
      // Same as endCall's answered-call branch: nothing else tells the
      // callee's CallKit that the call it reported is over.
      await sendVoipCallCancelToUser(call.calleeId, call.id).catch(() => {});
      // A call people were added to: its participant rows are closed with
      // it, and everyone on them is told the same way.
      const open = await closeParticipantRows(call.id);
      await signalCallUsers(open.map((p) => p.userId));
      await Promise.all(
        open
          .filter((p) => p.userId !== call.calleeId && wasRungForCall(call, p))
          .map((p) => sendVoipCallCancelToUser(p.userId, call.id).catch(() => {})),
      );
    }),
  );

  return ended;
}

/**
 * The ring timeout for someone being added to a connected call, same cutoff
 * as timeOutRinging. Unlike that one it never deletes the Daily room: the
 * call itself is still going for everyone else. It ends only if this ring
 * was the last thing keeping it open (settleCall — one person left in it
 * and nobody else being rung).
 */
async function timeOutRingingParticipants() {
  const cutoff = new Date(Date.now() - CALL_RING_TIMEOUT_MS);
  const notifyCutoff = new Date(Date.now() - NOTIFY_MAX_AGE_MS);

  const stale = await prisma.callParticipant.findMany({
    where: { status: "RINGING", createdAt: { lte: cutoff } },
    include: {
      call: {
        select: {
          id: true,
          callerId: true,
          participants: { where: { status: "JOINED" }, select: { userId: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  let missed = 0;
  const callIds = new Set<string>();
  await Promise.all(
    stale.map(async (invite) => {
      // Guarded on status, same as timeOutRinging: the invitee answering or
      // the call ending can resolve this first.
      const { count } = await prisma.callParticipant.updateMany({
        where: { id: invite.id, status: "RINGING" },
        data: { status: "MISSED", respondedAt: new Date() },
      });
      if (count === 0) return;

      missed++;
      callIds.add(invite.callId);
      if (invite.createdAt < notifyCutoff) return;

      await signalCallUsers([invite.userId, ...invite.call.participants.map((p) => p.userId)]);
      await notifyMissedInvitees(invite.call, [invite]);
    }),
  );

  // Once per call, after all of its rings are settled.
  for (const callId of callIds) {
    await settleCall(callId);
  }

  return missed;
}
