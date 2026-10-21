/**
 * Repeating Circle events: the pure date maths and limits. Every occurrence is its own event Post; the series row
 * (EventSeries) only remembers the rule. All arithmetic is in UTC, the same instant-based handling events already
 * use (eventAt is an absolute instant): "weekly" is exactly 7 × 24h later, so across a daylight-saving change the
 * local clock time shifts by an hour. Monthly keeps the first occurrence's day of the month, or the month's last day
 * when it is shorter (Jan 31 → Feb 28/29 → Mar 31), always computed from the first occurrence so it never drifts.
 * No I/O; the server half is actions/circle-events.ts (stop), actions/circles.ts (create) and the event-series cron.
 */

export const EVENT_REPEAT_FREQUENCIES = ["WEEKLY", "BIWEEKLY", "MONTHLY"] as const;
export type EventRepeatFrequency = (typeof EVENT_REPEAT_FREQUENCIES)[number];

/** Occurrences in a series, the first one included. */
export const EVENT_SERIES_MIN_OCCURRENCES = 2;
export const EVENT_SERIES_MAX_OCCURRENCES = 12;
/** An end date may be at most this long after the first occurrence. */
export const EVENT_SERIES_MAX_SPAN_MS = 365 * 24 * 60 * 60 * 1000;
/**
 * How long after an occurrence starts the cron creates the next one. Events have no end time (the calendar file
 * assumes an hour), so this keeps the current occurrence the only one listed while it is still on.
 */
export const EVENT_SERIES_ROLLOVER_DELAY_MS = 60 * 60 * 1000;
/** Series the cron advances per run. */
export const EVENT_SERIES_CRON_BATCH = 50;

const DAY_MS = 24 * 60 * 60 * 1000;

export type EventSeriesRule = {
  frequency: EventRepeatFrequency;
  /** The first occurrence. */
  anchorAt: Date;
  /** Occurrences in total, the first included. */
  maxOccurrences: number;
  /** Last instant an occurrence may start at, if the series ends on a date. */
  until: Date | null;
};

function daysInUtcMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** The `index`-th occurrence (0 = the first) of a series starting at `anchorAt`. */
export function occurrenceAt(anchorAt: Date, frequency: EventRepeatFrequency, index: number): Date {
  if (frequency === "WEEKLY") return new Date(anchorAt.getTime() + index * 7 * DAY_MS);
  if (frequency === "BIWEEKLY") return new Date(anchorAt.getTime() + index * 14 * DAY_MS);
  const totalMonths = anchorAt.getUTCMonth() + index;
  const year = anchorAt.getUTCFullYear() + Math.floor(totalMonths / 12);
  const month = ((totalMonths % 12) + 12) % 12;
  const day = Math.min(anchorAt.getUTCDate(), daysInUtcMonth(year, month));
  return new Date(
    Date.UTC(
      year,
      month,
      day,
      anchorAt.getUTCHours(),
      anchorAt.getUTCMinutes(),
      anchorAt.getUTCSeconds(),
      anchorAt.getUTCMilliseconds(),
    ),
  );
}

/** Every occurrence the rule allows, in order (at most maxOccurrences, none after `until`). */
export function seriesOccurrences(rule: EventSeriesRule): Date[] {
  const dates: Date[] = [];
  for (let index = 0; index < Math.min(rule.maxOccurrences, EVENT_SERIES_MAX_OCCURRENCES); index++) {
    const at = occurrenceAt(rule.anchorAt, rule.frequency, index);
    if (rule.until && at.getTime() > rule.until.getTime()) break;
    dates.push(at);
  }
  return dates;
}

export type RepeatInput = {
  frequency: EventRepeatFrequency;
  /** Ends after this many occurrences (the first included)... */
  count?: number | null;
  /** ...or on this date (inclusive: an occurrence starting at or before it still happens). */
  until?: Date | null;
};

export type RepeatError = "repeat_invalid" | "repeat_too_long" | "repeat_too_short";

/**
 * The series rule for an event starting at `anchorAt`, or why the requested repeat isn't allowed: exactly one end
 * (a count of 2-12, or an end date after the first occurrence and within a year of it), and at least two occurrences.
 */
export function buildSeriesRule(
  anchorAt: Date,
  input: RepeatInput,
): { rule: EventSeriesRule } | { error: RepeatError } {
  const hasCount = input.count !== undefined && input.count !== null;
  const hasUntil = input.until !== undefined && input.until !== null;
  if (hasCount === hasUntil) return { error: "repeat_invalid" };
  if (!EVENT_REPEAT_FREQUENCIES.includes(input.frequency)) return { error: "repeat_invalid" };
  if (hasCount) {
    const count = input.count!;
    if (!Number.isInteger(count) || count < EVENT_SERIES_MIN_OCCURRENCES) return { error: "repeat_too_short" };
    if (count > EVENT_SERIES_MAX_OCCURRENCES) return { error: "repeat_too_long" };
    return { rule: { frequency: input.frequency, anchorAt, maxOccurrences: count, until: null } };
  }
  const until = input.until!;
  if (Number.isNaN(until.getTime())) return { error: "repeat_invalid" };
  if (until.getTime() - anchorAt.getTime() > EVENT_SERIES_MAX_SPAN_MS) return { error: "repeat_too_long" };
  const rule: EventSeriesRule = {
    frequency: input.frequency,
    anchorAt,
    maxOccurrences: EVENT_SERIES_MAX_OCCURRENCES,
    until,
  };
  if (seriesOccurrences(rule).length < EVENT_SERIES_MIN_OCCURRENCES) return { error: "repeat_too_short" };
  return { rule };
}

/**
 * The occurrence the cron should create after `lastIndex`: the first later one that is still in the future (missed
 * ones, e.g. while the cron was down, are skipped rather than created in the past). Null when the series is over.
 */
export function nextOccurrence(
  rule: EventSeriesRule,
  lastIndex: number,
  now: Date,
): { index: number; at: Date } | null {
  const limit = Math.min(rule.maxOccurrences, EVENT_SERIES_MAX_OCCURRENCES);
  for (let index = lastIndex + 1; index < limit; index++) {
    const at = occurrenceAt(rule.anchorAt, rule.frequency, index);
    if (rule.until && at.getTime() > rule.until.getTime()) return null;
    if (at.getTime() > now.getTime()) return { index, at };
  }
  return null;
}

/** Whether the cron should look at a series whose latest occurrence started at `lastOccurrenceAt`. */
export function isSeriesDue(lastOccurrenceAt: Date, now: Date) {
  return lastOccurrenceAt.getTime() + EVENT_SERIES_ROLLOVER_DELAY_MS <= now.getTime();
}

/** The cutoff for the cron's query: series whose latest occurrence started at or before this are due. */
export function seriesDueCutoff(now: Date) {
  return new Date(now.getTime() - EVENT_SERIES_ROLLOVER_DELAY_MS);
}
