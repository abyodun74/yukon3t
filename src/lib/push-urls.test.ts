import { beforeEach, describe, expect, it, vi } from "vitest";
import { notificationHref, type NotificationData } from "@/lib/notification-href";

// A push and the bell row it goes with must open the same place: the push's `url` is what a tap on the phone or in
// the browser opens (public/sw.js, components/capacitor-bridge.tsx), the row's notificationHref is what a tap in the
// app opens, and markReadByTarget matches one against the other. These senders build their own URL, so each is
// checked against the row it writes.
const webPush = vi.fn();
const fcmActivity = vi.fn();
const notificationCreate = vi.fn();
const fcmMissedCall = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: { notification: { create: (...a: unknown[]) => notificationCreate(...a) } },
}));
vi.mock("@/lib/push", () => ({ sendPushToUser: (...a: unknown[]) => webPush(...a) }));
vi.mock("@/lib/fcm", () => ({
  sendFcmActivityToUser: (...a: unknown[]) => fcmActivity(...a),
  sendFcmCallCancelToUser: vi.fn(),
  sendFcmMissedCallToUser: (...a: unknown[]) => fcmMissedCall(...a),
}));
vi.mock("@/lib/apns-voip", () => ({ sendVoipCallCancelToUser: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/hidden-chats", () => ({ getHiddenPeerIds: vi.fn().mockResolvedValue([]) }));

import { notifyMissedCall } from "./missed-call";
import { notifyVideoFlaggedForReview } from "./video-review-notice";

type Payload = (locale: "en") => { url?: string };

function rowFrom(createCall: unknown[]): NotificationData {
  const data = (createCall[0] as { data: Record<string, string | undefined> }).data;
  return {
    id: "n1",
    type: data.type as NotificationData["type"],
    recipientId: data.recipientId!,
    readAt: null,
    createdAt: new Date(),
    actor: { id: data.actorId!, name: null },
    message: null,
    postId: data.postId ?? null,
    circle: null,
    conversationId: data.conversationId ?? null,
    collab: null,
    liveStreamId: data.liveStreamId ?? null,
    channel: null,
    museId: data.museId ?? null,
    storyId: data.storyId ?? null,
  };
}

describe("push URL = bell row href", () => {
  beforeEach(() => {
    webPush.mockReset();
    fcmActivity.mockReset();
    notificationCreate.mockReset();
    fcmMissedCall.mockReset();
  });

  it("a missed call opens the caller's profile, from the web push and the native Android/iOS notification alike", async () => {
    await notifyMissedCall({ callId: "call1", callerId: "caller", callerName: "Ada", calleeId: "me" });
    const url = (webPush.mock.calls[0][1] as Payload)("en").url;
    expect(url).toBe("/u/caller");
    expect(notificationHref(rowFrom(notificationCreate.mock.calls[0]))).toBe(url);
    // sendFcmMissedCallToUser(userId, { callId, callerId, callerName, alert, url }): one FCM message for both
    // platforms (Android's data fields and iOS's alert both carry this url).
    expect(fcmMissedCall).toHaveBeenCalledTimes(1);
    expect(fcmMissedCall.mock.calls[0][0]).toBe("me");
    expect(fcmMissedCall.mock.calls[0][1]).toMatchObject({ callId: "call1", callerId: "caller", url });
  });

  it.each([
    [{ postId: "p1" }, "/post/p1"],
    [{ postId: "p1", commentId: "cm1" }, "/post/p1"],
    [{ museId: "m1" }, "/muse/m1"],
  ])("a video held for review (%o) opens the held content", async (target, expected) => {
    await notifyVideoFlaggedForReview("me", ["violence"], target);
    const webUrl = (webPush.mock.calls[0][1] as Payload)("en").url;
    const fcmUrl = (fcmActivity.mock.calls[0][1] as Payload)("en").url;
    expect(webUrl).toBe(expected);
    expect(fcmUrl).toBe(expected);
    expect(notificationHref(rowFrom(notificationCreate.mock.calls[0]))).toBe(expected);
  });
});
