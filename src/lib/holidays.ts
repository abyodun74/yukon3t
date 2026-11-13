import Holidays from "date-holidays";
import { countryCode, countryName } from "@/lib/i18n/country-names";
import type { Locale } from "@/lib/i18n/locales";
import { localDateTime, type LocalDate } from "@/lib/birthdays";

// Public-holiday reminders ("Today is Independence Day in Nigeria"): which holidays a country has on a day, what they
// are called in the reader's language, and when a reminder is due. The server half is holidays-data.ts (the
// holiday-reminders cron).
//
// SERVER-ONLY: the holiday data comes from the offline `date-holidays` dataset (~800 KB of rules, no network call at
// run time), which must never reach a browser bundle. Only holidays-data.ts (and tests) import this file; a test in
// holidays.test.ts fails if a client component, or anything other than this file, imports `date-holidays`.
//
// Region: the account's own `country` (src/lib/countries.ts, asked at onboarding and editable in Edit profile), mapped
// to its ISO code by countryCode. An account without one, "Other / Not listed", or a country the dataset doesn't cover
// gets no holiday reminders. Day and time: the holiday's calendar date in the dataset, compared with the recipient's
// local date in their own time zone (User.timeZone, UTC until known), from HOLIDAY_REMINDER_HOUR local time.

/** A reminder is due from this hour (local time) on the holiday until the day ends; the cron runs every 15 minutes. */
export const HOLIDAY_REMINDER_HOUR = 8;
/** Most reminders written by one cron run; the rest go out on the following runs the same day. */
export const HOLIDAY_MAX_PER_RUN = 2000;
/** Recipients loaded per query. */
export const HOLIDAY_BATCH = 500;
/** Recipients must have opened the app this recently: a dormant account isn't pushed holiday greetings. */
export const HOLIDAY_RECIPIENT_ACTIVE_MS = 60 * 24 * 60 * 60_000;

type DatasetHoliday = { date: string; name: string; type: string; rule: string; substitute?: boolean };

/** One holiday of a country's year, as the cron uses it. */
export type Holiday = {
  /** Stable id for the HolidayReminder unique key: "<country code>:<slug of the English name>". */
  key: string;
  /** The holiday's calendar date, YYYY-MM-DD. */
  date: string;
  /** Its name in English (or the country's own language where the dataset has no English). */
  englishName: string;
  /** For holidayName: the dataset rule, identical across languages. */
  rule: string;
};

// Observances are mostly trivia (Valentine's Day, Tax Day, Halloween, Groundhog Day); only these well-known days are
// kept. Matched against the English name. Public and bank holidays are all kept.
const NOTABLE_OBSERVANCE =
  /mother'?s'? day|father'?s'? day|children'?s day|women'?s day|independence|veterans|memorial|remembrance|labou?r day|workers?'? day|youth day|flag day|constitution day|national day|republic day|armistice|victory day|heroes'? day/i;

/**
 * Which of a country's dataset entries become reminders: every public and bank holiday plus notable observances
 * (NOTABLE_OBSERVANCE), never "optional" or "school" days. A substitute day (a holiday moved off a weekend: "Independence
 * Day (substitute day)") is the same holiday again, so it is skipped: the reminder follows the actual date. A name seen
 * twice in a year (Brazil's two Carnival days) is reminded once, on its first day.
 */
export function selectHolidays(entries: DatasetHoliday[], cc: string): Holiday[] {
  const seen = new Set<string>();
  const out: Holiday[] = [];
  for (const entry of entries) {
    if (entry.substitute) continue;
    const kept =
      entry.type === "public" || entry.type === "bank" || (entry.type === "observance" && NOTABLE_OBSERVANCE.test(entry.name));
    if (!kept) continue;
    const key = `${cc}:${holidaySlug(entry.name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, date: entry.date.slice(0, 10), englishName: entry.name, rule: entry.rule });
  }
  return out;
}

/** A holiday name as a key fragment: lower case, letters and digits of any script, dashes. */
export function holidaySlug(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "holiday"
  );
}

let supported: Set<string> | null = null;
const instances = new Map<string, Holidays>();
const yearCache = new Map<string, DatasetHoliday[]>();

/** Whether the dataset covers this country code. */
export function isHolidayCountry(cc: string): boolean {
  supported ??= new Set(Object.keys(new Holidays().getCountries()));
  return supported.has(cc);
}

function instanceFor(cc: string): Holidays {
  let hd = instances.get(cc);
  if (!hd) {
    hd = new Holidays(cc);
    instances.set(cc, hd);
  }
  return hd;
}

/** The dataset's entries for a country's year in one language (memoized: the rules don't change while running). */
function entriesFor(cc: string, year: number, lang: string | undefined): DatasetHoliday[] {
  const cacheKey = `${cc}|${year}|${lang ?? ""}`;
  let entries = yearCache.get(cacheKey);
  if (!entries) {
    entries = (instanceFor(cc).getHolidays(year, lang) || []) as DatasetHoliday[];
    yearCache.set(cacheKey, entries);
  }
  return entries;
}

/** The holidays (selectHolidays) of a country's year. Empty for a country the dataset doesn't cover. */
export function holidaysOfYear(cc: string, year: number): Holiday[] {
  if (!isHolidayCountry(cc)) return [];
  return selectHolidays(entriesFor(cc, year, "en"), cc);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A local date as YYYY-MM-DD. */
export function isoDate(date: LocalDate): string {
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}

/** The holidays of country `cc` on calendar date `date`. */
export function holidaysOn(cc: string, date: LocalDate): Holiday[] {
  const iso = isoDate(date);
  return holidaysOfYear(cc, date.year).filter((h) => h.date === iso);
}

/**
 * A holiday's name in `locale`. The dataset falls back to the country's own language for a name it hasn't translated
 * (South Korea's holidays asked in Spanish come back in Korean), so a name identical to the native one, where the
 * English differs, is shown in English instead.
 */
export function holidayName(cc: string, holiday: Holiday, locale: Locale): string {
  if (locale === "en") return holiday.englishName;
  const year = Number(holiday.date.slice(0, 4));
  const find = (lang: string | undefined) =>
    entriesFor(cc, year, lang).find((e) => e.rule === holiday.rule && e.date.slice(0, 10) === holiday.date && !e.substitute)
      ?.name;
  const localized = find(locale);
  if (!localized) return holiday.englishName;
  const native = (instanceFor(cc).getLanguages() as string[])[0];
  if (native && native !== locale && native !== "en" && localized === find(native) && localized !== holiday.englishName) {
    return holiday.englishName;
  }
  return localized;
}

// English needs "the" before these names ("in the United States"); the other languages' sentences avoid the article.
const ENGLISH_THE = new Set([
  "United States",
  "United Kingdom",
  "Netherlands",
  "Philippines",
  "United Arab Emirates",
  "Bahamas",
  "Gambia",
  "Dominican Republic",
  "Central African Republic",
  "Marshall Islands",
  "Solomon Islands",
  "Comoros",
  "Maldives",
  "Seychelles",
  "Congo (DRC)",
  "Congo (Republic)",
]);

/** The account's country as the reminder names it, in `locale` ("the United States" in English). */
export function holidayCountryLabel(appCountry: string, locale: Locale): string {
  const name = countryName(appCountry, locale);
  return locale === "en" && ENGLISH_THE.has(appCountry) ? `the ${name}` : name;
}

/** What one (country, time zone) group of recipients is due right now: the holidays, their date and code. */
export type DueHolidays = { cc: string; date: LocalDate; holidays: Holiday[] };

/**
 * The holidays a recipient in `country` and `timeZone` is due a reminder for at `now`, or null: a country the
 * dataset covers, a holiday on their local date, and local time at or after HOLIDAY_REMINDER_HOUR (so the first run
 * after 08:00 sends it; a missed run only delays it, until the day ends). No (or an unknown) time zone reads as UTC.
 */
export function dueHolidays(country: string | null | undefined, timeZone: string | null | undefined, now: Date): DueHolidays | null {
  const cc = countryCode(country);
  if (!cc || !isHolidayCountry(cc)) return null;
  const local = localDateTime(now, timeZone);
  if (local.hour < HOLIDAY_REMINDER_HOUR) return null;
  const date = { year: local.year, month: local.month, day: local.day };
  const holidays = holidaysOn(cc, date);
  return holidays.length > 0 ? { cc, date, holidays } : null;
}

/**
 * How many holidays (selectHolidays) of the account's own `country` fall on its local date at `now`, all day long (no
 * HOLIDAY_REMINDER_HOUR: this only reorders the gift picker, src/lib/gift-occasions.ts, it sends nothing). 0 for no
 * country, "Other / Not listed", or a country the dataset doesn't cover. Never says which holiday or what date.
 */
export function holidayCountToday(country: string | null | undefined, timeZone: string | null | undefined, now: Date): number {
  const cc = countryCode(country);
  if (!cc || !isHolidayCountry(cc)) return 0;
  const local = localDateTime(now, timeZone);
  return holidaysOn(cc, { year: local.year, month: local.month, day: local.day }).length;
}
