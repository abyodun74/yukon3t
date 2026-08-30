import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";
import { sendFcmCallCancelToUser, sendFcmMissedCallToUser } from "@/lib/fcm";

/**
 * Tells the callee a call went unanswered — shared by endCall (the caller
 * hangs up while the call is still RINGING) and the timeout-missed-calls
 * cron (nobody ever responds). Assumes the Call row is already updated to
 * MISSED and its Daily room already torn down; this only handles notifying
 * the callee, so it can run identically from either caller.
 */
export async function notifyMissedCall(params: {
  callId: string;
  callerId: string;
  callerName: string;
  calleeId: string;
}) {
  const { callId, callerId, callerName, calleeId } = params;

  // Clears the native ringing notification (if any) — without this, a
  // caller hanging up mid-ring would leave the callee's phone stuck showing
  // a call that's already gone.
  await sendFcmCallCancelToUser(calleeId, callId);
  // Leaves a proper "Missed call from X" notification behind on Android —
  // separate data message from the cancel above, see sendFcmMissedCallToUser.
  await sendFcmMissedCallToUser(calleeId, callId, callerName);

  await sendPushToUser(calleeId, {
    title: "Missed call",
    body: `${callerName} called you`,
    url: "/",
  });

  // In-app bell notification — same shape as every other notification type,
  // no dedup/throttling (see MESSAGE in actions/messages.ts for the same
  // pattern).
  await prisma.notification.create({
    data: { recipientId: calleeId, actorId: callerId, type: "MISSED_CALL" },
  });
}
