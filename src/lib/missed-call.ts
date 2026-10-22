import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";
import { sendFcmCallCancelToUser, sendFcmMissedCallToUser } from "@/lib/fcm";
import { sendVoipCallCancelToUser } from "@/lib/apns-voip";
import { getHiddenPeerIds } from "@/lib/hidden-chats";
import { nameOrSomeone, pushText } from "@/lib/push-text";
import { format } from "@/lib/i18n/locales";

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
  // Null for a caller with no name: "Someone" in the callee's language.
  callerName: string | null;
  calleeId: string;
}) {
  const { callId, callerId, callerName, calleeId } = params;

  // Clears the native ringing notification (if any) — without this, a
  // caller hanging up mid-ring would leave the callee's phone stuck showing
  // a call that's already gone.
  await sendFcmCallCancelToUser(calleeId, callId);
  // iOS counterpart: dismisses a CallKit incoming-call UI already reported
  // via sendVoipCallToUser (startCall) — no-ops if this device never
  // registered a VoipPushToken. Explicitly caught for the same reason as
  // its startCall call site — see apns-voip.ts's own timeout comment.
  await sendVoipCallCancelToUser(calleeId, callId).catch(() => {});
  // The callee has hidden their chat with this caller: the ring is still cleared (above, by call id alone), but
  // nothing that names the caller is left behind: no "Missed call from X" push and no bell row.
  if ((await getHiddenPeerIds(calleeId)).includes(callerId)) return;
  // Leaves a proper "Missed call from X" notification behind on Android —
  // separate data message from the cancel above, see sendFcmMissedCallToUser.
  await sendFcmMissedCallToUser(calleeId, callId, (locale) => nameOrSomeone(callerName, locale));

  // Opens the caller's profile (call back / message from there), the same place the bell's missed-call row leads.
  await sendPushToUser(calleeId, (locale) => {
    const t = pushText(locale).call;
    return {
      title: t.missedTitle,
      body: format(t.missed, { name: nameOrSomeone(callerName, locale) }),
      url: `/u/${callerId}`,
    };
  });

  // In-app bell notification — same shape as every other notification type,
  // no dedup/throttling (see MESSAGE in actions/messages.ts for the same
  // pattern).
  await prisma.notification.create({
    data: { recipientId: calleeId, actorId: callerId, type: "MISSED_CALL" },
  });
}
