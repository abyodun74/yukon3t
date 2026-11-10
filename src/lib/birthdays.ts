import { canSeeCircleContent } from "@/lib/circle-visibility";

// Birthday reminders and wishes. Pure rules here (dates, time zones, who may be reminded, grouping), unit-tested and
// client-safe; the server half is birthdays-data.ts (the birthday-reminders cron, the /birthdays list) and
// birthday-wish-server.ts (sendBirthdayWish).
//
// Sharing is on by default (User.birthdayAudience BOTH: connections and Circles) with an explicit opt-out (NONE), and
// only ever takes effect for adults. Nothing here or anywhere else ever puts the birth year or an age in front of
// anyone: a reminder says "today", nothing more.

/** Nobody younger can share their birthday, be reminded of one, or send a wish. */
export const BIRTHDAY_MIN_AGE = 18;
/** Most people reminded of one birthday, most recently active first. Same cap as the other bulk fan-outs. */
export const BIRTHDAY_MAX_RECIPIENTS = 500;
/** Most fellow Circle members looked at for one birthday before the recipient filters run. */
export const BIRTHDAY_CIRCLE_CANDIDATES_MAX = 5000;
/** A reminder lets its recipient send a wish for this long after it was sent (it covers every time zone's "today"). */
export const BIRTHDAY_WISH_WINDOW_MS = 36 * 60 * 60_000;
/** Longest custom wish. */
export const BIRTHDAY_WISH_TEXT_MAX = 280;
/** The quick-wish sheet's reactions. Sent as the message itself, so the chat shows them large. */
export const BIRTHDAY_EMOJIS = ["🎂", "🎉", "🥳", "🎁", "🎈", "💐"] as const;
/** The quick-wish sheet's ready-made messages, worded in the sender's language (ui.birthdays.presets). */
export const BIRTHDAY_PRESET_IDS = ["happyBirthday", "wonderfulYear", "celebrateYou", "bestWishes"] as const;
export type BirthdayPresetId = (typeof BIRTHDAY_PRESET_IDS)[number];

/** Who is reminded: the three ways of sharing, and NONE (the person turned it off in Settings). */
export const BIRTHDAY_AUDIENCE_VALUES = ["CONNECTIONS", "CIRCLES", "BOTH", "NONE"] as const;
export type BirthdayAudience = (typeof BIRTHDAY_AUDIENCE_VALUES)[number];
/** Every account starts with this (the column's database default); NONE is only ever an explicit choice. */
export const BIRTHDAY_DEFAULT_AUDIENCE: BirthdayAudience = "BOTH";

/** Whether this choice shares the birthday with anyone (it still only takes effect for an adult, see canShareBirthday). */
export function isSharingBirthday(audience: BirthdayAudience): boolean {
  return audience === "CONNECTIONS" || audience === "CIRCLES" || audience === "BOTH";
}

/** A calendar date in someone's own time zone. Months are 1-12. */
export type LocalDate = { year: number; month: number; day: number };

// ---------- Dates and time zones ----------

/** An IANA time zone this runtime knows, as the browser reports it (Intl.DateTimeFormat().resolvedOptions().timeZone). */
export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The date and hour at `now` in `timeZone`. No (or an unknown) time zone reads as UTC. */
export function localDateTime(now: Date, timeZone: string | null | undefined): LocalDate & { hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: isValidTimeZone(timeZone) ? timeZone : "UTC",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  return { year: part("year"), month: part("month"), day: part("day"), hour: part("hour") % 24 };
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** The day and month of a birth date. Birth dates are stored as UTC midnight of the date entered (BirthDateSelect). */
export function birthMonthDay(birthDate: Date): { month: number; day: number } {
  return { month: birthDate.getUTCMonth() + 1, day: birthDate.getUTCDate() };
}

/** The day a birthday is celebrated in `year`: a Feb 29 birthday is on Feb 28 in a year without one. */
export function celebrationDay(month: number, day: number, year: number): { month: number; day: number } {
  return month === 2 && day === 29 && !isLeapYear(year) ? { month: 2, day: 28 } : { month, day };
}

export function isBirthdayOn(birthDate: Date, date: LocalDate): boolean {
  const birth = birthMonthDay(birthDate);
  const celebrated = celebrationDay(birth.month, birth.day, date.year);
  return celebrated.month === date.month && celebrated.day === date.day;
}

/** Age on `date`, counting a Feb 29 birthday as passed on Feb 28 of a non-leap year (the day it is celebrated). */
export function ageOn(birthDate: Date, date: LocalDate): number {
  const birth = birthMonthDay(birthDate);
  const celebrated = celebrationDay(birth.month, birth.day, date.year);
  const passed = date.month > celebrated.month || (date.month === celebrated.month && date.day >= celebrated.day);
  return date.year - birthDate.getUTCFullYear() - (passed ? 0 : 1);
}

export function isAdultOn(birthDate: Date | null | undefined, date: LocalDate): boolean {
  return Boolean(birthDate) && ageOn(birthDate!, date) >= BIRTHDAY_MIN_AGE;
}

/** Whether this person's birthday can be shared now: a known birth date, and an adult today. */
export function canShareBirthday(birthDate: Date | null | undefined, now: Date): boolean {
  return isAdultOn(birthDate, localDateTime(now, "UTC"));
}

/**
 * The reminder for someone born on `birthDate`, if one is due at `now` for a recipient in `recipientTimeZone`: it is
 * their birthday on the recipient's local calendar. That is due from the first instant of the recipient's local day
 * (midnight, or whenever that day actually begins where a DST change skips midnight) until the day ends, so the first
 * 15-minute cron run of the day sends it and any later run that day still sends a missed one. It is a pure "what is
 * today's date there" check, never an hour comparison, so a skipped or repeated local hour can't make it miss or fire
 * twice; `year` (the recipient's local year) is the idempotency key's year, and BirthdayReminder's unique (celebrant,
 * recipient, year) is what stops a second send. No (or an unknown) time zone reads as UTC.
 */
export function birthdayReminderDue(
  birthDate: Date,
  now: Date,
  recipientTimeZone: string | null | undefined,
): { year: number; occasionDate: LocalDate } | null {
  const local = localDateTime(now, recipientTimeZone);
  if (!isBirthdayOn(birthDate, local)) return null;
  return { year: local.year, occasionDate: { year: local.year, month: local.month, day: local.day } };
}

/**
 * Every (month, day) of birth whose birthday is today somewhere on Earth at `now` (UTC-12 to UTC+14), including Feb 29
 * on a Feb 28 of a non-leap year. The cron's database prefilter; birthdayReminderDue decides per recipient.
 */
export function birthdayCandidateMonthDays(now: Date): { month: number; day: number }[] {
  const seen = new Map<string, { month: number; day: number }>();
  for (const offsetHours of [-12, 0, 14]) {
    const date = localDateTime(new Date(now.getTime() + offsetHours * 60 * 60_000), "UTC");
    const add = (month: number, day: number) => seen.set(`${month}-${day}`, { month, day });
    add(date.month, date.day);
    if (date.month === 2 && date.day === 28 && !isLeapYear(date.year)) add(2, 29);
  }
  return [...seen.values()];
}

/** A LocalDate as the UTC-midnight Date Prisma stores in a `@db.Date` column, and back. */
export function localDateToDbDate(date: LocalDate): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day));
}

export function dbDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// ---------- Who may be reminded ----------

/** What the rules need to know about any person involved: their account, and for the age check their birth date. */
export type BirthdayPerson = {
  id: string;
  status: string;
  isGuestPreview: boolean;
  birthDate: Date | null;
};

/** An ACTIVE, real (not the shared guest identity), adult account. Suspended, banned, deactivated: no. */
export function isBirthdayParticipant(person: BirthdayPerson, date: LocalDate): boolean {
  return person.status === "ACTIVE" && !person.isGuestPreview && isAdultOn(person.birthDate, date);
}

/** How a recipient is linked to the person whose birthday it is. */
export type BirthdayLink = {
  /** An ACCEPTED connection, either direction. */
  connected: boolean;
  /** Both are current members of at least one Circle in which the recipient can see the member list. */
  sharesCircle: boolean;
};

/**
 * Whether a shared Circle counts: being in the same Circle only links two people where the recipient can see its
 * member list (canSeeCircleContent). For a PRIVATE Circle that is its members, so a fellow member qualifies, and
 * nobody outside it ever learns of the birthday through it.
 */
export function sharedCircleCounts(circle: { visibility: string }, recipientIsMember: boolean): boolean {
  return recipientIsMember && canSeeCircleContent(circle, recipientIsMember);
}

export function audienceAllows(audience: BirthdayAudience, link: BirthdayLink): boolean {
  if (audience === "CONNECTIONS") return link.connected;
  if (audience === "CIRCLES") return link.sharesCircle;
  if (audience === "BOTH") return link.connected || link.sharesCircle;
  return false;
}

export type BirthdayRefusal = "self" | "not_sharing" | "ineligible" | "not_in_audience" | "blocked" | "hidden";

/**
 * Why `recipient` may not be reminded of (or wish) `celebrant` a happy birthday on `date`, or null if they may. The
 * same rule for the cron, the /birthdays list and sendBirthdayWish. `blocked` is a block in either direction;
 * `recipientHidesChat` means the recipient has hidden their 1:1 chat with the celebrant (hidden-chat peers are kept
 * out of every list of people the recipient sees).
 */
export function birthdayRefusal(input: {
  celebrant: BirthdayPerson & { birthdayAudience: BirthdayAudience };
  recipient: BirthdayPerson;
  link: BirthdayLink;
  blocked: boolean;
  recipientHidesChat: boolean;
  date: LocalDate;
}): BirthdayRefusal | null {
  const { celebrant, recipient } = input;
  if (celebrant.id === recipient.id) return "self";
  if (!isSharingBirthday(celebrant.birthdayAudience) || !celebrant.birthDate) return "not_sharing";
  if (!isBirthdayParticipant(celebrant, input.date) || !isBirthdayParticipant(recipient, input.date)) return "ineligible";
  if (input.blocked) return "blocked";
  if (input.recipientHidesChat) return "hidden";
  if (!audienceAllows(celebrant.birthdayAudience, input.link)) return "not_in_audience";
  return null;
}

// ---------- One cron run ----------

export type PlannedBirthdayReminder = { celebrantId: string; recipientId: string; year: number; occasionDate: LocalDate };

/** The idempotency key of a reminder (BirthdayReminder's unique celebrant + recipient + year). */
export function birthdayReminderKey(celebrantId: string, recipientId: string, year: number): string {
  return `${celebrantId}|${recipientId}|${year}`;
}

/**
 * The reminders due at `now` for one celebrant, among recipients already cleared by birthdayRefusal: one per recipient
 * for whom it is already the birthday (their local midnight has passed). Anyone already reminded this year (`alreadySent` keys) is skipped;
 * the database's unique key is still what guarantees it when two runs overlap.
 */
export function planBirthdayReminders(input: {
  celebrant: { id: string; birthDate: Date };
  recipients: { id: string; timeZone: string | null }[];
  alreadySent?: Set<string>;
  now: Date;
}): PlannedBirthdayReminder[] {
  const planned: PlannedBirthdayReminder[] = [];
  for (const recipient of input.recipients) {
    const due = birthdayReminderDue(input.celebrant.birthDate, input.now, recipient.timeZone);
    if (!due) continue;
    if (input.alreadySent?.has(birthdayReminderKey(input.celebrant.id, recipient.id, due.year))) continue;
    planned.push({ celebrantId: input.celebrant.id, recipientId: recipient.id, year: due.year, occasionDate: due.occasionDate });
  }
  return planned;
}

/**
 * One push per recipient per day, however many birthdays: `inserted` are the reminders this run actually wrote;
 * `pushedBefore` holds "recipientId|YYYY-MM-DD" for recipients who already had a reminder for that day from an
 * earlier run (and so already had their push). Celebrants keep the order they were given in.
 */
export function groupBirthdayPushes(
  inserted: { celebrantId: string; recipientId: string; occasionDate: Date }[],
  pushedBefore: Set<string>,
): { recipientId: string; celebrantIds: string[] }[] {
  const byRecipient = new Map<string, string[]>();
  for (const row of inserted) {
    if (pushedBefore.has(`${row.recipientId}|${dbDateKey(row.occasionDate)}`)) continue;
    const list = byRecipient.get(row.recipientId);
    if (list) {
      if (!list.includes(row.celebrantId)) list.push(row.celebrantId);
    } else {
      byRecipient.set(row.recipientId, [row.celebrantId]);
    }
  }
  return [...byRecipient].map(([recipientId, celebrantIds]) => ({ recipientId, celebrantIds }));
}

/** Where a reminder (its bell row and a one-birthday push) leads: the quick-wish sheet for that person. */
export function birthdayWishHref(celebrantId: string): string {
  return `/birthdays?wish=${celebrantId}`;
}

/** Where a push about several birthdays leads: today's list. */
export const BIRTHDAYS_HREF = "/birthdays";

/** One row of today's list (/birthdays): what it shows, and nothing about the birth date. */
export type TodaysBirthday = {
  id: string;
  name: string | null;
  username: string | null;
  avatarUrl: string | null;
  wished: boolean;
};

// ---------- Wishes ----------

export type BirthdayWishChoice =
  | { kind: "emoji"; emoji: (typeof BIRTHDAY_EMOJIS)[number] }
  | { kind: "preset"; presetId: BirthdayPresetId }
  | { kind: "custom"; text: string };

/** The text of the message a wish sends. A preset is worded in the sender's language; custom text is as typed. */
export function birthdayWishContent(choice: BirthdayWishChoice, presets: Record<BirthdayPresetId, string>): string {
  if (choice.kind === "emoji") return choice.emoji;
  if (choice.kind === "preset") return presets[choice.presetId];
  return choice.text.trim();
}
