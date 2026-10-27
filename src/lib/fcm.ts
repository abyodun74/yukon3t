import type { App } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getFirebaseAdminApp, isFirebaseAdminConfigured } from "@/lib/firebase-admin";
import { groupByLocale, perLocale, storedLocale, type Localized } from "@/lib/push-text";
import { incomingCallData, missedCallData } from "@/lib/call-push-data";

// The recipient's language comes back with their tokens (one query, see push-text.ts).
const TOKEN_SELECT = { id: true, token: true, user: { select: { locale: true } } } as const;
type Token = { id: string; token: string; user: { locale: string | null } };

const isFcmConfigured = isFirebaseAdminConfigured();

const app: App | undefined = isFcmConfigured ? getFirebaseAdminApp() : undefined;

export type IncomingCallPayload = {
  callId: string;
  // The caller as the ring shows them, in the callee's language (ringCallerName in push-text.ts).
  callerName: Localized<string>;
  callType: "AUDIO" | "VIDEO";
  // Absolute, short-lived https link to the caller's thumbnail for the Android ring's large icon, or null for no
  // picture (none set, or announced as "Private call"). See call-avatar-server.ts.
  callerAvatarUrl?: string | null;
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
async function sendFcmDataToUser(userId: string, localizedData: Localized<Record<string, string>>) {
  const dataFor = perLocale(localizedData);
  // TEMPORARY diagnostic logging — remove once the missing-ringtone
  // intermittency is root-caused. See src/lib/fcm.ts history/PR for context.
  if (!isFcmConfigured || !app) {
    console.log("[fcm-debug] not configured, skipping send", { userId, type: dataFor("en").type });
    return;
  }

  const tokens: Token[] = await prisma.fcmToken.findMany({ where: { userId }, select: TOKEN_SELECT });
  // Every token here is the same person's, so one language.
  const data = dataFor(storedLocale(tokens[0]?.user.locale));
  console.log("[fcm-debug] tokens found", { userId, type: data.type, count: tokens.length });
  if (tokens.length === 0) return;

  // Genuinely best-effort, matching sendPushToUser's contract: callers like
  // startCall/endCall must not fail (or, for
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
  const callerName = perLocale(payload.callerName);
  await sendFcmDataToUser(userId, (locale) =>
    incomingCallData({
      callId: payload.callId,
      callerName: callerName(locale),
      callType: payload.callType,
      callerAvatarUrl: payload.callerAvatarUrl,
    }),
  );
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
 * Android side. `url` is where tapping it leads (the bell row's href); builds
 * before that field was read just open the app.
 */
export async function sendFcmMissedCallToUser(
  userId: string,
  callId: string,
  callerName: Localized<string>,
  url: string,
) {
  const nameFor = perLocale(callerName);
  await sendFcmDataToUser(userId, (locale) => missedCallData({ callId, callerName: nameFor(locale), url }));
}

/**
 * Sends a real FCM **notification** payload (unlike sendFcmDataToUser's
 * data-only messages for calls) for ordinary social activity — likes,
 * comments, connection requests, etc. Android auto-displays this in the
 * system tray whenever the app is backgrounded or killed, with no native
 * code involved; CallMessagingService still receives it if the app is
 * foregrounded but won't match any of its existing `type` branches and
 * no-ops, since the in-app bell notification already covers that case live.
 * Best-effort, same contract as sendFcmDataToUser/sendPushToUser.
 */
export async function sendFcmActivityToUser(userId: string, localizedPayload: Localized<ActivityPayload>) {
  if (!isFcmConfigured || !app) return;

  const tokens: Token[] = await prisma.fcmToken.findMany({ where: { userId }, select: TOKEN_SELECT });
  if (tokens.length === 0) return;
  // Every token here is the same person's, so one language.
  const payload = perLocale(localizedPayload)(storedLocale(tokens[0].user.locale));

  try {
    await getMessaging(app).sendEachForMulticast({
      tokens: tokens.map((t) => t.token),
      notification: { title: payload.title, body: payload.body },
      data: { type: payload.type, ...(payload.url ? { url: payload.url } : {}) },
      android: { priority: "high" },
    });
  } catch {
    // Best-effort — a push failure should never break the action that triggered it.
  }
}

// FCM's own hard cap per sendEachForMulticast call — a token list larger
// than this must be chunked, unlike every other function in this file
// (which only ever sends to one user's handful of devices at a time).
const FCM_MULTICAST_CHUNK_SIZE = 500;

/**
 * Pushes a real notification to every device registered across every
 * user — used only by createAnnouncement (actions/announcements.ts) for a
 * genuine "announce to all users" broadcast, not per-user activity like
 * sendFcmActivityToUser above. Chunked at FCM's own multicast limit; each
 * chunk's stale ("not-registered") tokens are pruned the same way
 * sendFcmDataToUser already does for a single user's tokens. Best-effort —
 * a push failure must never block the announcement itself from being
 * created/visible via the in-app WhatsNewBell.
 */
export async function broadcastFcmAnnouncement(payload: { title: string; body: string }) {
  if (!isFcmConfigured || !app) return;

  const tokens = await prisma.fcmToken.findMany({ select: { id: true, token: true } });
  if (tokens.length === 0) return;

  await sendFcmNotificationToTokens(app, tokens, {
    notification: { title: payload.title, body: payload.body },
    data: { type: "ANNOUNCEMENT", url: "/whats-new" },
  });
}

/**
 * sendFcmActivityToUser for many recipients at once (a group message's
 * fan-out — see afterMessageSent in actions/messages.ts): one token query
 * for all of them instead of one per recipient, sent with the same payload
 * shape through the announcement broadcast's chunked multicast. Best-effort
 * and never throws, including when the query itself fails.
 */
export async function sendFcmActivityToUsers(userIds: string[], localizedPayload: Localized<ActivityPayload>) {
  if (!isFcmConfigured || !app || userIds.length === 0) return;

  let tokens: Token[];
  try {
    tokens = await prisma.fcmToken.findMany({
      where: { userId: { in: userIds } },
      select: TOKEN_SELECT,
    });
  } catch (err) {
    console.error("[fcm] token lookup failed", err);
    return;
  }
  if (tokens.length === 0) return;

  // One multicast per language among the recipients' devices, each worded once.
  const payloadFor = perLocale(localizedPayload);
  for (const [locale, group] of groupByLocale(tokens, (token) => token.user.locale)) {
    const payload = payloadFor(locale);
    await sendFcmNotificationToTokens(app, group, {
      notification: { title: payload.title, body: payload.body },
      data: { type: payload.type, ...(payload.url ? { url: payload.url } : {}) },
    });
  }
}

type ActivityPayload = { title: string; body: string; type: string; url?: string };

/** Whether FCM can send at all (the Firebase admin env vars are set). */
export function canSendFcm(): boolean {
  return Boolean(isFcmConfigured && app);
}

/**
 * A notification to every device matching `where` — only the admin's "Notify users on older builds" on
 * /admin/system (actions/app-version.ts), with the filter from olderBuildTokenWhere. Worded per recipient language
 * and sent through the same chunked multicast as the announcement broadcast. Returns how many devices it was sent to
 * (0 when FCM isn't configured or the lookup failed). Never throws.
 */
export async function sendFcmNoticeToTokens(
  where: Prisma.FcmTokenWhereInput,
  localizedPayload: Localized<ActivityPayload>,
): Promise<number> {
  if (!isFcmConfigured || !app) return 0;

  let tokens: Token[];
  try {
    tokens = await prisma.fcmToken.findMany({ where, select: TOKEN_SELECT });
  } catch (err) {
    console.error("[fcm] token lookup failed", err);
    return 0;
  }

  const payloadFor = perLocale(localizedPayload);
  for (const [locale, group] of groupByLocale(tokens, (token) => token.user.locale)) {
    const payload = payloadFor(locale);
    await sendFcmNotificationToTokens(app, group, {
      notification: { title: payload.title, body: payload.body },
      data: { type: payload.type, ...(payload.url ? { url: payload.url } : {}) },
    });
  }
  return tokens.length;
}


async function sendFcmNotificationToTokens(
  app: App,
  tokens: { id: string; token: string }[],
  message: { notification: { title: string; body: string }; data: Record<string, string> },
) {
  for (let i = 0; i < tokens.length; i += FCM_MULTICAST_CHUNK_SIZE) {
    const chunk = tokens.slice(i, i + FCM_MULTICAST_CHUNK_SIZE);
    try {
      const response = await getMessaging(app).sendEachForMulticast({
        tokens: chunk.map((t) => t.token),
        notification: message.notification,
        data: message.data,
        android: { priority: "high" },
      });
      const staleTokenIds: string[] = [];
      response.responses.forEach((r, idx) => {
        if (!r.success && r.error?.code === "messaging/registration-token-not-registered") {
          staleTokenIds.push(chunk[idx].id);
        }
      });
      if (staleTokenIds.length > 0) {
        await prisma.fcmToken.deleteMany({ where: { id: { in: staleTokenIds } } }).catch(() => {});
      }
    } catch {
      // Best-effort — one failed chunk shouldn't stop the rest from sending.
    }
  }
}
