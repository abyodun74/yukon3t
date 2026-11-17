import { beforeEach, describe, expect, it, vi } from "vitest";

// The "What's new" push goes to every device: one lookup for all devices and their owners' languages, then one
// payload per language (that language's version of the announcement, else English). Never one query per user.
const tokenFindMany = vi.fn();
const subscriptionFindMany = vi.fn();
const sendEachForMulticast = vi.fn();
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
  default: { setVapidDetails: vi.fn(), sendNotification: (...a: unknown[]) => sendNotification(...a) },
}));

import { broadcastFcmAnnouncement } from "./fcm";
import { broadcastPushAnnouncement } from "./push";
import { announcementPushPayload } from "./announcement-translations";

const announcement = {
  title: "New: polls",
  body: "Add a poll to any post.",
  translations: [{ locale: "es", title: "Nuevo: encuestas", body: "Añade una encuesta a cualquier publicación." }],
};

describe("announcement broadcast by language", () => {
  beforeEach(() => {
    tokenFindMany.mockReset();
    subscriptionFindMany.mockReset();
    sendEachForMulticast.mockReset();
    sendEachForMulticast.mockImplementation(async (m: { tokens: string[] }) => ({
      responses: m.tokens.map(() => ({ success: true })),
    }));
    sendNotification.mockReset();
    sendNotification.mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("FCM: one token query, one multicast per language, Spanish for es and English for everyone else", async () => {
    tokenFindMany.mockResolvedValue([
      { id: "1", token: "es-1", user: { locale: "es" } },
      { id: "2", token: "en-1", user: { locale: "en" } },
      { id: "3", token: "es-2", user: { locale: "es" } },
      { id: "4", token: "fr-1", user: { locale: "fr" } },
      { id: "5", token: "none-1", user: { locale: null } },
    ]);
    await broadcastFcmAnnouncement(announcementPushPayload(announcement));

    expect(tokenFindMany).toHaveBeenCalledTimes(1);
    expect(tokenFindMany.mock.calls[0][0]).toMatchObject({ select: { user: { select: { locale: true } } } });
    const sends = sendEachForMulticast.mock.calls.map(([m]) => m as { tokens: string[]; notification: { title: string } });
    expect(sends.map((m) => [m.tokens, m.notification.title])).toEqual([
      [["es-1", "es-2"], "Nuevo: encuestas"],
      [["en-1", "none-1"], "New: polls"],
      [["fr-1"], "New: polls"],
    ]);
    for (const m of sendEachForMulticast.mock.calls) {
      expect(m[0].data).toEqual({ type: "ANNOUNCEMENT", url: "/whats-new" });
    }
  });

  it("web push: one subscription query, each subscription gets its owner's language", async () => {
    subscriptionFindMany.mockResolvedValue([
      { id: "s1", endpoint: "https://push/1", p256dh: "p", auth: "a", user: { locale: "es" } },
      { id: "s2", endpoint: "https://push/2", p256dh: "p", auth: "a", user: { locale: "de" } },
      { id: "s3", endpoint: "https://push/3", p256dh: "p", auth: "a", user: { locale: "es" } },
    ]);
    const text = announcementPushPayload(announcement);
    await broadcastPushAnnouncement((locale) => ({ ...text(locale), url: "/whats-new" }));

    expect(subscriptionFindMany).toHaveBeenCalledTimes(1);
    expect(subscriptionFindMany.mock.calls[0][0]).toMatchObject({ select: { user: { select: { locale: true } } } });
    const byEndpoint = Object.fromEntries(
      sendNotification.mock.calls.map(([sub, body]) => [(sub as { endpoint: string }).endpoint, JSON.parse(body as string)]),
    );
    expect(byEndpoint["https://push/1"]).toEqual({ title: "Nuevo: encuestas", body: announcement.translations[0].body, url: "/whats-new" });
    expect(byEndpoint["https://push/2"]).toEqual({ title: "New: polls", body: "Add a poll to any post.", url: "/whats-new" });
    expect(byEndpoint["https://push/3"]).toEqual(byEndpoint["https://push/1"]);
  });

  it("a failed device lookup never throws out of the broadcast", async () => {
    tokenFindMany.mockRejectedValue(new Error("pool timeout"));
    subscriptionFindMany.mockRejectedValue(new Error("pool timeout"));
    await expect(broadcastFcmAnnouncement(announcementPushPayload(announcement))).resolves.toBeUndefined();
    await expect(broadcastPushAnnouncement({ title: "x", body: "y" })).resolves.toBeUndefined();
    expect(sendEachForMulticast).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
