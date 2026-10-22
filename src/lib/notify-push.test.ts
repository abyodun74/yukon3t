import { beforeEach, describe, expect, it, vi } from "vitest";

// The phone push (FCM) must carry the notification's exact target as `data.url`: that is all the native app's tap
// handler (components/capacitor-bridge.tsx) has to navigate with.
const tokenFindMany = vi.fn();
const sendEachForMulticast = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    fcmToken: {
      findMany: (...a: unknown[]) => tokenFindMany(...a),
      deleteMany: vi.fn().mockResolvedValue(undefined),
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

import { pushActivityNotification, pushActivityNotificationToMany } from "./notify-push";

describe("phone push payload", () => {
  beforeEach(() => {
    tokenFindMany.mockReset();
    tokenFindMany.mockResolvedValue([{ id: "t1", token: "tok1", user: { locale: "en" } }]);
    sendEachForMulticast.mockReset();
    sendEachForMulticast.mockResolvedValue({ responses: [{ success: true }] });
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
});
