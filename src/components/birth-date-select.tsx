"use client";

import { useMemo, useState } from "react";
import { MAX_AGE, MIN_AGE } from "@/lib/validation-constants";
import { sharedEn } from "@/lib/i18n/en/shared";

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

/**
 * How many days to offer for the picks so far: all of a month's days once a month is chosen (a leap year stands in
 * until the year is, so Feb 29 stays possible), 31 before that.
 */
function dayCountFor(year: string, month: string) {
  return month ? daysInMonth(year ? Number(year) : 2000, Number(month)) : 31;
}

function pad(n: string) {
  return n.padStart(2, "0");
}

const selectClass =
  "min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-3 text-sm outline-none focus:border-accent";

/**
 * Three plain <select>s (month/day/year) instead of <input type="date">.
 * The native date picker's own month-by-month navigation has no year
 * quick-jump on this app's target mobile browsers — confirmed live, a real
 * signup attempt never reached a usable birth year after 3 minutes of
 * tapping the back arrow, and rapid taps also triggered a rendering glitch
 * in the native picker itself (duplicated/overlapping day grids). This is
 * the standard fix most signup forms use for a birth-date field
 * specifically, and it fully sidesteps the native picker instead of trying
 * to work around its UI.
 *
 * Combines the three selects into one hidden `name="birthDate"` field as
 * `YYYY-MM-DD` (empty until all three are picked), which the server reads
 * strictly with parseBirthDateInput (sign-up, onboarding, Settings): a day
 * that doesn't exist is refused there, never rolled into the next month, and
 * this component never offers or keeps one (Feb 30, Apr 31, Feb 29 once a
 * non-leap year is picked).
 */
export function BirthDateSelect({
  name = "birthDate",
  defaultValue,
  required = true,
  minAge = MIN_AGE,
  maxAge = MAX_AGE,
  id,
  invalid = false,
  describedBy,
  labels = sharedEn.birthDate,
}: {
  name?: string;
  /** ISO `YYYY-MM-DD`, e.g. an existing user.birthDate for onboarding's pre-fill case. */
  defaultValue?: string;
  required?: boolean;
  minAge?: number;
  maxAge?: number;
  /** Goes on the month select, the first of the three (where focus should land). */
  id?: string;
  invalid?: boolean;
  describedBy?: string;
  /** Month names and the selects' own wording, for the account screens that aren't in English. */
  labels?: typeof sharedEn.birthDate;
}) {
  const initial = useMemo(() => {
    const [y, m, d] = (defaultValue ?? "").split("-");
    return { year: y ?? "", month: m ? String(Number(m)) : "", day: d ? String(Number(d)) : "" };
  }, [defaultValue]);

  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [day, setDay] = useState(initial.day);

  const currentYear = new Date().getFullYear();
  const years = useMemo(() => {
    const latest = currentYear - minAge;
    const earliest = currentYear - maxAge;
    const list: number[] = [];
    for (let y = latest; y >= earliest; y--) list.push(y);
    return list;
  }, [currentYear, minAge, maxAge]);

  const dayCount = dayCountFor(year, month);
  const days = useMemo(() => Array.from({ length: dayCount }, (_, i) => i + 1), [dayCount]);

  // Switching to a shorter month (picked the 31st, then April) or to a non-leap
  // year (picked Feb 29, then 2001) can leave `day` pointing at a date that no
  // longer exists: clear it rather than submitting e.g. "Apr 31".
  function clearDayIfGone(nextYear: string, nextMonth: string) {
    if (day && Number(day) > dayCountFor(nextYear, nextMonth)) setDay("");
  }

  function handleMonthChange(nextMonth: string) {
    setMonth(nextMonth);
    clearDayIfGone(year, nextMonth);
  }

  function handleYearChange(nextYear: string) {
    setYear(nextYear);
    clearDayIfGone(nextYear, month);
  }

  const combined = year && month && day ? `${year}-${pad(month)}-${pad(day)}` : "";

  return (
    <div className="flex gap-2">
      <select
        id={id}
        aria-label={labels.monthLabel}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        required={required}
        value={month}
        onChange={(e) => handleMonthChange(e.target.value)}
        className={`${selectClass} flex-[1.6]`}
      >
        <option value="">{labels.month}</option>
        {labels.months.map((m, i) => (
          <option key={m} value={String(i + 1)}>
            {m}
          </option>
        ))}
      </select>
      <select
        aria-label={labels.dayLabel}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        required={required}
        value={day}
        onChange={(e) => setDay(e.target.value)}
        className={selectClass}
      >
        <option value="">{labels.day}</option>
        {days.map((d) => (
          <option key={d} value={String(d)}>
            {d}
          </option>
        ))}
      </select>
      <select
        aria-label={labels.yearLabel}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        required={required}
        value={year}
        onChange={(e) => handleYearChange(e.target.value)}
        className={selectClass}
      >
        <option value="">{labels.year}</option>
        {years.map((y) => (
          <option key={y} value={String(y)}>
            {y}
          </option>
        ))}
      </select>
      <input type="hidden" name={name} value={combined} />
    </div>
  );
}
