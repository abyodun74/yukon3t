import { beforeEach, describe, expect, it, vi } from "vitest";

// The birthday-reminders run against a mocked database: who it reminds, what it writes and what it pushes.
const queryRaw = vi.fn();
const userFindMany = vi.fn();
const connectionFindMany = vi.fn();
const membershipFindMany = vi.fn();
const blockFindMany = vi.fn();
const memberFindMany = vi.fn();
const reminderFindMany = vi.fn();
const reminderCreateManyAndReturn = vi.fn();
const notificationCreateMany = vi.fn();
const webPush = vi.fn();
const fcmToUsers = vi.fn();
const publishEvents = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: (...a: unknown[]) => queryRaw(...a),
    user: { findMany: (...a: unknown[]) => userFindMany(...a) },
    connection: { findMany: (...a: unknown[]) => connectionFindMany(...a) },
    circleMembership: { findMany: (...a: unknown[]) => membershipFindMany(...a) },
    block: { findMany: (...a: unknown[]) => blockFindMany(...a) },
    conversationMember: { findMany: (...a: unknown[]) => memberFindMany(...a) },
    birthdayReminder: {
      findMany: (...a: unknown[]) => reminderFindMany(...a),
      createManyAndReturn: (...a: unknown[]) => reminderCreateManyAndReturn(...a),
    },
    notification: { createMany: (...a: unknown[]) => notificationCreateMany(...a) },
  },
}));
vi.mock("@/lib/push", () => ({ sendPushToUsers: (...a: unknown[]) => webPush(...a) }));
vi.mock("@/lib/fcm", () => ({ sendFcmActivityToUsers: (...a: unknown[]) => fcmToUsers(...a) }));
vi.mock("@/lib/realtime-server", () => ({ publishEvents: (...a: unknown[]) => publishEvents(...a) }));
vi.mock("@/lib/error-tracking", () => ({ captureError: vi.fn() }));

import { sendBirthdayReminders } from "./birthdays-data";
import { notificationHref, type NotificationData } from "@/lib/notification-href";

// 10:00 UTC on Nov 7: morning in London and Lagos, still Nov 6 night in Los Angeles.
const now = new Date("2026-11-07T10:00:00Z");
const day = new Date("2026-11-07T00:00:00.000Z");
const adultBirth = new Date("1990-03-03T00:00:00.000Z");

type Payload = (locale: "en") => { title: string; body: string; url?: string; type?: string };

const person = (id: string, timeZone: string | null, birthDate: Date | null = adultBirth) => ({
  id,
  status: "ACTIVE",
  isGuestPreview: false,
  birthDate,
  timeZone,
});

const celebrant = (id: string, name: string, audience = "CONNECTIONS") => ({
  id,
  name,
  status: "ACTIVE",
  isGuestPreview: false,
  birthDate: new Date("1990-11-07T00:00:00.000Z"),
  birthdayAudience: audience,
});

function rowFor(data: { recipientId: string; actorId: string; type: string }): NotificationData {
  return {
    id: "n",
    type: data.type as NotificationData["type"],
    recipientId: data.recipientId,
    readAt: null,
    createdAt: now,
    actor: { id: data.actorId, name: null },
    message: null,
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

/** Recipients by celebrant: connection rows for each, and the people rows the recipient query returns. */
function world(input: {
  celebrants: ReturnType<typeof celebrant>[];
  connections: Record<string, string[]>;
  people: ReturnType<typeof person>[];
}) {
  queryRaw.mockResolvedValue(input.celebrants.map((c) => ({ id: c.id })));
  userFindMany.mockImplementation(async (args: { where: { id: { in: string[] } }; select: Record<string, unknown> }) => {
    if (args.select.birthdayAudience) return input.celebrants;
    return input.people.filter((p) => args.where.id.in.includes(p.id));
  });
  connectionFindMany.mockImplementation(async (args: { where: { OR: { requesterId?: string }[] } }) => {
    const celebrantId = args.where.OR[0].requesterId!;
    return (input.connections[celebrantId] ?? []).map((targetId) => ({ requesterId: celebrantId, targetId }));
  });
}

describe("sendBirthdayReminders", () => {
  beforeEach(() => {
    for (const fn of [
      queryRaw,
      userFindMany,
      connectionFindMany,
      membershipFindMany,
      blockFindMany,
      memberFindMany,
      reminderFindMany,
      reminderCreateManyAndReturn,
      notificationCreateMany,
      webPush,
      fcmToUsers,
      publishEvents,
    ]) {
      fn.mockReset();
    }
    membershipFindMany.mockResolvedValue([]);
    blockFindMany.mockResolvedValue([]);
    memberFindMany.mockResolvedValue([]);
    reminderFindMany.mockResolvedValue([]);
    notificationCreateMany.mockResolvedValue({ count: 0 });
    reminderCreateManyAndReturn.mockImplementation(async (args: { data: { celebrantId: string; recipientId: string }[] }) =>
      args.data.map((d, i) => ({ id: `rem${i}`, celebrantId: d.celebrantId, recipientId: d.recipientId, occasionDate: day })),
    );
  });

  it("does nothing when nobody shares a birthday today", async () => {
    queryRaw.mockResolvedValue([]);
    expect(await sendBirthdayReminders(now)).toEqual({ celebrants: 0, reminders: 0, pushes: 0, failed: 0 });
    expect(reminderCreateManyAndReturn).not.toHaveBeenCalled();
  });

  it("reminds eligible recipients in their morning only: not blocked, not hiding the chat, adult, already 9:00 there", async () => {
    world({
      celebrants: [celebrant("ada", "Ada")],
      connections: { ada: ["r-ok", "r-blocked", "r-hides", "r-minor", "r-la"] },
      people: [
        person("r-ok", "Europe/London"),
        person("r-blocked", "UTC"),
        person("r-hides", "UTC"),
        person("r-minor", "UTC", new Date("2010-01-01T00:00:00.000Z")),
        person("r-la", "America/Los_Angeles"),
      ],
    });
    blockFindMany.mockResolvedValue([{ blockerId: "r-blocked", blockedId: "ada" }]);
    memberFindMany.mockResolvedValue([{ userId: "r-hides" }]);

    const result = await sendBirthdayReminders(now);

    const data = reminderCreateManyAndReturn.mock.calls[0][0];
    expect(data.skipDuplicates).toBe(true);
    expect(data.data).toEqual([{ celebrantId: "ada", recipientId: "r-ok", year: 2026, occasionDate: day }]);
    expect(notificationCreateMany).toHaveBeenCalledWith({
      data: [{ recipientId: "r-ok", actorId: "ada", type: "BIRTHDAY_TODAY" }],
    });
    // The push names the person and opens the same place as the bell row: that person's quick-wish sheet.
    expect(webPush).toHaveBeenCalledTimes(1);
    const [to, payload] = webPush.mock.calls[0] as [string[], Payload];
    expect(to).toEqual(["r-ok"]);
    expect(payload("en")).toEqual({ title: "Ada", body: "has a birthday today", url: "/birthdays?wish=ada" });
    expect(payload("en").url).toBe(notificationHref(rowFor({ recipientId: "r-ok", actorId: "ada", type: "BIRTHDAY_TODAY" })));
    const [, fcmPayload] = fcmToUsers.mock.calls[0] as [string[], Payload];
    expect(fcmPayload("en")).toMatchObject({ type: "BIRTHDAY_TODAY", url: "/birthdays?wish=ada" });
    expect(result).toEqual({ celebrants: 1, reminders: 1, pushes: 1, failed: 0 });
  });

  it("never exposes the year: the push and the row carry only the person and 'today'", async () => {
    world({ celebrants: [celebrant("ada", "Ada")], connections: { ada: ["r1"] }, people: [person("r1", "UTC")] });
    await sendBirthdayReminders(now);
    const [, payload] = webPush.mock.calls[0] as [string[], Payload];
    expect(JSON.stringify(payload("en"))).not.toMatch(/1990|36/);
    // The bell row is the person and the type, with no message or data of any kind.
    expect(notificationCreateMany.mock.calls[0][0].data).toEqual([{ recipientId: "r1", actorId: "ada", type: "BIRTHDAY_TODAY" }]);
  });

  it("is idempotent: a second run that inserts nothing writes no bell rows and sends no push", async () => {
    world({ celebrants: [celebrant("ada", "Ada")], connections: { ada: ["r1"] }, people: [person("r1", "UTC")] });
    // The database already has the (ada, r1, 2026) row: skipDuplicates inserts nothing.
    reminderCreateManyAndReturn.mockResolvedValue([]);
    expect(await sendBirthdayReminders(now)).toEqual({ celebrants: 1, reminders: 0, pushes: 0, failed: 0 });
    expect(notificationCreateMany).not.toHaveBeenCalled();
    expect(webPush).not.toHaveBeenCalled();
    expect(fcmToUsers).not.toHaveBeenCalled();
  });

  it("skips planning anyone already reminded this year", async () => {
    world({ celebrants: [celebrant("ada", "Ada")], connections: { ada: ["r1", "r2"] }, people: [person("r1", "UTC"), person("r2", "UTC")] });
    reminderFindMany.mockImplementation(async (args: { where: { celebrantId?: string } }) =>
      args.where.celebrantId ? [{ recipientId: "r1", year: 2026 }] : [],
    );
    await sendBirthdayReminders(now);
    expect(reminderCreateManyAndReturn.mock.calls[0][0].data.map((d: { recipientId: string }) => d.recipientId)).toEqual(["r2"]);
  });

  it("groups several birthdays on the same day into one push, with one bell row per birthday", async () => {
    world({
      celebrants: [celebrant("ada", "Ada"), celebrant("bo", "Bo"), celebrant("cy", "Cy")],
      connections: { ada: ["r1"], bo: ["r1"], cy: ["r1", "r2"] },
      people: [person("r1", "UTC"), person("r2", "UTC")],
    });

    await sendBirthdayReminders(now);

    expect(notificationCreateMany.mock.calls[0][0].data).toHaveLength(4);
    expect(webPush).toHaveBeenCalledTimes(2);
    const pushes = webPush.mock.calls.map(([to, payload]) => ({ to, ...(payload as Payload)("en") }));
    expect(pushes).toContainEqual({
      to: ["r1"],
      title: "Birthdays today",
      body: "Ada and 2 others have birthdays today",
      url: "/birthdays",
    });
    expect(pushes).toContainEqual({ to: ["r2"], title: "Cy", body: "has a birthday today", url: "/birthdays?wish=cy" });
  });

  it("adds the bell row for a birthday found later the same day without pushing that recipient again", async () => {
    world({ celebrants: [celebrant("late", "Late")], connections: { late: ["r1", "r2"] }, people: [person("r1", "UTC"), person("r2", "UTC")] });
    // r1 already had a reminder for Nov 7 from an earlier run (so already had today's push).
    reminderFindMany.mockImplementation(async (args: { where: { celebrantId?: string } }) =>
      args.where.celebrantId ? [] : [{ recipientId: "r1", occasionDate: day }],
    );
    await sendBirthdayReminders(now);
    expect(notificationCreateMany.mock.calls[0][0].data).toHaveLength(2);
    expect(webPush).toHaveBeenCalledTimes(1);
    expect(webPush.mock.calls[0][0]).toEqual(["r2"]);
  });

  it("reminds fellow Circle members only when the person chose Circles", async () => {
    world({ celebrants: [celebrant("ada", "Ada", "CIRCLES")], connections: { ada: ["r-connection"] }, people: [person("r-member", "UTC"), person("r-connection", "UTC")] });
    membershipFindMany.mockResolvedValue([{ userId: "r-member", circle: { visibility: "PRIVATE" } }]);
    await sendBirthdayReminders(now);
    expect(connectionFindMany).not.toHaveBeenCalled();
    expect(reminderCreateManyAndReturn.mock.calls[0][0].data.map((d: { recipientId: string }) => d.recipientId)).toEqual(["r-member"]);
    // Only members of the celebrant's own Circles are looked at.
    expect(membershipFindMany.mock.calls[0][0].where.circle).toEqual({ members: { some: { userId: "ada" } } });
  });
});
