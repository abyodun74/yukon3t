import { formatDistanceToNow } from "date-fns";
import { uiEn } from "@/lib/i18n/en";
import { intlLocale, type Locale } from "@/lib/i18n/locales";

// `locale` is the language of the wording around the date (see src/lib/i18n). Left out, or English, the date is
// formatted the device's own way, as it always was.
const tag = (locale?: Locale) => (locale ? (intlLocale(locale) ?? []) : []);

type DayLabels = Pick<typeof uiEn.time, "today" | "yesterday">;

/**
 * Absolute date+time for a timestamp, in the viewer's local timezone.
 * Shared by every post/comment/message/story timestamp in the app so the
 * exact moment is always available — either as the visible label (post
 * cards) or as a hover tooltip on a relative "time ago" label (comments,
 * notifications, stories, chat).
 */
export function formatDateTime(date: Date, locale?: Locale) {
  return new Date(date).toLocaleString(tag(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Midnight-to-midnight day distance, independent of the two Dates' time-of-day. */
function calendarDaysAgo(date: Date) {
  const d = new Date(date);
  const now = new Date();
  const startOfThat = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((startOfToday - startOfThat) / 86_400_000);
}

/**
 * Conversation-list timestamp, in the WhatsApp/Telegram convention: a clock
 * time for anything sent today, the weekday name within the last week,
 * otherwise a short date — so old threads don't crowd the list with a full
 * date/time string.
 */
export function formatInboxTime(date: Date, locale?: Locale, labels: DayLabels = uiEn.time) {
  const days = calendarDaysAgo(date);
  if (days <= 0) return formatClockTime(date, locale);
  if (days === 1) return labels.yesterday;
  if (days < 7) return new Date(date).toLocaleDateString(tag(locale), { weekday: "short" });
  return new Date(date).toLocaleDateString(tag(locale), { month: "short", day: "numeric" });
}

/** Clock time alone ("3:07 PM"), for a chat bubble. */
export function formatClockTime(date: Date, locale?: Locale) {
  return new Date(date).toLocaleTimeString(tag(locale), { hour: "numeric", minute: "2-digit" });
}

/** Day-separator label shown between chat bubbles that cross a calendar day. */
export function formatDaySeparator(date: Date, locale?: Locale, labels: DayLabels = uiEn.time) {
  const days = calendarDaysAgo(date);
  if (days <= 0) return labels.today;
  if (days === 1) return labels.yesterday;
  if (days < 7) return new Date(date).toLocaleDateString(tag(locale), { weekday: "long" });
  const now = new Date();
  const sameYear = new Date(date).getFullYear() === now.getFullYear();
  return new Date(date).toLocaleDateString(
    tag(locale),
    sameYear ? { month: "long", day: "numeric" } : { month: "long", day: "numeric", year: "numeric" },
  );
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 86_400],
  ["month", 30 * 86_400],
  ["week", 7 * 86_400],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

/**
 * "5 minutes ago" for a comment. English keeps date-fns's wording ("about 2 hours ago"); the other languages get
 * Intl.RelativeTimeFormat, which knows each one's plural forms, and `justNow` for anything under a minute.
 */
export function formatTimeAgo(date: Date, locale: Locale = "en", justNow: string = uiEn.time.justNow) {
  if (locale === "en") return formatDistanceToNow(date, { addSuffix: true });
  const seconds = Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 1000));
  const unit = RELATIVE_UNITS.find(([, size]) => seconds >= size);
  if (!unit) return justNow;
  return new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: "always" }).format(
    -Math.floor(seconds / unit[1]),
    unit[0],
  );
}
