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
 * FirebaseMessagingService decides how to display it, so it can use a
 * proper call-style notification channel (system ringtone, full-screen
 * intent) instead of a generic auto-displayed one, which is the whole
 * reason FCM exists here alongside the Web Push path in push.ts.
 * Best-effort, same as sendPushToUser — a send failure should never break
 * the call action that triggered it. No-op until the Firebase project env
 * vars above are set.
 */
async function sendFcmDataToUser(userId: string, data: Record<string, string>) {
  if (!isFcmConfigured || !app) return;

  const tokens = await prisma.fcmToken.findMany({ where: { userId } });
  if (tokens.length === 0) return;

  const response = await getMessaging(app).sendEachForMulticast({
    tokens: tokens.map((t) => t.token),
    data,
    android: {
      // Delivered immediately, bypassing Doze/App Standby batching — a call
      // notification arriving minutes late defeats the point.
      priority: "high",
    },
  });

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
