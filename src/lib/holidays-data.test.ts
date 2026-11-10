import { beforeEach, describe, expect, it, vi } from "vitest";

// The holiday-reminders run against a mocked database: who it reminds, what it writes and what it pushes.
const userGroupBy = vi.fn();
const userFindMany = vi.fn();
const reminderCreateManyAndReturn = vi.fn();
const notificationCreateMany = vi.fn();
const webPush = vi.fn();
const fcmToUsers = vi.fn();
const publishEvents = vi.fn();
const captureError = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      groupBy: (...a: unknown[]) => userGroupBy(...a),
      findMany: (...a: unknown[]) => userFindMany(...a),
    },
    holidayReminder: { createManyAndReturn: (...a: unknown[]) => reminderCreateManyAndReturn(...a) },
    notification: { createMany: (...a: unknown[]) => notificationCreateMany(...a) },
  },
}));
vi.mock("@/lib/push", () => ({ sendPushToUsers: (...a: unknown[]) => webPush(...a) }));
vi.mock("@/lib/fcm", () => ({ sendFcmActivityToUsers: (...a: unknown[]) => fcmToUsers(...a) }));
vi.mock("@/lib/realtime-server", () => ({ publishEvents: (...a: unknown[]) => publishEvents(...a) }));
vi.mock("@/lib/error-tracking", () => ({ captureError: (...a: unknown[]) => captureError(...a) }));

import { holidayRecipientWhere, sendHolidayReminders } from "./holidays-data";
import { decodeNotice } from "./notification-notice";
import { notificationHref, type NotificationData } from "./notification-href";
import { HOLIDAY_BATCH } from "./holidays";

// 07:30 UTC on Oct 1 2026: 08:30 in Lagos (Nigeria's Independence Day), 00:30 in Los Angeles (an ordinary day there).
const now = new Date("2026-10-01T07:30:00Z");

type Payload = (locale: "en" | "fr") => { title: string; body: string; url?: string; type?: string; silent?: boolean };

/** findMany answers: one page of `pages` per call for each (country, time zone), then nothing. */
function usersByGroup(pages: Record<string, { id: string; locale: string | null }[][]>) {
  userFindMany.mockImplementation(async (args: { where: { country: string; timeZone: string | null } }) => {
    const key = `${args.where.country}|${args.where.timeZone}`;
    return pages[key]?.shift() ?? [];
  });
}

/** createManyAndReturn inserts every row except those already recorded in `existing` ("user|key"). */
function insertAllExcept(existing: string[] = []) {
  reminderCreateManyAndReturn.mockImplementation(
    async (args: { data: { userId: string; holidayKey: string }[] }) =>
      args.data
        .filter((d) => !existing.includes(`${d.userId}|${d.holidayKey}`))
        .map((d) => ({ userId: d.userId, holidayKey: d.holidayKey })),
  );
}

describe("sendHolidayReminders", () => {
  beforeEach(() => {
    for (const fn of [userGroupBy, userFindMany, reminderCreateManyAndReturn, notificationCreateMany, webPush, fcmToUsers, publishEvents, captureError]) {
      fn.mockReset();
    }
  });

  it("reads nothing more than one GROUP BY when no group has a holiday due", async () => {
    userGroupBy.mockResolvedValue([
      { country: "Nigeria", timeZone: "Africa/Lagos" },
      { country: "United States", timeZone: "America/Los_Angeles" },
    ]);
    const result = await sendHolidayReminders(new Date("2026-10-02T12:00:00Z"));
    expect(result).toMatchObject({ groups: 2, dueGroups: 0, reminders: 0, pushes: 0 });
    expect(userFindMany).not.toHaveBeenCalled();
    expect(reminderCreateManyAndReturn).not.toHaveBeenCalled();
  });

  it("reminds a group on its holiday, from 08:00 local: one row per holiday, one bell row, one quiet push", async () => {
    userGroupBy.mockResolvedValue([
      { country: "Nigeria", timeZone: "Africa/Lagos" },
      // 00:30 in Los Angeles: nothing due there yet (and it isn't a US holiday anyway).
      { country: "United States", timeZone: "America/Los_Angeles" },
    ]);
    usersByGroup({ "Nigeria|Africa/Lagos": [[{ id: "ada", locale: "en" }, { id: "bayo", locale: "fr" }]] });
    insertAllExcept();

    const result = await sendHolidayReminders(now);
    expect(result).toMatchObject({ groups: 2, dueGroups: 1, reminders: 2, recipients: 2, pushes: 2, failed: 0 });

    // Only the due group is loaded, with every eligibility rule and the "not reminded yet" filter.
    const where = userFindMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      holidayReminders: true,
      status: "ACTIVE",
      isAdmin: false,
      isGuestPreview: false,
      country: "Nigeria",
      timeZone: "Africa/Lagos",
      holidayRemindersSent: { none: { year: 2026, holidayKey: { in: ["NG:independence-day"] } } },
    });
    expect(userFindMany.mock.calls[0][0].take).toBeLessThanOrEqual(HOLIDAY_BATCH);
    expect(userFindMany.mock.calls.every((c) => c[0].where.country === "Nigeria")).toBe(true);

    const insert = reminderCreateManyAndReturn.mock.calls[0][0];
    expect(insert.skipDuplicates).toBe(true);
    expect(insert.data).toEqual([
      { userId: "ada", holidayKey: "NG:independence-day", year: 2026, holidayDate: new Date(Date.UTC(2026, 9, 1)) },
      { userId: "bayo", holidayKey: "NG:independence-day", year: 2026, holidayDate: new Date(Date.UTC(2026, 9, 1)) },
    ]);

    const rows = notificationCreateMany.mock.calls[0][0].data as {
      recipientId: string;
      actorId: string;
      type: string;
      messageData: string;
      message: string;
    }[];
    expect(rows.map((r) => [r.recipientId, r.actorId, r.type])).toEqual([
      ["ada", "ada", "HOLIDAY_TODAY"],
      ["bayo", "bayo", "HOLIDAY_TODAY"],
    ]);
    expect(decodeNotice(rows[0].messageData)).toEqual({ kind: "holiday", holiday: "Independence Day", country: "Nigeria" });
    expect(decodeNotice(rows[1].messageData)).toMatchObject({ kind: "holiday", country: "Nigeria" });
    expect(rows[0].message).toBe("Today is Independence Day in Nigeria");

    // One push to both, worded per language, silent on the web and quiet on the phone, opening Home like the bell row.
    expect(webPush).toHaveBeenCalledTimes(1);
    expect(webPush.mock.calls[0][0]).toEqual(["ada", "bayo"]);
    const web = (webPush.mock.calls[0][1] as Payload)("en");
    expect(web).toEqual({
      title: "Independence Day",
      body: "Today is Independence Day in Nigeria",
      url: "/home",
      silent: true,
    });
    expect((webPush.mock.calls[0][1] as Payload)("fr").body).toContain("Nigeria");
    expect(fcmToUsers.mock.calls[0][2]).toEqual({ quiet: true });
    expect((fcmToUsers.mock.calls[0][1] as Payload)("en")).toMatchObject({ type: "HOLIDAY_TODAY", url: "/home" });
    const bellRow = {
      id: "n",
      type: "HOLIDAY_TODAY",
      recipientId: "ada",
      readAt: null,
      createdAt: now,
      actor: { id: "ada", name: null },
      message: null,
      messageData: rows[0].messageData,
      postId: null,
      circle: null,
      conversationId: null,
      collab: null,
      liveStreamId: null,
      channel: null,
      museId: null,
      storyId: null,
    } satisfies NotificationData;
    expect(notificationHref(bellRow)).toBe(web.url);
    expect(publishEvents).toHaveBeenCalledTimes(1);
  });

  it("is idempotent: rows already recorded (a repeated or overlapping run) send nothing", async () => {
    userGroupBy.mockResolvedValue([{ country: "Nigeria", timeZone: "Africa/Lagos" }]);
    usersByGroup({ "Nigeria|Africa/Lagos": [[{ id: "ada", locale: "en" }]] });
    insertAllExcept(["ada|NG:independence-day"]);

    const result = await sendHolidayReminders(now);
    expect(result).toMatchObject({ dueGroups: 1, reminders: 0, recipients: 0, pushes: 0 });
    expect(notificationCreateMany).not.toHaveBeenCalled();
    expect(webPush).not.toHaveBeenCalled();
    expect(fcmToUsers).not.toHaveBeenCalled();
  });

  it("notifies only the rows this run actually inserted", async () => {
    userGroupBy.mockResolvedValue([{ country: "Nigeria", timeZone: "Africa/Lagos" }]);
    usersByGroup({ "Nigeria|Africa/Lagos": [[{ id: "ada", locale: "en" }, { id: "bayo", locale: "en" }]] });
    insertAllExcept(["bayo|NG:independence-day"]);

    await sendHolidayReminders(now);
    expect(notificationCreateMany.mock.calls[0][0].data.map((r: { recipientId: string }) => r.recipientId)).toEqual(["ada"]);
    expect(webPush.mock.calls[0][0]).toEqual(["ada"]);
  });

  it("several holidays on one day: a bell row each, one push listing them", async () => {
    // May 27 2026 in Lagos: Children's Day and Id el Kabir.
    userGroupBy.mockResolvedValue([{ country: "Nigeria", timeZone: "Africa/Lagos" }]);
    usersByGroup({ "Nigeria|Africa/Lagos": [[{ id: "ada", locale: "en" }]] });
    insertAllExcept();

    const result = await sendHolidayReminders(new Date("2026-05-27T09:00:00Z"));
    expect(result.reminders).toBeGreaterThanOrEqual(2);
    expect(notificationCreateMany.mock.calls[0][0].data).toHaveLength(result.reminders);
    expect(webPush).toHaveBeenCalledTimes(1);
    const push = (webPush.mock.calls[0][1] as Payload)("en");
    expect(push.title).toBe("Holidays today");
    expect(push.body).toContain("Children's Day");
  });

  it("keeps going when one group fails", async () => {
    userGroupBy.mockResolvedValue([
      { country: "Nigeria", timeZone: "Africa/Lagos" },
      { country: "Nigeria", timeZone: null },
    ]);
    userFindMany.mockRejectedValueOnce(new Error("db down"));
    userFindMany.mockResolvedValueOnce([{ id: "chidi", locale: null }]).mockResolvedValue([]);
    insertAllExcept();

    // 08:30 UTC: 09:30 in Lagos, and 08:30 for the group with no known time zone (read as UTC), so both are due.
    const result = await sendHolidayReminders(new Date("2026-10-01T08:30:00Z"));
    expect(result).toMatchObject({ dueGroups: 2, failed: 1, reminders: 1 });
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(userFindMany.mock.calls[1][0].where).toMatchObject({ country: "Nigeria", timeZone: null });
  });

  it("a group with no known time zone waits for 08:00 UTC", async () => {
    userGroupBy.mockResolvedValue([{ country: "Nigeria", timeZone: null }]);
    const result = await sendHolidayReminders(now);
    expect(result.dueGroups).toBe(0);
    expect(userFindMany).not.toHaveBeenCalled();
  });
});

describe("holidayRecipientWhere", () => {
  it("is the opt-out switch plus active, non-admin, real accounts with a country, any age", () => {
    const where = holidayRecipientWhere(now);
    expect(where).toMatchObject({
      holidayReminders: true,
      status: "ACTIVE",
      isAdmin: false,
      isAppReviewDemo: false,
      isGuestPreview: false,
      country: { not: null },
    });
    expect(where).not.toHaveProperty("birthDate");
    expect((where.lastSeenAt as { gte: Date }).gte.getTime()).toBeLessThan(now.getTime());
  });
});
