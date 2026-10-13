/**
 * Pure recurring-weekly-schedule math for a Collab's session — no
 * database/network access, so it's safe to call from a Server Action, a
 * cron route, or a Server/Client Component alike. Schedule days/time are
 * always UTC here (see CollabBoardPost.scheduleDays's own doc comment on
 * why this feature deliberately doesn't convert to/from any per-user local
 * timezone) — "UTC" never appears in these names because there's no other
 * timezone concept anywhere in this module to confuse it with.
 */

import { intlLocale, type Locale } from "@/lib/i18n/locales";

/** Sunday-first, index matches Date#getUTCDay(). */
export const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/**
 * The next instant, strictly after `from`, that lands on one of `days`
 * (0=Sun..6=Sat) at `time` ("HH:mm"). Walks at most 8 days forward (a full
 * week, plus one extra day) so "today, but `time` has already passed" still
 * correctly rolls over to the following matching day instead of returning a
 * moment in the past. Returns null only when `days` is empty (no schedule).
 */
export function nextOccurrence(days: number[], time: string, from: Date): Date | null {
  if (days.length === 0) return null;
  const [hours, minutes] = time.split(":").map(Number);
  for (let i = 0; i <= 7; i++) {
    const candidate = new Date(
      Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + i, hours, minutes, 0, 0),
    );
    if (days.includes(candidate.getUTCDay()) && candidate.getTime() > from.getTime()) {
      return candidate;
    }
  }
  // Unreachable given a non-empty `days` (every weekday recurs within 7
  // days), but keeps the return type honest rather than asserting.
  return null;
}

/** Jan 7th 2024 was a Sunday: day 0 of the week this module counts in. */
const A_SUNDAY_UTC = Date.UTC(2024, 0, 7);

/**
 * A weekday (0=Sun..6=Sat) under its name in `locale`: "Monday" / "Mon" in English, and the runtime's own name in
 * the other languages ("lunes", "Lun"). The short form starts with a capital: it is a label on its own.
 */
export function weekdayName(day: number, locale: Locale = "en", width: "long" | "short" = "long"): string {
  if (locale === "en") return width === "long" ? WEEKDAY_LABELS[day] : WEEKDAY_LABELS[day].slice(0, 3);
  const tag = intlLocale(locale);
  const name = new Intl.DateTimeFormat(tag, { weekday: width, timeZone: "UTC" }).format(
    new Date(A_SUNDAY_UTC + day * 24 * 60 * 60 * 1000),
  );
  return width === "short" ? name.charAt(0).toLocaleUpperCase(tag) + name.slice(1) : name;
}

/** "Monday, Wednesday" — sorted into week order (Sun-first), not selection order, so it reads naturally regardless of the order the organizer picked them in. */
export function formatScheduleDays(days: number[], locale: Locale = "en", separator = ", "): string {
  return [...days]
    .sort((a, b) => a - b)
    .map((d) => weekdayName(d, locale))
    .join(separator);
}

/** "6:00 PM" from "18:00" — for display next to formatScheduleDays. In another language, the time the way it writes one ("18:00"). */
export function formatScheduleTime(time: string, locale: Locale = "en"): string {
  const [hours, minutes] = time.split(":").map(Number);
  if (locale !== "en") {
    return new Intl.DateTimeFormat(intlLocale(locale), { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(
      new Date(Date.UTC(2024, 0, 7, hours, minutes)),
    );
  }
  const period = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHours}:${String(minutes).padStart(2, "0")} ${period}`;
}
