import { initializeApp, cert, getApps, type App } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { prisma } from "@/lib/prisma";

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
// Env vars can't hold a literal newline, so the key is stored with escaped
// "\n" sequences and unescaped here — the standard Firebase-on-serverless
// pattern.
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

export const isFcmConfigured = !!projectId && !!clientEmail && !!privateKey;

let app: App | undefined;
if (isFcmConfigured) {
  app = getApps()[0] ?? initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

export type IncomingCallPayload = {
  callId: string;
  callerName: string;
  callType: "AUDIO" | "VIDEO";
};

/**
 * Sends a data-only FCM message (not a "notification" payload) to every
 * device registered for a user — the native Android app's own
 * CallMessagingService (android/app/src/main/java/com/yukon3t/app/) decides
 * how to display it, using a proper call-style notification channel
 * (system ringtone, full-screen intent over the lock screen via
 * CallForegroundService) instead of a generic auto-displayed one, which is
 * the whole reason FCM exists here alongside the Web Push path in push.ts —
 * this is also what lets an incoming call still ring while the phone is
 * asleep/Doze-throttled, when incoming-call-listener.tsx's own JS polling
 * would otherwise be frozen.
 * Best-effort, same as sendPushToUser — a send failure should never break
 * the call action that triggered it. No-op until the Firebase project env
 * vars above are set.
 */
async function sendFcmDataToUser(userId: string, data: Record<string, string>) {
  // TEMPORARY diagnostic logging — remove once the missing-ringtone
  // intermittency is root-caused. See src/lib/fcm.ts history/PR for context.
  if (!isFcmConfigured || !app) {
    console.log("[fcm-debug] not configured, skipping send", { userId, type: data.type });
    return;
  }

  const tokens = await prisma.fcmToken.findMany({ where: { userId } });
  console.log("[fcm-debug] tokens found", { userId, type: data.type, count: tokens.length });
  if (tokens.length === 0) return;

  // Genuinely best-effort, matching sendPushToUser's contract: callers like
  // startCall/endCall and the event-reminders cron must not fail (or, for
  // startCall, roll back an otherwise-successful action) just because FCM
  // had a transient outage.
  let response;
  try {
    response = await getMessaging(app).sendEachForMulticast({
      tokens: tokens.map((t) => t.token),
      data,
      android: {
        // Delivered immediately, bypassing Doze/App Standby batching — a call
        // notification arriving minutes late defeats the point.
        priority: "high",
      },
      // iOS's counterpart to the android block above: content-available
      // marks this a silent background push (there's no notification
      // payload — the app's own JS decides how to surface it, same as
      // Android), and priority 5 is what APNs requires for that push type
      // (10 is reserved for alert pushes with a visible banner/sound).
      // Note this is still a best-effort background push, not a true VoIP
      // push — iOS can throttle/delay these more than Android's FCM
      // high-priority delivery, especially once the app is fully
      // terminated. Matching Android's instant-wake reliability for calls
      // specifically would need PushKit (apns-push-type: voip) + CallKit,
      // which is native Swift work beyond what a Capacitor plugin covers
      // out of the box.
      apns: {
        headers: {
          "apns-priority": "5",
          "apns-push-type": "background",
        },
        payload: {
          aps: {
            contentAvailable: true,
          },
        },
      },
    });
  } catch (err) {
    console.log("[fcm-debug] sendEachForMulticast threw", { userId, type: data.type, err: String(err) });
    return;
  }

  console.log(
    "[fcm-debug] send result",
    {
      userId,
      type: data.type,
      successCount: response.successCount,
      failureCount: response.failureCount,
      errors: response.responses
        .map((r, i) => (r.success ? null : { token: tokens[i].token.slice(-8), code: r.error?.code, message: r.error?.message }))
        .filter(Boolean),
    },
  );

  const staleTokenIds: string[] = [];
  response.responses.forEach((r, i) => {
    // "not-registered" = the app was uninstalled or the token otherwise
    // expired on Google's side — stop sending to it. Any other failure (a
    // transient outage) is left alone rather than deleting a possibly-still-
    // valid token.
    if (!r.success && r.error?.code === "messaging/registration-token-not-registered") {
      staleTokenIds.push(tokens[i].id);
    }
  });
  if (staleTokenIds.length > 0) {
    await prisma.fcmToken.deleteMany({ where: { id: { in: staleTokenIds } } }).catch(() => {});
  }
}

export async function sendFcmCallToUser(userId: string, payload: IncomingCallPayload) {
  await sendFcmDataToUser(userId, {
    type: "incoming_call",
    callId: payload.callId,
    callerName: payload.callerName,
    callType: payload.callType,
  });
}

/**
 * Clears a ringing call's native notification — without this, a caller
 * hanging up before the callee answers would leave the callee's phone
 * showing (and possibly still ringing) a call that no longer exists, with
 * no way for the native side to know to stop on its own.
 */
export async function sendFcmCallCancelToUser(userId: string, callId: string) {
  await sendFcmDataToUser(userId, { type: "call_cancelled", callId });
}

/**
 * Distinct from call_cancelled above: that one only clears the ringing
 * notification, this one leaves a "Missed call from X" notification behind
 * — same data-message path, handled by CallMessagingService.java on the
 * Android side (a no-op there until that's updated and shipped in a new
 * Play Store release, per CLAUDE.md's native-code note).
 */
export async function sendFcmMissedCallToUser(userId: string, callId: string, callerName: string) {
  await sendFcmDataToUser(userId, { type: "missed_call", callId, callerName });
}

export async function sendFcmEventReminderToUser(
  userId: string,
  payload: { postId: string; title: string },
) {
  await sendFcmDataToUser(userId, {
    type: "event_reminder",
    postId: payload.postId,
    title: payload.title,
  });
}
