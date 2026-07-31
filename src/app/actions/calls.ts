"use server";

import { randomUUID } from "node:crypto";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { createCallRoom, createMeetingToken, deleteCallRoom, isCallingConfigured } from "@/lib/daily";

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

  const connection = await requireAcceptedConnection(user.id, calleeId);
  if (!connection) {
    return { error: "not_connected" as const };
  }

  const callee = await prisma.user.findUnique({ where: { id: calleeId } });
  if (!callee || callee.status !== "ACTIVE") {
    return { error: "not_found" as const };
  }

  // One ringing/active call to a given person at a time — otherwise a
  // double-click would spawn a second Daily room and a second ring.
  const existing = await prisma.call.findFirst({
    where: { callerId: user.id, calleeId, status: { in: ["RINGING", "ACCEPTED"] } },
  });
  if (existing) {
    return { error: "already_calling" as const };
  }

  let room: { url: string; name: string };
  try {
    room = await createCallRoom({ name: `call-${randomUUID()}` });
  } catch {
    return { error: "call_service_unavailable" as const };
  }

  const call = await prisma.call.create({
    data: { callerId: user.id, calleeId, type, roomName: room.name, roomUrl: room.url },
  });

  try {
    const token = await createMeetingToken({
      roomName: room.name,
      userId: user.id,
      userName: user.name ?? "Caller",
      isOwner: true,
    });
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

  return { error: null, status: call.status, type: call.type };
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
    return { call };
  } catch {
    return { call: null };
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
    const token = await createMeetingToken({
      roomName: call.roomName,
      userId: user.id,
      userName: user.name ?? "Guest",
      isOwner: false,
    });
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

  return { error: null };
}
