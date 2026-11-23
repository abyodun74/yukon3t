import { beforeEach, describe, expect, it, vi } from "vitest";
import { ALERT_NOTIFICATION_CHANNEL_ID } from "@/lib/alert-push";

// The phone push (FCM) must carry the notification's exact target as `data.url`: that is all the native app's tap
// handler (components/capacitor-bridge.tsx) has to navigate with. It must also be a real alert (Android heads-up
// channel, iOS sound), and the same activity must reach the person's browsers through Web Push.
const tokenFindMany = vi.fn();
const sendEachForMulticast = vi.fn();
const subscriptionFindMany = vi.fn();
const sendNotification = vi.fn();

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "public";
  process.env.VAPID_PRIVATE_KEY = "private";
});
vi.mock("@/lib/prisma", () => ({
  prisma: {
    fcmToken: {
      findMany: (...a: unknown[]) => tokenFindMany(...a),
      deleteMany: vi.fn().mockResolvedValue(undefined),
    },
    pushSubscription: {
      findMany: (...a: unknown[]) => subscriptionFindMany(...a),
      delete: vi.fn().mockResolvedValue(undefined),
    },
  },
}));
vi.mock("@/lib/firebase-admin", () => ({
  isFirebaseAdminConfigured: () => true,
  getFirebaseAdminApp: () => ({}),
}));
vi.mock("firebase-admin/messaging", () => ({
  getMessaging: () => ({ sendEachForMulticast: (...a: unknown[]) => sendEachForMulticast(...a) }),
}));
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: (...a: unknown[]) => sendNotification(...a),
  },
}));

import { pushActivityNotification, pushActivityNotificationToMany } from "./notify-push";

describe("phone push payload", () => {
  beforeEach(() => {
    tokenFindMany.mockReset();
    tokenFindMany.mockResolvedValue([{ id: "t1", token: "tok1", user: { locale: "en" } }]);
    sendEachForMulticast.mockReset();
    sendEachForMulticast.mockResolvedValue({ responses: [{ success: true }] });
    subscriptionFindMany.mockReset();
    subscriptionFindMany.mockResolvedValue([]);
    sendNotification.mockReset();
    sendNotification.mockResolvedValue(undefined);
  });

  it("puts the exact target in data.url for one recipient", async () => {
    await pushActivityNotification("u2", "POST_LIKE", "Ada", "/post/p1");
    const message = sendEachForMulticast.mock.calls[0][0];
    expect(message.tokens).toEqual(["tok1"]);
    expect(message.data).toEqual({ type: "POST_LIKE", url: "/post/p1" });
    expect(message.notification.title).toBe("Ada");
  });

  it("puts the exact target in data.url for many recipients", async () => {
    await pushActivityNotificationToMany(["u2", "u3"], "EVENT_RSVP_NUDGE", "Ada", "/post/p1");
    expect(sendEachForMulticast.mock.calls[0][0].data).toEqual({ type: "EVENT_RSVP_NUDGE", url: "/post/p1" });
  });

  it.each([
    ["one recipient", () => pushActivityNotification("u2", "CONNECTION_REQUEST", "Ada", "/connections")],
    ["many recipients", () => pushActivityNotificationToMany(["u2"], "CONNECTION_REQUEST", "Ada", "/connections")],
  ])("is a heads-up notification with sound on Android and iPhone (%s)", async (_label, send) => {
    await send();
    const message = sendEachForMulticast.mock.calls[0][0];
    expect(message.android.priority).toBe("high");
    expect(message.android.notification.channelId).toBe(ALERT_NOTIFICATION_CHANNEL_ID);
    expect(message.apns.payload.aps.sound).toBe("default");
    expect(message.apns.headers["apns-priority"]).toBe("10");
  });
});

describe("browser push", () => {
  beforeEach(() => {
    tokenFindMany.mockReset();
    tokenFindMany.mockResolvedValue([]);
    subscriptionFindMany.mockReset();
    subscriptionFindMany.mockResolvedValue([
      { id: "s1", endpoint: "https://push/1", p256dh: "p", auth: "a", user: { locale: "en" } },
    ]);
    sendNotification.mockReset();
    sendNotification.mockResolvedValue(undefined);
  });

  it("sends the same activity to the person's browsers, with the same target", async () => {
    await pushActivityNotification("u2", "POST_COMMENT", "Ada", "/post/p1");
    expect(subscriptionFindMany.mock.calls[0][0].where).toEqual({ userId: "u2" });
    const body = JSON.parse(sendNotification.mock.calls[0][1]);
    expect(body).toMatchObject({ title: "Ada", url: "/post/p1" });
    expect(typeof body.body).toBe("string");
    expect(body.body.length).toBeGreaterThan(0);
  });

  it("sends once per recipient group for many recipients", async () => {
    await pushActivityNotificationToMany(["u2", "u3"], "POLL_SCHEDULED", "Ada", "/circles/x");
    expect(subscriptionFindMany.mock.calls[0][0].where).toEqual({ userId: { in: ["u2", "u3"] } });
    expect(JSON.parse(sendNotification.mock.calls[0][1])).toMatchObject({ title: "Ada", url: "/circles/x" });
  });

  it("leaves out url when there is no target", async () => {
    await pushActivityNotification("u2", "POST_LIKE", null);
    expect(JSON.parse(sendNotification.mock.calls[0][1])).not.toHaveProperty("url");
  });
});

describe("phone and browser sends are independent", () => {
  beforeEach(() => {
    tokenFindMany.mockReset();
    subscriptionFindMany.mockReset();
    subscriptionFindMany.mockResolvedValue([
      { id: "s1", endpoint: "https://push/1", p256dh: "p", auth: "a", user: { locale: "en" } },
    ]);
    sendNotification.mockReset();
    sendNotification.mockResolvedValue(undefined);
  });

  it("still reaches the browser, and doesn't throw, when the phone token lookup fails", async () => {
    tokenFindMany.mockRejectedValue(new Error("pool timeout"));
    await expect(pushActivityNotification("u2", "POST_LIKE", "Ada", "/post/p1")).resolves.toBeUndefined();
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("doesn't throw when a browser send fails", async () => {
    tokenFindMany.mockResolvedValue([]);
    sendNotification.mockRejectedValue(Object.assign(new Error("gone"), { statusCode: 410 }));
    await expect(pushActivityNotificationToMany(["u2"], "POST_LIKE", "Ada")).resolves.toBeUndefined();
  });
});
