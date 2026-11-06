import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { sendPushToUsers } from "@/lib/push";
import { sendFcmActivityToUsers } from "@/lib/fcm";
import { birthdayPush } from "@/lib/push-text";
import { publishEvents } from "@/lib/realtime-server";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";
import { captureError } from "@/lib/error-tracking";
import {
  BIRTHDAY_CIRCLE_CANDIDATES_MAX,
  BIRTHDAY_MAX_RECIPIENTS,
  BIRTHDAY_WISH_WINDOW_MS,
  BIRTHDAYS_HREF,
  birthdayCandidateMonthDays,
  birthdayRefusal,
  birthdayReminderKey,
  birthdayWishHref,
  dbDateKey,
  groupBirthdayPushes,
  localDateTime,
  localDateToDbDate,
  planBirthdayReminders,
  sharedCircleCounts,
  type BirthdayAudience,
  type BirthdayLink,
  type BirthdayPerson,
  type TodaysBirthday,
} from "@/lib/birthdays";

// The server half of birthday reminders (rules: src/lib/birthdays.ts): who is reminded of whose birthday, the
// birthday-reminders cron's run, and the /birthdays list. Never returns a birth date, year or age to anyone.

const PERSON_SELECT = { id: true, status: true, isGuestPreview: true, birthDate: true } as const;

export type BirthdayCelebrant = BirthdayPerson & { birthdayAudience: BirthdayAudience | null };

/** How each person in the celebrant's audience is linked to them, read from accepted connections and shared Circles. */
async function audienceLinks(celebrant: BirthdayCelebrant, onlyIds?: string[]): Promise<Map<string, BirthdayLink>> {
  const links = new Map<string, BirthdayLink>();
  const linkOf = (id: string) => {
    let link = links.get(id);
    if (!link) {
      link = { connected: false, sharesCircle: false };
      links.set(id, link);
    }
    return link;
  };
  const audience = celebrant.birthdayAudience;
  if (audience === "CONNECTIONS" || audience === "BOTH") {
    const rows = await prisma.connection.findMany({
      where: {
        status: "ACCEPTED",
        OR: [
          { requesterId: celebrant.id, ...(onlyIds ? { targetId: { in: onlyIds } } : {}) },
          { targetId: celebrant.id, ...(onlyIds ? { requesterId: { in: onlyIds } } : {}) },
        ],
      },
      select: { requesterId: true, targetId: true },
    });
    for (const row of rows) linkOf(row.requesterId === celebrant.id ? row.targetId : row.requesterId).connected = true;
  }
  if (audience === "CIRCLES" || audience === "BOTH") {
    // Fellow current members of any Circle the celebrant is in. Being a member is what lets them see its member list
    // (a PRIVATE Circle's is shown to its members only), so nobody hears of the birthday through a Circle they can't see.
    const rows = await prisma.circleMembership.findMany({
      where: {
        userId: onlyIds ? { in: onlyIds, not: celebrant.id } : { not: celebrant.id },
        circle: { members: { some: { userId: celebrant.id } } },
      },
      select: { userId: true, circle: { select: { visibility: true } } },
      take: BIRTHDAY_CIRCLE_CANDIDATES_MAX,
    });
    for (const row of rows) if (sharedCircleCounts(row.circle, true)) linkOf(row.userId).sharesCircle = true;
  }
  links.delete(celebrant.id);
  return links;
}

/**
 * The people who may be reminded of `celebrant`'s birthday (and so may wish them), each with their time zone:
 * birthdayRefusal for every person in the audience, with blocks (either way) and the recipient's own hidden 1:1 chat
 * with the celebrant looked up in one query each. At most BIRTHDAY_MAX_RECIPIENTS, most recently active first.
 * `onlyIds` narrows it to those people (a wish, the /birthdays list).
 */
export async function eligibleBirthdayRecipients(
  celebrant: BirthdayCelebrant,
  now: Date,
  onlyIds?: string[],
): Promise<{ id: string; timeZone: string | null }[]> {
  if (!celebrant.birthdayAudience) return [];
  const links = await audienceLinks(celebrant, onlyIds);
  const ids = [...links.keys()];
  if (ids.length === 0) return [];
  const [people, blocks, hiding] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: ids }, status: "ACTIVE", isGuestPreview: false, birthDate: { not: null } },
      select: { ...PERSON_SELECT, timeZone: true },
      orderBy: { lastSeenAt: { sort: "desc", nulls: "last" } },
      take: BIRTHDAY_MAX_RECIPIENTS,
    }),
    prisma.block.findMany({
      where: {
        OR: [
          { blockerId: celebrant.id, blockedId: { in: ids } },
          { blockerId: { in: ids }, blockedId: celebrant.id },
        ],
      },
      select: { blockerId: true, blockedId: true },
    }),
    prisma.conversationMember.findMany({
      where: {
        userId: { in: ids },
        hiddenAt: { not: null },
        conversation: { isGroup: false, members: { some: { userId: celebrant.id } } },
      },
      select: { userId: true },
    }),
  ]);
  const blocked = new Set(blocks.map((b) => (b.blockerId === celebrant.id ? b.blockedId : b.blockerId)));
  const hidden = new Set(hiding.map((h) => h.userId));
  return people
    .filter(
      (person) =>
        birthdayRefusal({
          celebrant,
          recipient: person,
          link: links.get(person.id)!,
          blocked: blocked.has(person.id),
          recipientHidesChat: hidden.has(person.id),
          date: localDateTime(now, person.timeZone),
        }) === null,
    )
    .map((person) => ({ id: person.id, timeZone: person.timeZone }));
}

/** Who has a birthday somewhere today and shares it: the cron's candidates (birthdayReminderDue decides per recipient). */
async function celebrantCandidateIds(now: Date): Promise<string[]> {
  const days = birthdayCandidateMonthDays(now);
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "User"
    WHERE "birthdayAudience" IS NOT NULL
      AND "birthDate" IS NOT NULL
      AND "status" = 'ACTIVE'
      AND "isGuestPreview" = false
      AND "isAdmin" = false
      AND (EXTRACT(MONTH FROM "birthDate")::int, EXTRACT(DAY FROM "birthDate")::int) IN (${Prisma.join(
        days.map((d) => Prisma.sql`(${d.month}::int, ${d.day}::int)`),
      )})`;
  return rows.map((r) => r.id);
}

/**
 * One run of the birthday-reminders cron (src/app/api/cron/birthday-reminders/route.ts, every 15 minutes). For every
 * person sharing a birthday that is today somewhere, every eligible recipient whose local morning of that day has
 * begun gets a BirthdayReminder row. Rows are inserted with skipDuplicates on the (celebrant, recipient, year) unique
 * key and only rows this run actually inserted get a BIRTHDAY_TODAY bell row and a push, so running twice (or two runs
 * overlapping) sends nothing twice. A recipient's birthdays of one day share one push; a later run that finds another
 * birthday for them the same day adds its bell row without pushing again.
 */
export async function sendBirthdayReminders(now = new Date()) {
  const ids = await celebrantCandidateIds(now);
  if (ids.length === 0) return { celebrants: 0, reminders: 0, pushes: 0, failed: 0 };
  const celebrants = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { ...PERSON_SELECT, name: true, birthdayAudience: true },
  });

  const planned: ReturnType<typeof planBirthdayReminders> = [];
  let failed = 0;
  const year = localDateTime(now, "UTC").year;
  for (const celebrant of celebrants) {
    if (!celebrant.birthDate || !celebrant.birthdayAudience) continue;
    // Isolated per celebrant: one failing lookup must not cost everyone else their reminders this run.
    try {
      const recipients = await eligibleBirthdayRecipients(celebrant, now);
      if (recipients.length === 0) continue;
      const sent = await prisma.birthdayReminder.findMany({
        where: { celebrantId: celebrant.id, year: { in: [year - 1, year, year + 1] } },
        select: { recipientId: true, year: true },
      });
      planned.push(
        ...planBirthdayReminders({
          celebrant: { id: celebrant.id, birthDate: celebrant.birthDate },
          recipients,
          alreadySent: new Set(sent.map((s) => birthdayReminderKey(celebrant.id, s.recipientId, s.year))),
          now,
        }),
      );
    } catch (err) {
      failed += 1;
      console.error(`[birthday-reminders] failed to plan for ${celebrant.id}`, err);
      await captureError(err, { route: "cron/birthday-reminders", celebrantId: celebrant.id });
    }
  }
  if (planned.length === 0) return { celebrants: celebrants.length, reminders: 0, pushes: 0, failed };

  const inserted = await prisma.birthdayReminder.createManyAndReturn({
    data: planned.map((p) => ({
      celebrantId: p.celebrantId,
      recipientId: p.recipientId,
      year: p.year,
      occasionDate: localDateToDbDate(p.occasionDate),
    })),
    skipDuplicates: true,
    select: { id: true, celebrantId: true, recipientId: true, occasionDate: true },
  });
  if (inserted.length === 0) return { celebrants: celebrants.length, reminders: 0, pushes: 0, failed };

  let pushes = 0;
  try {
    await prisma.notification.createMany({
      data: inserted.map((r) => ({ recipientId: r.recipientId, actorId: r.celebrantId, type: "BIRTHDAY_TODAY" as const })),
    });

    // Recipients who already had a reminder for the same day from an earlier run already had that day's push.
    const recipientIds = [...new Set(inserted.map((r) => r.recipientId))];
    const dates = [...new Map(inserted.map((r) => [dbDateKey(r.occasionDate), r.occasionDate])).values()];
    const earlier = await prisma.birthdayReminder.findMany({
      where: {
        id: { notIn: inserted.map((r) => r.id) },
        recipientId: { in: recipientIds },
        occasionDate: { in: dates },
      },
      select: { recipientId: true, occasionDate: true },
    });
    const pushedBefore = new Set(earlier.map((r) => `${r.recipientId}|${dbDateKey(r.occasionDate)}`));

    // Recipients told about the same birthdays get the same push: one send per distinct list.
    const sameList = new Map<string, { celebrantIds: string[]; recipientIds: string[] }>();
    for (const group of groupBirthdayPushes(inserted, pushedBefore)) {
      const key = group.celebrantIds.join(",");
      const entry = sameList.get(key);
      if (entry) entry.recipientIds.push(group.recipientId);
      else sameList.set(key, { celebrantIds: group.celebrantIds, recipientIds: [group.recipientId] });
    }
    const nameById = new Map(celebrants.map((c) => [c.id, c.name]));
    for (const { celebrantIds, recipientIds: to } of sameList.values()) {
      const url = celebrantIds.length === 1 ? birthdayWishHref(celebrantIds[0]) : BIRTHDAYS_HREF;
      const names = celebrantIds.map((id) => nameById.get(id) ?? null);
      await sendPushToUsers(to, (locale) => ({ ...birthdayPush(names, locale), url }));
      await sendFcmActivityToUsers(to, (locale) => ({ ...birthdayPush(names, locale), type: "BIRTHDAY_TODAY", url }));
      pushes += to.length;
    }
    await publishEvents(recipientIds.map((id) => ({ channel: REALTIME_CHANNELS.navBadges(id), event: "changed" })));
  } catch (err) {
    // The reminders are recorded, so nothing is retried: a fan-out failure only costs this run's notices.
    console.error("[birthday-reminders] fan-out failed", err);
    await captureError(err, { route: "cron/birthday-reminders", reminders: inserted.length });
    return { celebrants: celebrants.length, reminders: inserted.length, pushes, failed: failed + 1 };
  }
  return { celebrants: celebrants.length, reminders: inserted.length, pushes, failed };
}

/** The most recent reminder that still lets `recipientId` wish `celebrantId` (BIRTHDAY_WISH_WINDOW_MS), with its year. */
async function openReminder(celebrantId: string, recipientId: string, now: Date) {
  return prisma.birthdayReminder.findFirst({
    where: { celebrantId, recipientId, createdAt: { gte: new Date(now.getTime() - BIRTHDAY_WISH_WINDOW_MS) } },
    orderBy: { createdAt: "desc" },
    select: { year: true },
  });
}

const CELEBRANT_SELECT = {
  ...PERSON_SELECT,
  name: true,
  birthdayAudience: true,
  isAdmin: true,
  openToIntents: true,
} as const;

/**
 * Whether `senderId` may wish `celebrantId` a happy birthday right now: a reminder from the last
 * BIRTHDAY_WISH_WINDOW_MS, and every rule still holds today (still shared, still in the audience, no block either way,
 * both adult and active, the sender doesn't hide their chat with them). Null when not.
 */
export async function birthdayWishContext(senderId: string, celebrantId: string, now: Date) {
  const reminder = await openReminder(celebrantId, senderId, now);
  if (!reminder) return null;
  const celebrant = await prisma.user.findUnique({ where: { id: celebrantId }, select: CELEBRANT_SELECT });
  if (!celebrant || celebrant.isAdmin) return null;
  const eligible = await eligibleBirthdayRecipients(celebrant, now, [senderId]);
  if (!eligible.some((r) => r.id === senderId)) return null;
  return {
    year: reminder.year,
    celebrant: { id: celebrant.id, name: celebrant.name, openToIntents: celebrant.openToIntents },
  };
}

/**
 * The /birthdays list: the people whose birthday reminder the viewer got in the last BIRTHDAY_WISH_WINDOW_MS and may
 * still wish (birthdayWishContext's rules), with whether they already did this year. Only what the list shows: no
 * birth date of any kind.
 */
export async function loadTodaysBirthdays(viewerId: string, now = new Date()): Promise<TodaysBirthday[]> {
  const reminders = await prisma.birthdayReminder.findMany({
    where: { recipientId: viewerId, createdAt: { gte: new Date(now.getTime() - BIRTHDAY_WISH_WINDOW_MS) } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      year: true,
      celebrant: { select: { ...CELEBRANT_SELECT, username: true, avatarUrl: true } },
    },
  });
  if (reminders.length === 0) return [];
  const wishes = await prisma.birthdayWish.findMany({
    where: { senderId: viewerId, celebrantId: { in: reminders.map((r) => r.celebrant.id) } },
    select: { celebrantId: true, year: true },
  });
  const wished = new Set(wishes.map((w) => `${w.celebrantId}|${w.year}`));

  const list: TodaysBirthday[] = [];
  const seen = new Set<string>();
  for (const { year, celebrant } of reminders) {
    if (seen.has(celebrant.id) || celebrant.isAdmin) continue;
    seen.add(celebrant.id);
    const eligible = await eligibleBirthdayRecipients(celebrant, now, [viewerId]);
    if (!eligible.some((r) => r.id === viewerId)) continue;
    list.push({
      id: celebrant.id,
      name: celebrant.name,
      username: celebrant.username,
      avatarUrl: celebrant.avatarUrl,
      wished: wished.has(`${celebrant.id}|${year}`),
    });
  }
  return list;
}
