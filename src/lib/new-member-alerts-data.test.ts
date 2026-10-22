import { beforeEach, describe, expect, it, vi } from "vitest";

// The announce-new-members run against a mocked database: what it claims, writes and pushes.
const userFindMany = vi.fn();
const userUpdateMany = vi.fn();
const blockFindMany = vi.fn();
const notificationFindMany = vi.fn();
const notificationCreateMany = vi.fn();
const notificationUpdateMany = vi.fn();
const fcmToUsers = vi.fn();
const publishEvents = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findMany: (...a: unknown[]) => userFindMany(...a),
      updateMany: (...a: unknown[]) => userUpdateMany(...a),
    },
    block: { findMany: (...a: unknown[]) => blockFindMany(...a) },
    notification: {
      findMany: (...a: unknown[]) => notificationFindMany(...a),
      createMany: (...a: unknown[]) => notificationCreateMany(...a),
      updateMany: (...a: unknown[]) => notificationUpdateMany(...a),
    },
  },
}));
vi.mock("@/lib/fcm", () => ({ sendFcmActivityToUsers: (...a: unknown[]) => fcmToUsers(...a) }));
vi.mock("@/lib/realtime-server", () => ({ publishEvents: (...a: unknown[]) => publishEvents(...a) }));
vi.mock("@/lib/error-tracking", () => ({ captureError: vi.fn() }));

import { announceNewMembers } from "./new-member-alerts-data";
import { notificationHref, type NotificationData } from "@/lib/notification-href";

const now = new Date("2026-10-22T12:00:00Z");

type PushPayload = (locale: "en") => { title: string; body: string; type: string; url?: string };

function rowFor(data: { recipientId: string; actorId: string; messageData: string | null }): NotificationData {
  return {
    id: "n",
    type: "NEW_MEMBER_JOINED",
    recipientId: data.recipientId,
    readAt: null,
    createdAt: now,
    actor: { id: data.actorId, name: null },
    message: null,
    messageData: data.messageData,
    postId: null,
    circle: null,
    conversationId: null,
    collab: null,
    liveStreamId: null,
    channel: null,
    museId: null,
    storyId: null,
  };
}

describe("announceNewMembers", () => {
  beforeEach(() => {
    for (const fn of [
      userFindMany,
      userUpdateMany,
      blockFindMany,
      notificationFindMany,
      notificationCreateMany,
      notificationUpdateMany,
      fcmToUsers,
      publishEvents,
    ]) {
      fn.mockReset();
    }
    userUpdateMany.mockResolvedValue({ count: 1 });
    blockFindMany.mockResolvedValue([]);
    notificationFindMany.mockResolvedValue([]);
    notificationCreateMany.mockResolvedValue({ count: 0 });
    notificationUpdateMany.mockResolvedValue({ count: 0 });
  });

  it("does nothing at all when nobody new can be claimed", async () => {
    userFindMany.mockResolvedValueOnce([{ id: "m1", name: "Ada" }]);
    userUpdateMany.mockResolvedValueOnce({ count: 0 }); // another run claimed it
    expect(await announceNewMembers(now)).toEqual({ members: 0, rows: 0, pushes: 0 });
    expect(notificationCreateMany).not.toHaveBeenCalled();
    expect(fcmToUsers).not.toHaveBeenCalled();
  });

  it("claims the member once, writes a row and pushes the row's own link", async () => {
    userFindMany
      .mockResolvedValueOnce([{ id: "m1", name: "Ada" }]) // candidates
      .mockResolvedValueOnce([{ id: "r1", newMemberPushAt: null }]) // recipients
      .mockResolvedValueOnce([{ id: "r1" }]); // push claim
    const result = await announceNewMembers(now);
    expect(result).toEqual({ members: 1, rows: 1, pushes: 1 });

    expect(userUpdateMany.mock.calls[0][0]).toEqual({
      where: { id: "m1", newMemberAnnouncedAt: null },
      data: { newMemberAnnouncedAt: now },
    });
    const created = notificationCreateMany.mock.calls[0][0].data;
    expect(created).toEqual([{ recipientId: "r1", actorId: "m1", type: "NEW_MEMBER_JOINED", messageData: null }]);

    const [ids, payload] = fcmToUsers.mock.calls[0] as [string[], PushPayload];
    expect(ids).toEqual(["r1"]);
    expect(payload("en")).toEqual({
      title: "Ada",
      body: "just joined YuKon3t",
      type: "NEW_MEMBER_JOINED",
      url: "/u/m1",
    });
    expect(payload("en").url).toBe(notificationHref(rowFor(created[0])));
    expect(publishEvents).toHaveBeenCalledWith([{ channel: "nav-badges:r1", event: "changed" }]);
  });

  it("coalesces into the open row and skips the push inside the cooldown", async () => {
    userFindMany
      .mockResolvedValueOnce([
        { id: "m1", name: "Ada" },
        { id: "m2", name: "Bo" },
      ])
      .mockResolvedValueOnce([{ id: "r1", newMemberPushAt: new Date(now.getTime() - 60_000) }]);
    notificationFindMany.mockResolvedValueOnce([{ id: "row1", recipientId: "r1", messageData: null }]);
    const result = await announceNewMembers(now);
    expect(result).toEqual({ members: 2, rows: 1, pushes: 0 });
    expect(notificationCreateMany).not.toHaveBeenCalled();
    // The newest (last onboarded, m2) is named; the previous actor and m1 are counted.
    expect(notificationUpdateMany.mock.calls[0][0]).toEqual({
      where: { id: { in: ["row1"] }, readAt: null },
      data: { actorId: "m2", messageData: "new_members:2", createdAt: now },
    });
    expect(fcmToUsers).not.toHaveBeenCalled();
  });

  it("never tells someone about a member blocked either way", async () => {
    userFindMany
      .mockResolvedValueOnce([{ id: "m1", name: "Ada" }])
      .mockResolvedValueOnce([
        { id: "r1", newMemberPushAt: null },
        { id: "r2", newMemberPushAt: null },
      ])
      .mockResolvedValueOnce([{ id: "r2" }]);
    blockFindMany.mockResolvedValueOnce([{ blockerId: "r1", blockedId: "m1" }]);
    await announceNewMembers(now);
    expect(notificationCreateMany.mock.calls[0][0].data.map((d: { recipientId: string }) => d.recipientId)).toEqual([
      "r2",
    ]);
    expect(fcmToUsers.mock.calls[0][0]).toEqual(["r2"]);
  });

  it("a digest push opens Discover's newest people, like its row", async () => {
    userFindMany
      .mockResolvedValueOnce([
        { id: "m1", name: "Ada" },
        { id: "m2", name: "Bo" },
        { id: "m3", name: "Cy" },
      ])
      .mockResolvedValueOnce([{ id: "r1", newMemberPushAt: null }])
      .mockResolvedValueOnce([{ id: "r1" }]);
    await announceNewMembers(now);
    const created = notificationCreateMany.mock.calls[0][0].data[0];
    expect(created).toMatchObject({ actorId: "m3", messageData: "new_members:2" });
    const payload = (fcmToUsers.mock.calls[0][1] as PushPayload)("en");
    expect(payload).toMatchObject({ title: "Cy", body: "and 2 others just joined YuKon3t" });
    expect(payload.url).toBe("/discover?sort=recent");
    expect(payload.url).toBe(notificationHref(rowFor(created)));
  });
});
