import { beforeEach, describe, expect, it, vi } from "vitest";

const subscriptionFindMany = vi.fn();
const subscriptionDelete = vi.fn();
const sendNotification = vi.fn();

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "public";
  process.env.VAPID_PRIVATE_KEY = "private";
});
vi.mock("@/lib/prisma", () => ({
  prisma: {
    pushSubscription: {
      findMany: (...a: unknown[]) => subscriptionFindMany(...a),
      delete: (...a: unknown[]) => subscriptionDelete(...a),
    },
  },
}));
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: (...a: unknown[]) => sendNotification(...a),
  },
}));

import { sendPushToUser, sendPushToUsers } from "./push";

const payload = { title: "Ada", body: "hi", url: "/messages/c1" };

function subs(count: number) {
  return Array.from({ length: count }, (_, i) => ({ id: `s${i}`, endpoint: `https://push/${i}`, p256dh: "p", auth: "a" }));
}

describe("sendPushToUsers", () => {
  beforeEach(() => {
    subscriptionFindMany.mockReset();
    subscriptionDelete.mockReset();
    subscriptionDelete.mockResolvedValue(undefined);
    sendNotification.mockReset();
    sendNotification.mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("looks every recipient's subscriptions up in one query and sends to each", async () => {
    subscriptionFindMany.mockResolvedValue(subs(3));
    await sendPushToUsers(["u1", "u2"], payload);

    expect(subscriptionFindMany).toHaveBeenCalledTimes(1);
    expect(subscriptionFindMany).toHaveBeenCalledWith({ where: { userId: { in: ["u1", "u2"] } } });
    expect(sendNotification).toHaveBeenCalledTimes(3);
    expect(sendNotification.mock.calls[0][1]).toBe(JSON.stringify(payload));
  });

  it("never runs more than 50 sends at once", async () => {
    subscriptionFindMany.mockResolvedValue(subs(120));
    let inFlight = 0;
    let peak = 0;
    sendNotification.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight--;
    });
    await sendPushToUsers(["u1"], payload);

    expect(sendNotification).toHaveBeenCalledTimes(120);
    expect(peak).toBe(50);
  });

  it("prunes only subscriptions the push service reports gone", async () => {
    subscriptionFindMany.mockResolvedValue(subs(3));
    sendNotification
      .mockRejectedValueOnce({ statusCode: 410 })
      .mockRejectedValueOnce({ statusCode: 500 })
      .mockResolvedValueOnce(undefined);
    await sendPushToUsers(["u1"], payload);

    expect(subscriptionDelete).toHaveBeenCalledTimes(1);
    expect(subscriptionDelete).toHaveBeenCalledWith({ where: { id: "s0" } });
  });

  it("skips the query entirely with no recipients", async () => {
    await sendPushToUsers([], payload);
    expect(subscriptionFindMany).not.toHaveBeenCalled();
  });

  it("does not throw when the subscription query fails", async () => {
    subscriptionFindMany.mockRejectedValue(new Error("pool timeout"));

    await expect(sendPushToUsers(["u1"], payload)).resolves.toBeUndefined();
    await expect(sendPushToUser("u1", payload)).resolves.toBeUndefined();
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
