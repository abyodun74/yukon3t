"use server";

import { randomUUID } from "node:crypto";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { createCallRoom, createMeetingToken, deleteCallRoom, isCallingConfigured } from "@/lib/daily";
import { isBlockedEitherWay, isBlockedWithAny } from "@/lib/blocks";
import { sendPushToUser } from "@/lib/push";
import { sendFcmCallToUser } from "@/lib/fcm";
import { sendVoipCallToUser, sendVoipCallCancelToUser } from "@/lib/apns-voip";
import { notifyMissedCall } from "@/lib/missed-call";
import { maskHiddenCallerName } from "@/lib/hidden-chats";
import { track } from "@/lib/analytics";
import { publishEvent } from "@/lib/realtime-server";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";
import { CALL_MAX_PARTICIPANTS, CALL_ROOM_LIFETIME_SECONDS } from "@/lib/call-resilience";
import {
  isLiveParticipantStatus,
  lockConnectedCall,
  settleCall,
  signalCallUsers,
  wasRungForCall,
} from "@/lib/call-participants";

async function requireAcceptedConnection(userId: string, otherId: string) {
  return prisma.connection.findFirst({
    where: {
      status: "ACCEPTED",
      OR: [
        { requesterId: userId, targetId: otherId },
        { requesterId: otherId, targetId: userId },
      ],
    },
  });
}

export async function startCall(formData: FormData) {
  const user = await requireVerifiedUser();

  if (!isCallingConfigured()) {
    return { error: "not_configured" as const };
  }

  const allowed = await checkRateLimit("call", user.id);
  if (!allowed) {
    return { error: "rate_limited" as const };
  }

  const calleeId = String(formData.get("calleeId") ?? "");
  const type = formData.get("type") === "VIDEO" ? "VIDEO" : "AUDIO";
  if (!calleeId || calleeId === user.id) {
    return { error: "invalid" as const };
  }

  const [connection, callee, blocked] = await Promise.all([
    requireAcceptedConnection(user.id, calleeId),
    prisma.user.findUnique({ where: { id: calleeId } }),
    isBlockedEitherWay(user.id, calleeId),
  ]);
  if (!connection) {
    return { error: "not_connected" as const };
  }
  if (!callee || callee.status !== "ACTIVE") {
    return { error: "not_found" as const };
  }
  if (blocked) {
    return { error: "not_found" as const };
  }

  // One ringing/active call between these two people at a time, in either
  // direction — otherwise a double-click (or B calling A back while A's
  // call to B is still ringing) would spawn a second Daily room and a
  // second ring.
  //
  // A call between them that other people were added to only counts while
  // both are still in it: once either has left, it carries on (or not)
  // without them, and endCall on it would be a no-op for the one who left.
  const candidates = await prisma.call.findMany({
    where: {
      status: { in: ["RINGING", "ACCEPTED"] },
      OR: [
        { callerId: user.id, calleeId },
        { callerId: calleeId, calleeId: user.id },
      ],
    },
    include: {
      participants: { where: { userId: { in: [user.id, calleeId] } }, select: { status: true } },
    },
  });
  const existing = candidates.find((c) => c.participants.every((p) => isLiveParticipantStatus(p.status)));
  if (existing) {
    return { error: "already_calling" as const, existingCallId: existing.id };
  }

  let room: { url: string; name: string };
  try {
    room = await createCallRoom({ name: `call-${randomUUID()}` });
  } catch {
    return { error: "call_service_unavailable" as const };
  }

  let token: string;
  let calleeToken: string;
  try {
    // Both tokens minted now, up front, rather than the callee's being
    // minted later when they accept — see the Call.calleeToken comment in
    // schema.prisma for why that round trip used to add latency to the
    // moment the callee actually taps Accept. Both live as long as the room
    // does: each side rejoins with this same token after a dropped
    // connection, however far into the call that is (see
    // call-resilience.ts).
    [token, calleeToken] = await Promise.all([
      createMeetingToken({
        roomName: room.name,
        userId: user.id,
        userName: user.name ?? "Caller",
        isOwner: true,
        expiresInSeconds: CALL_ROOM_LIFETIME_SECONDS,
      }),
      createMeetingToken({
        roomName: room.name,
        userId: calleeId,
        userName: callee.name ?? "Guest",
        isOwner: false,
        expiresInSeconds: CALL_ROOM_LIFETIME_SECONDS,
      }),
    ]);
  } catch {
    await deleteCallRoom(room.name);
    return { error: "call_service_unavailable" as const };
  }

  const call = await prisma.call.create({
    data: { callerId: user.id, calleeId, type, roomName: room.name, roomUrl: room.url, calleeToken },
  });

  try {
    // "Private call" if the callee has hidden their chat with this caller (src/lib/hidden-chats.ts).
    const callerName = (await maskHiddenCallerName(calleeId, user.id, user.name)) ?? "Someone";
    await sendPushToUser(calleeId, {
      title: `Incoming ${call.type === "VIDEO" ? "video" : "voice"} call`,
      body: `${callerName} is calling you`,
      url: "/",
    });
    // Separate from the Web Push above: this is a data-only message the
    // native Android app's own notification code turns into a proper
    // call-style ring (system ringtone, full-screen), rather than a
    // browser notification. See src/lib/fcm.ts.
    await sendFcmCallToUser(calleeId, {
      callId: call.id,
      callerName,
      callType: call.type,
    });
    // iOS-only: wakes a fully terminated/backgrounded app via PushKit and
    // shows the system-level CallKit incoming-call UI (Accept/Decline),
    // which the FCM "background" push above can't do reliably on its own
    // once the app is actually killed — see src/lib/apns-voip.ts. No-ops
    // for a callee with no registered VoipPushToken (Android, or an iOS
    // device on a build predating this feature). Explicitly caught here,
    // not just relying on its own internal best-effort contract — a hung
    // or failed VoIP push must never take down the whole call the way a
    // real startCall failure just did (the call itself already worked;
    // this is strictly additive on top of it).
    await sendVoipCallToUser(calleeId, {
      callId: call.id,
      callerName,
      callType: call.type,
    }).catch(() => {});
    await track("CALL_STARTED", user.id, { type: call.type });
    await publishEvent(REALTIME_CHANNELS.callSignal(calleeId), "changed");
    return { error: null, callId: call.id, roomUrl: room.url, token, type: call.type };
  } catch {
    await prisma.call.delete({ where: { id: call.id } });
    await deleteCallRoom(room.name);
    return { error: "call_service_unavailable" as const };
  }
}

/** Polled by the callee (for an incoming ring) and by the caller (to see accept/decline) alike. */
export async function getCallStatus(callId: string) {
  const user = await requireVerifiedUser();

  const call = await prisma.call.findUnique({
    where: { id: callId },
    include: { participants: { where: { userId: user.id }, select: { status: true } } },
  });
  const mine = call?.participants[0];
  if (!call || (call.callerId !== user.id && call.calleeId !== user.id && !mine)) {
    return { error: "not_found" as const };
  }

  return { error: null, status: statusForMember(call.status, mine?.status), type: call.type, ringing: call.ringingAt !== null };
}

/**
 * The call's status as one person in it sees it. Unchanged for a plain 1:1
 * call. Once people have been added, each person's own CallParticipant row
 * decides: someone who left, declined or rang out sees ENDED while the call
 * carries on for the rest, and someone being added sees RINGING.
 */
function statusForMember(
  callStatus: "RINGING" | "ACCEPTED" | "DECLINED" | "ENDED" | "MISSED",
  mine: "RINGING" | "JOINED" | "DECLINED" | "MISSED" | "LEFT" | undefined,
) {
  if (!mine || callStatus !== "ACCEPTED") return callStatus;
  if (mine === "JOINED") return "ACCEPTED" as const;
  return mine === "RINGING" ? ("RINGING" as const) : ("ENDED" as const);
}

/**
 * The callee's side of the ring — one RINGING call at a time is all the UI
 * surfaces. Polled app-wide by IncomingCallListener on every authenticated
 * page, so unlike other actions here it must fail soft rather than throw:
 * a session ending mid-poll (sign-out, password reset, deactivation) is an
 * expected condition for a background poller, not an error to surface.
 */
export async function getIncomingCall() {
  try {
    const user = await requireVerifiedUser();
    const call = await prisma.call.findFirst({
      where: { calleeId: user.id, status: "RINGING" },
      orderBy: { createdAt: "desc" },
      include: { caller: { select: { id: true, name: true } } },
    });
    // First time this callee's own client has observed the ring — flips the
    // caller's UI from "Calling" to "Ringing". Best-effort: a failed write
    // here shouldn't break the ring itself, it'd just leave the caller on
    // "Calling" a bit longer.
    if (call && !call.ringingAt) {
      const claimed = await prisma.call
        .updateMany({ where: { id: call.id, ringingAt: null }, data: { ringingAt: new Date() } })
        .catch(() => ({ count: 0 }));
      // Tells the caller's CallButton to flip "Calling" -> "Ringing" —
      // guarded on this specific call having actually made the claim (not
      // just call.ringingAt being freshly truthy) so a repeat signal from
      // this same callee client doesn't publish again for no reason.
      if (claimed.count > 0) {
        await publishEvent(REALTIME_CHANNELS.callSignal(call.callerId), "changed");
      }
    }
    // requireVerifiedUser() already fetched the full row, so this is free —
    // the callee's own ringtone preference, for the UI to actually play it.
    if (call) {
      return {
        call: {
          id: call.id,
          type: call.type,
          roomUrl: call.roomUrl,
          calleeToken: call.calleeToken,
          caller: { id: call.caller.id, name: await maskHiddenCallerName(user.id, call.caller.id, call.caller.name) },
          othersInCall: 0,
        },
        ringtone: user.ringtone,
      };
    }
    return { call: await getIncomingInvite(user.id), ringtone: user.ringtone };
  } catch {
    return { call: null, ringtone: null };
  }
}

/**
 * Someone ringing this user to join a call already in progress, in the same
 * shape as a 1:1 ring: `caller` is whoever added them, and `othersInCall`
 * counts the people in the call besides that inviter.
 */
async function getIncomingInvite(userId: string) {
  const invite = await prisma.callParticipant.findFirst({
    where: { userId, status: "RINGING", call: { status: "ACCEPTED" } },
    orderBy: { createdAt: "desc" },
    include: {
      call: {
        select: {
          id: true,
          type: true,
          roomUrl: true,
          callerId: true,
          participants: { where: { status: "JOINED" }, select: { userId: true } },
        },
      },
    },
  });
  if (!invite) return null;
  const inviterId = invite.invitedById ?? invite.call.callerId;
  const inviter = await prisma.user.findUnique({ where: { id: inviterId }, select: { id: true, name: true } });
  return {
    id: invite.call.id,
    type: invite.call.type,
    roomUrl: invite.call.roomUrl,
    // Withheld until they accept (respondToCall hands it over), unlike a 1:1
    // ring: the client joins the room muted with this while still ringing
    // (call-prewarm.ts), and here the room has people in it who would see
    // that as someone arriving before they've answered.
    calleeToken: null,
    caller: { id: inviterId, name: await maskHiddenCallerName(userId, inviterId, inviter?.name ?? null) },
    othersInCall: invite.call.participants.filter((p) => p.userId !== inviterId).length,
  };
}

export async function respondToCall(callId: string, accept: boolean) {
  const user = await requireVerifiedUser();

  const call = await findCallWithParticipants(callId);
  const mine = call?.participants.find((p) => p.userId === user.id);
  if (call && mine && call.status !== "RINGING") {
    return respondToInvite(user, call, mine, accept);
  }
  if (!call || call.calleeId !== user.id) {
    return { error: "not_found" as const };
  }
  if (call.status !== "RINGING") {
    return { error: "invalid" as const };
  }

  // Both transitions below are guarded on the call still being RINGING, not
  // just on the read above: the caller cancelling (endCall) or the
  // timeout-missed-calls cron can resolve it in between, and an unguarded
  // write would then put an already-MISSED call (Daily room deleted) back
  // to ACCEPTED/DECLINED — an ACCEPTED one stays that way for good, and
  // startCall reports "already_calling" for the pair from then on. A
  // 0-count result means that happened, so this answers the same as if the
  // read above had seen it.
  if (!accept) {
    const { count } = await prisma.call.updateMany({
      where: { id: callId, status: "RINGING" },
      data: { status: "DECLINED", respondedAt: new Date() },
    });
    if (count === 0) {
      return { error: "invalid" as const };
    }
    await publishEvent(REALTIME_CHANNELS.callSignal(call.callerId), "changed");
    return { error: null, accepted: false as const };
  }

  try {
    // Already minted by startCall and stored on the row — the common path
    // needs no Daily REST call here at all. Falls back to minting on the
    // spot only for a pre-existing Call row that predates this column (or
    // one where minting failed at startCall time for some other reason).
    const token =
      call.calleeToken ??
      (await createMeetingToken({
        roomName: call.roomName,
        userId: user.id,
        userName: user.name ?? "Guest",
        isOwner: false,
        expiresInSeconds: CALL_ROOM_LIFETIME_SECONDS,
      }));
    const { count } = await prisma.call.updateMany({
      where: { id: callId, status: "RINGING" },
      data: { status: "ACCEPTED", respondedAt: new Date() },
    });
    if (count === 0) {
      return { error: "invalid" as const };
    }
    await publishEvent(REALTIME_CHANNELS.callSignal(call.callerId), "changed");
    return { error: null, accepted: true as const, roomUrl: call.roomUrl, token, type: call.type };
  } catch {
    return { error: "call_service_unavailable" as const };
  }
}

type CallWithParticipants = NonNullable<Awaited<ReturnType<typeof findCallWithParticipants>>>;
type ParticipantRow = CallWithParticipants["participants"][number];

function findCallWithParticipants(callId: string) {
  return prisma.call.findUnique({ where: { id: callId }, include: { participants: true } });
}

function liveUserIds(call: CallWithParticipants) {
  if (call.participants.length === 0) return [call.callerId, call.calleeId];
  return call.participants.filter((p) => isLiveParticipantStatus(p.status)).map((p) => p.userId);
}

/**
 * Answering a ring to join a call already in progress. Same discipline as
 * the 1:1 path in respondToCall: the write is guarded on the row still being
 * RINGING, since the cron's ring timeout and the call ending can both
 * resolve it first, and a 0-count result answers as if the read had seen
 * that.
 */
async function respondToInvite(
  user: { id: string; name: string | null },
  call: CallWithParticipants,
  mine: ParticipantRow,
  accept: boolean,
) {
  if (call.status !== "ACCEPTED" || mine.status !== "RINGING") {
    return { error: "invalid" as const };
  }
  const others = liveUserIds(call).filter((id) => id !== user.id);

  if (!accept) {
    const { count } = await prisma.callParticipant.updateMany({
      where: { id: mine.id, status: "RINGING" },
      data: { status: "DECLINED", respondedAt: new Date() },
    });
    if (count === 0) {
      return { error: "invalid" as const };
    }
    // Declining can leave one person alone in the call with nobody else on
    // the way — that ends it.
    await settleCall(call.id);
    await signalCallUsers(others);
    return { error: null, accepted: false as const };
  }

  try {
    const token =
      mine.token ??
      (await createMeetingToken({
        roomName: call.roomName,
        userId: user.id,
        userName: user.name ?? "Guest",
        isOwner: false,
        expiresInSeconds: CALL_ROOM_LIFETIME_SECONDS,
      }));
    const joined = await prisma.$transaction(async (tx) => {
      if (!(await lockConnectedCall(tx, call.id))) return false;
      const { count } = await tx.callParticipant.updateMany({
        where: { id: mine.id, status: "RINGING" },
        data: { status: "JOINED", respondedAt: new Date() },
      });
      return count > 0;
    });
    if (!joined) {
      return { error: "invalid" as const };
    }
    await signalCallUsers(others);
    return { error: null, accepted: true as const, roomUrl: call.roomUrl, token, type: call.type };
  } catch {
    return { error: "call_service_unavailable" as const };
  }
}

/**
 * Rings one of the caller's own connections to join a connected call. Anyone
 * in the call can do it, up to CALL_MAX_PARTICIPANTS people counting those
 * still being rung. The first invite on a call also writes JOINED rows for
 * its original caller and callee; from then on endCall means "I leave" and
 * the call lasts until shouldEndAfterLeave says otherwise.
 */
export async function inviteToCall(callId: string, inviteeId: string) {
  const user = await requireVerifiedUser();

  if (!isCallingConfigured()) {
    return { error: "not_configured" as const };
  }
  const allowed = await checkRateLimit("call", user.id);
  if (!allowed) {
    return { error: "rate_limited" as const };
  }
  if (typeof callId !== "string" || typeof inviteeId !== "string" || !callId || !inviteeId || inviteeId === user.id) {
    return { error: "invalid" as const };
  }

  const call = await findCallWithParticipants(callId);
  if (!call || !liveUserIds(call).includes(user.id) || isRingingIn(call, user.id)) {
    return { error: "not_found" as const };
  }
  if (call.status !== "ACCEPTED") {
    return { error: "invalid" as const };
  }
  const currentIds = liveUserIds(call);
  if (currentIds.includes(inviteeId)) {
    return { error: "already_in_call" as const };
  }
  if (currentIds.length >= CALL_MAX_PARTICIPANTS) {
    return { error: "full" as const };
  }

  const [connection, invitee, blocked, busy] = await Promise.all([
    requireAcceptedConnection(user.id, inviteeId),
    prisma.user.findUnique({ where: { id: inviteeId }, select: { id: true, name: true, status: true } }),
    isBlockedWithAny(inviteeId, currentIds),
    isInAnotherLiveCall(inviteeId, callId),
  ]);
  if (!connection) {
    return { error: "not_connected" as const };
  }
  // One answer for a missing or inactive account and for a block between
  // the invitee and anyone in the call, so it can't be used to learn who
  // has blocked whom.
  if (!invitee || invitee.status !== "ACTIVE" || blocked) {
    return { error: "unavailable" as const };
  }
  if (busy) {
    return { error: "busy" as const };
  }

  let token: string;
  try {
    token = await createMeetingToken({
      roomName: call.roomName,
      userId: inviteeId,
      userName: invitee.name ?? "Guest",
      isOwner: false,
      expiresInSeconds: CALL_ROOM_LIFETIME_SECONDS,
    });
  } catch {
    return { error: "call_service_unavailable" as const };
  }

  // Everything above was read before taking the call's lock, so the parts
  // that another invite, a hang-up or the call ending could have changed
  // are checked again inside it.
  const outcome = await prisma.$transaction(async (tx) => {
    if (!(await lockConnectedCall(tx, callId))) return { error: "invalid" as const };
    const now = new Date();
    await tx.callParticipant.createMany({
      data: [call.callerId, call.calleeId].map((userId) => ({
        callId,
        userId,
        status: "JOINED" as const,
        respondedAt: now,
      })),
      skipDuplicates: true,
    });
    const rows = await tx.callParticipant.findMany({ where: { callId } });
    if (rows.find((p) => p.userId === user.id)?.status !== "JOINED") return { error: "not_found" as const };
    const live = rows.filter((p) => isLiveParticipantStatus(p.status));
    if (live.some((p) => p.userId === inviteeId)) return { error: "already_in_call" as const };
    if (live.length >= CALL_MAX_PARTICIPANTS) return { error: "full" as const };
    // Someone who declined, rang out or left is rung again on their old
    // row. createdAt restarts with it: that is what the cron's ring timeout
    // counts from.
    await tx.callParticipant.upsert({
      where: { callId_userId: { callId, userId: inviteeId } },
      create: { callId, userId: inviteeId, invitedById: user.id, status: "RINGING", token },
      update: {
        invitedById: user.id,
        status: "RINGING",
        token,
        createdAt: now,
        respondedAt: null,
        leftAt: null,
      },
    });
    return { error: null, liveIds: live.map((p) => p.userId) };
  });
  if (outcome.error !== null) {
    return { error: outcome.error };
  }

  try {
    // The same three rings startCall sends, with this call's id and the
    // inviter as the caller — see the comments there.
    const callerName = (await maskHiddenCallerName(inviteeId, user.id, user.name)) ?? "Someone";
    await sendPushToUser(inviteeId, {
      title: `Incoming ${call.type === "VIDEO" ? "video" : "voice"} call`,
      body: `${callerName} is calling you`,
      url: "/",
    });
    await sendFcmCallToUser(inviteeId, {
      callId,
      callerName,
      callType: call.type,
    });
    await sendVoipCallToUser(inviteeId, {
      callId,
      callerName,
      callType: call.type,
    }).catch(() => {});
    await signalCallUsers([...outcome.liveIds, inviteeId]);
    return { error: null };
  } catch {
    await prisma.callParticipant.updateMany({
      where: { callId, userId: inviteeId, status: "RINGING" },
      data: { status: "MISSED", respondedAt: new Date() },
    });
    await settleCall(callId);
    return { error: "call_service_unavailable" as const };
  }
}

function isRingingIn(call: CallWithParticipants, userId: string) {
  return call.participants.some((p) => p.userId === userId && p.status === "RINGING");
}

/**
 * Whether this person is ringing or connected on some other call. For a
 * call people were added to, their own participant row decides (they may
 * have left it while it carries on); for a plain 1:1 call, being its caller
 * or callee does.
 */
async function isInAnotherLiveCall(userId: string, exceptCallId: string) {
  const calls = await prisma.call.findMany({
    where: {
      id: { not: exceptCallId },
      status: { in: ["RINGING", "ACCEPTED"] },
      OR: [
        { callerId: userId },
        { calleeId: userId },
        { participants: { some: { userId, status: { in: ["RINGING", "JOINED"] } } } },
      ],
    },
    select: { participants: { where: { userId }, select: { status: true } } },
  });
  return calls.some((c) => c.participants.length === 0 || isLiveParticipantStatus(c.participants[0].status));
}

/**
 * Who is in a call: names, avatars and where each person stands. For the
 * people in it (or being rung for it) only. A plain 1:1 call answers with
 * its caller and callee and `group: false`. `over` is true once the call has
 * ended or the person asking is no longer part of it, and then nobody is
 * listed.
 */
export async function getCallRoster(callId: string) {
  const user = await requireVerifiedUser();
  if (typeof callId !== "string" || !callId) {
    return { error: "not_found" as const };
  }

  const call = await prisma.call.findUnique({
    where: { id: callId },
    include: {
      participants: {
        orderBy: { createdAt: "asc" },
        select: { userId: true, status: true, user: { select: { name: true, avatarUrl: true } } },
      },
    },
  });
  const mine = call?.participants.find((p) => p.userId === user.id);
  if (!call || (call.callerId !== user.id && call.calleeId !== user.id && !mine)) {
    return { error: "not_found" as const };
  }

  const group = call.participants.length > 0;
  const callOver = call.status === "ENDED" || call.status === "DECLINED" || call.status === "MISSED";
  if (callOver || (mine && !isLiveParticipantStatus(mine.status))) {
    return { error: null, group, over: true, participants: [] };
  }
  if (group) {
    return {
      error: null,
      group,
      over: false,
      participants: call.participants.map((p) => ({
        userId: p.userId,
        name: p.user.name,
        avatarUrl: p.user.avatarUrl,
        status: p.status,
      })),
    };
  }
  const pair = await prisma.user.findMany({
    where: { id: { in: [call.callerId, call.calleeId] } },
    select: { id: true, name: true, avatarUrl: true },
  });
  return {
    error: null,
    group,
    over: false,
    participants: pair.map((u) => ({
      userId: u.id,
      name: u.name,
      avatarUrl: u.avatarUrl,
      status: (call.status === "RINGING" && u.id === call.calleeId ? "RINGING" : "JOINED") as ParticipantRow["status"],
    })),
  };
}

/**
 * Leaving a call that has had people added to it. Only this person goes:
 * the call carries on for the rest and ends by shouldEndAfterLeave (see
 * settleCall). Guarded like every other transition here — both of the last
 * two people can leave at once, and the cron can be closing the same rows.
 */
async function leaveGroupCall(userId: string, call: CallWithParticipants, mine: ParticipantRow | undefined) {
  if (!mine || !isLiveParticipantStatus(mine.status)) {
    return { error: null };
  }
  const now = new Date();
  const { count } = await prisma.callParticipant.updateMany({
    where: { id: mine.id, status: mine.status },
    data: mine.status === "RINGING" ? { status: "DECLINED", respondedAt: now } : { status: "LEFT", leftAt: now },
  });
  if (count === 0) {
    return { error: null };
  }
  // Same as the answered-call branch of endCall: nothing else tells this
  // person's own CallKit that the call it reported is over.
  if (wasRungForCall(call, mine)) {
    await sendVoipCallCancelToUser(userId, call.id).catch(() => {});
  }
  await settleCall(call.id);
  // Self included: this can be reached from somewhere other than the call
  // UI (CallButton's "cancel it & call again"), which then has to find out.
  await signalCallUsers([...liveUserIds(call), userId]);
  return { error: null };
}

export async function endCall(callId: string) {
  const user = await requireVerifiedUser();

  const call = await findCallWithParticipants(callId);
  const mine = call?.participants.find((p) => p.userId === user.id);
  if (!call || (call.callerId !== user.id && call.calleeId !== user.id && !mine)) {
    return { error: "not_found" as const };
  }
  if (call.status === "ENDED" || call.status === "DECLINED" || call.status === "MISSED") {
    return { error: null };
  }
  if (call.participants.length > 0) {
    return leaveGroupCall(user.id, call, mine);
  }

  let wasRinging = call.status === "RINGING";
  if (wasRinging) {
    // Guarded on the call still being RINGING: the timeout-missed-calls
    // cron (or the callee responding) can resolve it between the read above
    // and this write. A 0-count result means one of them did — whoever won
    // has already done its own room deletion/signal/missed-call
    // notification, so repeating them here is what used to notify the
    // callee of the same missed call twice.
    const { count } = await prisma.call.updateMany({
      where: { id: callId, status: "RINGING" },
      data: { status: call.callerId === user.id ? "MISSED" : "ENDED", endedAt: new Date() },
    });
    if (count === 0) {
      const current = await prisma.call.findUnique({ where: { id: callId }, select: { status: true } });
      // The one outcome that still needs ending: the callee accepted in
      // that window, so this is now a hang-up of a connected call (below),
      // not a missed one. Anything else is already over.
      if (current?.status !== "ACCEPTED") {
        return { error: null };
      }
      wasRinging = false;
    }
  }
  if (!wasRinging) {
    // Guarded on ACCEPTED for the same reason as the RINGING write above:
    // both sides can now end the same connected call at once (one giving up
    // on a reconnect just as the other's wait for them runs out), and the
    // timeout-missed-calls cron sweeps stale ACCEPTED rows too. Whoever
    // loses has nothing left to do — the winner deleted the room, signalled
    // and told CallKit.
    const { count } = await prisma.call.updateMany({
      where: { id: callId, status: "ACCEPTED" },
      data: { status: "ENDED", endedAt: new Date() },
    });
    if (count === 0) {
      return { error: null };
    }
  }
  await deleteCallRoom(call.roomName);

  // Tells whichever side didn't call this to tear down immediately, rather
  // than waiting on Daily's own room-ejection (which this app's own
  // deleteCallRoom call above already races) or the fallback poll this
  // replaces. Published to both parties — self-notifying the caller of
  // their own endCall is harmless (their local state is already updated).
  const otherPartyId = call.callerId === user.id ? call.calleeId : call.callerId;
  await publishEvent(REALTIME_CHANNELS.callSignal(otherPartyId), "changed");

  // The caller hanging up before the callee answered, i.e. a missed call —
  // clear the callee's native ringing notification (it has no other way to
  // find out the call is gone) and let them know they missed it.
  if (wasRinging && call.callerId === user.id) {
    await notifyMissedCall({
      callId: call.id,
      callerId: user.id,
      callerName: user.name ?? "Someone",
      calleeId: call.calleeId,
    });
  } else {
    // The call was already answered (or the callee ended it while it was
    // still ringing) — the callee's device is the only side that ever gets
    // a CallKit-reported call (see startCall's sendVoipCallToUser, always
    // sent to calleeId), and nothing else ever tells CallKit that report
    // is over once it's been answered. Confirmed live: skipping this left
    // a "residual" call CallKit still believed was active indefinitely,
    // which also corrupted whether a *later* incoming call correctly
    // reported itself as video vs audio. No-ops on a non-iOS/untokened
    // callee, same as every other VoIP send in this app.
    await sendVoipCallCancelToUser(call.calleeId, callId).catch(() => {});
  }

  return { error: null };
}
