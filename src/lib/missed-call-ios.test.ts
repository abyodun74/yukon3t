import { beforeEach, describe, expect, it, vi } from "vitest";
import { SUPPORTED_LOCALES, format, type Locale } from "@/lib/i18n/locales";
import { pushText } from "@/lib/push-text";

// The iOS app builds no notification of its own: what an iPhone shows for a missed call is exactly the APNs block of
// the one FCM `missed_call` message (fcm.ts, call-push-data.ts). These run the real notifyMissedCall -> fcm.ts path
// with only the network/database edges mocked, and check the message that would leave for the phone.
const tokenFindMany = vi.fn();
const sendEachForMulticast = vi.fn();
const notificationCreate = vi.fn();
const webPush = vi.fn();
const hiddenPeerIds = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    fcmToken: {
      findMany: (...a: unknown[]) => tokenFindMany(...a),
      deleteMany: vi.fn().mockResolvedValue(undefined),
    },
    notification: { create: (...a: unknown[]) => notificationCreate(...a) },
  },
}));
vi.mock("@/lib/firebase-admin", () => ({
  isFirebaseAdminConfigured: () => true,
  getFirebaseAdminApp: () => ({}),
}));
vi.mock("firebase-admin/messaging", () => ({
  getMessaging: () => ({ sendEachForMulticast: (...a: unknown[]) => sendEachForMulticast(...a) }),
}));
vi.mock("@/lib/push", () => ({ sendPushToUser: (...a: unknown[]) => webPush(...a) }));
vi.mock("@/lib/apns-voip", () => ({ sendVoipCallCancelToUser: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/hidden-chats", () => ({ getHiddenPeerIds: (...a: unknown[]) => hiddenPeerIds(...a) }));

import { notifyMissedCall } from "./missed-call";

type SentMessage = {
  tokens: string[];
  data: Record<string, string>;
  android: unknown;
  apns: {
    headers: Record<string, string>;
    payload: { aps: { alert?: { title: string; body: string }; threadId?: string; contentAvailable?: boolean } };
  };
};

function sent(): SentMessage[] {
  return sendEachForMulticast.mock.calls.map((c) => c[0] as SentMessage);
}

function withLocale(locale: Locale | null) {
  tokenFindMany.mockResolvedValue([
    { id: "t-ios", token: "ios-token", user: { locale } },
    { id: "t-android", token: "android-token", user: { locale } },
  ]);
}

describe("missed call on iOS", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    tokenFindMany.mockReset();
    sendEachForMulticast.mockReset().mockResolvedValue({ successCount: 2, failureCount: 0, responses: [] });
    notificationCreate.mockReset();
    webPush.mockReset();
    hiddenPeerIds.mockReset().mockResolvedValue([]);
  });

  it("sends one missed_call message whose APNs block is a visible alert opening the caller's profile", async () => {
    withLocale("en");
    await notifyMissedCall({ callId: "call1", callerId: "caller1", callerName: "Ada", calleeId: "me" });

    const missed = sent().filter((m) => m.data.type === "missed_call");
    // One message per missed call, to every device: never a silent copy plus an alert.
    expect(missed).toHaveLength(1);
    const [m] = missed;
    expect(m.tokens).toEqual(["ios-token", "android-token"]);
    // Android reads these data fields unchanged.
    expect(m.data).toEqual({ type: "missed_call", callId: "call1", callerName: "Ada", url: "/u/caller1" });
    expect(m.android).toEqual({ priority: "high" });
    expect(m.apns.headers).toEqual({
      "apns-priority": "10",
      "apns-push-type": "alert",
      "apns-collapse-id": "missed-call-caller1",
    });
    expect(m.apns.payload.aps).toEqual({
      alert: { title: "Missed call", body: "Ada called you" },
      threadId: "missed-call-caller1",
    });
    expect(m.apns.payload.aps.contentAvailable).toBeUndefined();
    // The web push and the bell row lead to the same place.
    const webPayload = (webPush.mock.calls[0][1] as (l: Locale) => { url: string; title: string; body: string })("en");
    expect(webPayload).toEqual({ title: "Missed call", body: "Ada called you", url: "/u/caller1" });
  });

  it("keeps the ring-clearing call_cancelled message silent on iOS", async () => {
    withLocale("en");
    await notifyMissedCall({ callId: "call1", callerId: "caller1", callerName: "Ada", calleeId: "me" });
    const cancel = sent().find((m) => m.data.type === "call_cancelled")!;
    expect(cancel.apns).toEqual({
      headers: { "apns-priority": "5", "apns-push-type": "background" },
      payload: { aps: { contentAvailable: true } },
    });
  });

  it.each(SUPPORTED_LOCALES)("words the alert in the recipient's language (%s)", async (locale) => {
    withLocale(locale);
    await notifyMissedCall({ callId: "call1", callerId: "caller1", callerName: "Ada", calleeId: "me" });
    const t = pushText(locale).call;
    const m = sent().find((s) => s.data.type === "missed_call")!;
    expect(m.apns.payload.aps.alert).toEqual({ title: t.missedTitle, body: format(t.missed, { name: "Ada" }) });
  });

  it("says Someone, in the recipient's language, for a caller with no name", async () => {
    withLocale("es");
    await notifyMissedCall({ callId: "call1", callerId: "caller1", callerName: null, calleeId: "me" });
    const m = sent().find((s) => s.data.type === "missed_call")!;
    expect(m.apns.payload.aps.alert?.body).toBe(format(pushText("es").call.missed, { name: pushText("es").someone }));
  });

  it("falls back to English for an unknown stored language", async () => {
    withLocale(null);
    await notifyMissedCall({ callId: "call1", callerId: "caller1", callerName: "Ada", calleeId: "me" });
    const m = sent().find((s) => s.data.type === "missed_call")!;
    expect(m.apns.payload.aps.alert?.title).toBe("Missed call");
  });

  it("sends no missed-call alert, web push or bell row when the callee hides their chat with the caller", async () => {
    withLocale("en");
    hiddenPeerIds.mockResolvedValue(["caller1"]);
    await notifyMissedCall({ callId: "call1", callerId: "caller1", callerName: "Ada", calleeId: "me" });
    // Only the silent ring-clear goes out, which names nobody.
    expect(sent().map((m) => m.data.type)).toEqual(["call_cancelled"]);
    expect(JSON.stringify(sent())).not.toContain("Ada");
    expect(webPush).not.toHaveBeenCalled();
    expect(notificationCreate).not.toHaveBeenCalled();
  });
});
