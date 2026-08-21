"use server";

import { randomUUID } from "node:crypto";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { createCallRoom, createMeetingToken, deleteCallRoom, isCallingConfigured } from "@/lib/daily";
import { isBlockedEitherWay } from "@/lib/blocks";
import { sendPushToUser } from "@/lib/push";
import { sendFcmCallToUser, sendFcmCallCancelToUser } from "@/lib/fcm";
import { track } from "@/lib/analytics";

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
  const existing = await prisma.call.findFirst({
    where: {
      status: { in: ["RINGING", "ACCEPTED"] },
      OR: [
        { callerId: user.id, calleeId },
        { callerId: calleeId, calleeId: user.id },
      ],
    },
  });
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
    // moment the callee actually taps Accept.
    [token, calleeToken] = await Promise.all([
      createMeetingToken({ roomName: room.name, userId: user.id, userName: user.name ?? "Caller", isOwner: true }),
      createMeetingToken({ roomName: room.name, userId: calleeId, userName: callee.name ?? "Guest", isOwner: false }),
    ]);
  } catch {
    await deleteCallRoom(room.name);
    return { error: "call_service_unavailable" as const };
  }

  const call = await prisma.call.create({
    data: { callerId: user.id, calleeId, type, roomName: room.name, roomUrl: room.url, calleeToken },
  });

  try {
    await sendPushToUser(calleeId, {
      title: `Incoming ${call.type === "VIDEO" ? "video" : "voice"} call`,
      body: `${user.name ?? "Someone"} is calling you`,
      url: "/",
    });
    // Separate from the Web Push above: this is a data-only message the
    // native Android app's own notification code turns into a proper
    // call-style ring (system ringtone, full-screen), rather than a
    // browser notification. See src/lib/fcm.ts.
    await sendFcmCallToUser(calleeId, {
      callId: call.id,
      callerName: user.name ?? "Someone",
      callType: call.type,
    });
    await track("CALL_STARTED", user.id, { type: call.type });
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

  const call = await prisma.call.findUnique({ where: { id: callId } });
  if (!call || (call.callerId !== user.id && call.calleeId !== user.id)) {
    return { error: "not_found" as const };
  }

  return { error: null, status: call.status, type: call.type, ringing: call.ringingAt !== null };
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
      await prisma.call
        .updateMany({ where: { id: call.id, ringingAt: null }, data: { ringingAt: new Date() } })
        .catch(() => {});
    }
    // requireVerifiedUser() already fetched the full row, so this is free —
    // the callee's own ringtone preference, for the UI to actually play it.
    return { call, ringtone: user.ringtone };
  } catch {
    return { call: null, ringtone: null };
  }
}

export async function respondToCall(callId: string, accept: boolean) {
  const user = await requireVerifiedUser();

  const call = await prisma.call.findUnique({ where: { id: callId } });
  if (!call || call.calleeId !== user.id) {
    return { error: "not_found" as const };
  }
  if (call.status !== "RINGING") {
    return { error: "invalid" as const };
  }

  if (!accept) {
    await prisma.call.update({
      where: { id: callId },
      data: { status: "DECLINED", respondedAt: new Date() },
    });
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
      }));
    await prisma.call.update({
      where: { id: callId },
      data: { status: "ACCEPTED", respondedAt: new Date() },
    });
    return { error: null, accepted: true as const, roomUrl: call.roomUrl, token, type: call.type };
  } catch {
    return { error: "call_service_unavailable" as const };
  }
}

export async function endCall(callId: string) {
  const user = await requireVerifiedUser();

  const call = await prisma.call.findUnique({ where: { id: callId } });
  if (!call || (call.callerId !== user.id && call.calleeId !== user.id)) {
    return { error: "not_found" as const };
  }
  if (call.status === "ENDED" || call.status === "DECLINED" || call.status === "MISSED") {
    return { error: null };
  }

  const wasRinging = call.status === "RINGING";
  await prisma.call.update({
    where: { id: callId },
    data: {
      status: wasRinging && call.callerId === user.id ? "MISSED" : "ENDED",
      endedAt: new Date(),
    },
  });
  await deleteCallRoom(call.roomName);

  // The caller hanging up before the callee answered — the callee's native
  // notification (if any) has no other way to find out the call is gone
  // and would otherwise keep ringing/showing indefinitely.
  if (wasRinging && call.callerId === user.id) {
    await sendFcmCallCancelToUser(call.calleeId, call.id);
  }

  return { error: null };
}
