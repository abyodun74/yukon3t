import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { sendPushToUsers } from "@/lib/push";
import { sendFcmActivityToUsers } from "@/lib/fcm";
import { holidayPush, noticeLine, storedLocale } from "@/lib/push-text";
import { publishEvents } from "@/lib/realtime-server";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";
import { captureError } from "@/lib/error-tracking";
import { encodeNotice, type Notice } from "@/lib/notification-notice";
import { HOLIDAY_HREF } from "@/lib/notification-href";
import { localDateToDbDate } from "@/lib/birthdays";
import type { Locale } from "@/lib/i18n/locales";
import {
  HOLIDAY_BATCH,
  HOLIDAY_MAX_PER_RUN,
  HOLIDAY_RECIPIENT_ACTIVE_MS,
  dueHolidays,
  holidayCountToday,
  holidayCountryLabel,
  holidayName,
  type DueHolidays,
  type Holiday,
} from "@/lib/holidays";

// The server half of public-holiday reminders (rules: src/lib/holidays.ts): the holiday-reminders cron's run.

/**
 * Who gets holiday reminders: the switch on (Settings -> Notifications, on by default), ACTIVE, a country on the
 * profile, seen in the app within HOLIDAY_RECIPIENT_ACTIVE_MS. Never a site admin, the App Review demo account or the
 * guest-preview identity. Any age: a holiday says nothing about the person.
 */
export function holidayRecipientWhere(now: Date): Prisma.UserWhereInput {
  return {
    holidayReminders: true,
    status: "ACTIVE",
    isAdmin: false,
    isAppReviewDemo: false,
    isGuestPreview: false,
    country: { not: null },
    lastSeenAt: { gte: new Date(now.getTime() - HOLIDAY_RECIPIENT_ACTIVE_MS) },
  };
}

/** A holiday's notice (bell row and push) for a recipient reading `locale`. */
function holidayNotice(country: string, cc: string, holiday: Holiday, locale: Locale): Notice {
  return { kind: "holiday", holiday: holidayName(cc, holiday, locale), country: holidayCountryLabel(country, locale) };
}

type GroupResult = { reminders: number; recipients: number; pushes: number };

/**
 * Reminds the recipients of one (country, time zone) group, who all have the same holidays today, up to `budget`
 * people. Pages through them (HOLIDAY_BATCH at a time) skipping anyone who already has a row for one of today's
 * holidays, so a page that another run claimed first is simply passed over.
 */
async function remindGroup(
  country: string,
  timeZone: string | null,
  due: DueHolidays,
  now: Date,
  budget: number,
): Promise<GroupResult> {
  const { cc, date, holidays } = due;
  const byKey = new Map(holidays.map((h) => [h.key, h]));
  const result: GroupResult = { reminders: 0, recipients: 0, pushes: 0 };
  let seen = 0;
  while (seen < budget) {
    const users = await prisma.user.findMany({
      where: {
        ...holidayRecipientWhere(now),
        country,
        timeZone,
        holidayRemindersSent: { none: { year: date.year, holidayKey: { in: [...byKey.keys()] } } },
      },
      select: { id: true, locale: true },
      orderBy: { id: "asc" },
      take: Math.min(HOLIDAY_BATCH, budget - seen),
    });
    if (users.length === 0) break;
    seen += users.length;

    // Idempotent: the (user, holiday, year) unique key decides, and only rows inserted here are notified.
    const inserted = await prisma.holidayReminder.createManyAndReturn({
      data: users.flatMap((u) =>
        holidays.map((h) => ({ userId: u.id, holidayKey: h.key, year: date.year, holidayDate: localDateToDbDate(date) })),
      ),
      skipDuplicates: true,
      select: { userId: true, holidayKey: true },
    });
    if (inserted.length === 0) continue;
    result.reminders += inserted.length;

    const localeOf = new Map(users.map((u) => [u.id, storedLocale(u.locale)]));
    const keysOf = new Map<string, string[]>();
    for (const row of inserted) keysOf.set(row.userId, [...(keysOf.get(row.userId) ?? []), row.holidayKey]);
    result.recipients += keysOf.size;

    try {
      await prisma.notification.createMany({
        data: inserted.map((row) => {
          const holiday = byKey.get(row.holidayKey)!;
          const notice = holidayNotice(country, cc, holiday, localeOf.get(row.userId) ?? "en");
          return {
            recipientId: row.userId,
            actorId: row.userId,
            type: "HOLIDAY_TODAY" as const,
            messageData: encodeNotice(notice),
            message: noticeLine(holidayNotice(country, cc, holiday, "en"), "en"),
          };
        }),
      });

      // One quiet push per recipient for the day, one send per distinct set of holidays (worded per language).
      const sameSet = new Map<string, { keys: string[]; ids: string[] }>();
      for (const [userId, keys] of keysOf) {
        const id = keys.join(",");
        const entry = sameSet.get(id);
        if (entry) entry.ids.push(userId);
        else sameSet.set(id, { keys, ids: [userId] });
      }
      for (const { keys, ids } of sameSet.values()) {
        const payload = (locale: Locale) =>
          holidayPush(
            keys.map((k) => holidayName(cc, byKey.get(k)!, locale)),
            holidayCountryLabel(country, locale),
            locale,
          );
        await sendPushToUsers(ids, (locale) => ({ ...payload(locale), url: HOLIDAY_HREF, silent: true }));
        await sendFcmActivityToUsers(ids, (locale) => ({ ...payload(locale), type: "HOLIDAY_TODAY", url: HOLIDAY_HREF }), {
          quiet: true,
        });
        result.pushes += ids.length;
      }
      await publishEvents([...keysOf.keys()].map((id) => ({ channel: REALTIME_CHANNELS.navBadges(id), event: "changed" })));
    } catch (err) {
      // The reminders are recorded, so nothing is retried: a fan-out failure only costs these notices.
      console.error("[holiday-reminders] fan-out failed", err);
      await captureError(err, { route: "cron/holiday-reminders", country, timeZone, reminders: inserted.length });
    }
  }
  return result;
}

/**
 * One run of the holiday-reminders cron (src/app/api/cron/holiday-reminders/route.ts, every 15 minutes). Recipients
 * are grouped by (country, time zone), one cheap GROUP BY; only groups for whom it is a holiday of their country and
 * already HOLIDAY_REMINDER_HOUR local time load anyone (a day with no holiday anywhere stops there). At most
 * HOLIDAY_MAX_PER_RUN people per run; the rest are reached by the next runs the same day. Each holiday is one
 * HOLIDAY_TODAY bell row, and each recipient one quiet push for the day; a repeated or overlapping run sends nothing
 * twice (HolidayReminder's unique key).
 */
export async function sendHolidayReminders(now = new Date()) {
  const groups = await prisma.user.groupBy({ by: ["country", "timeZone"], where: holidayRecipientWhere(now) });
  const due = groups.flatMap((g) => {
    const holidays = g.country ? dueHolidays(g.country, g.timeZone, now) : null;
    return holidays ? [{ country: g.country!, timeZone: g.timeZone, holidays }] : [];
  });
  const totals = { groups: groups.length, dueGroups: due.length, reminders: 0, recipients: 0, pushes: 0, failed: 0 };
  let budget = HOLIDAY_MAX_PER_RUN;
  for (const group of due) {
    if (budget <= 0) break;
    // Isolated per group: one failing group must not cost everyone else their reminders this run.
    try {
      const r = await remindGroup(group.country, group.timeZone, group.holidays, now, budget);
      budget -= r.recipients;
      totals.reminders += r.reminders;
      totals.recipients += r.recipients;
      totals.pushes += r.pushes;
    } catch (err) {
      totals.failed += 1;
      console.error(`[holiday-reminders] failed for ${group.country} / ${group.timeZone ?? "UTC"}`, err);
      await captureError(err, { route: "cron/holiday-reminders", country: group.country, timeZone: group.timeZone });
    }
  }
  return totals;
}

/**
 * For the gift occasion engine's server half (src/lib/gift-occasions-data.ts): the number of the recipient's own
 * country's holidays today on their calendar (holidayCountToday). Kept here so the dataset stays behind this module.
 */
export function holidaysTodayForGifts(country: string | null | undefined, timeZone: string | null | undefined, now: Date): number {
  try {
    return holidayCountToday(country, timeZone, now);
  } catch {
    return 0;
  }
}
