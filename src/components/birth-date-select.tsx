"use client";

import { useMemo, useState } from "react";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
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
 * `YYYY-MM-DD`, so the server action (signUpWithPassword/completeOnboarding)
 * and its Zod schema (z.coerce.date()) need no changes at all.
 */
export function BirthDateSelect({
  name = "birthDate",
  defaultValue,
  required = true,
  minAge = 13,
  maxAge = 120,
}: {
  name?: string;
  /** ISO `YYYY-MM-DD`, e.g. an existing user.birthDate for onboarding's pre-fill case. */
  defaultValue?: string;
  required?: boolean;
  minAge?: number;
  maxAge?: number;
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

  const dayCount = year && month ? daysInMonth(Number(year), Number(month)) : 31;
  const days = useMemo(() => Array.from({ length: dayCount }, (_, i) => i + 1), [dayCount]);

  function handleMonthChange(nextMonth: string) {
    setMonth(nextMonth);
    // Switching from a 31-day month to a shorter one (picked the 31st, then
    // switched to April) can leave `day` pointing at a date that no longer
    // exists — clear it rather than silently combining into e.g. "Apr 31".
    if (day && nextMonth && Number(day) > daysInMonth(Number(year) || currentYear, Number(nextMonth))) {
      setDay("");
    }
  }

  const combined = year && month && day ? `${year}-${pad(month)}-${pad(day)}` : "";

  return (
    <div className="flex gap-2">
      <select
        aria-label="Birth month"
        required={required}
        value={month}
        onChange={(e) => handleMonthChange(e.target.value)}
        className={`${selectClass} flex-[1.6]`}
      >
        <option value="">Month</option>
        {MONTHS.map((m, i) => (
          <option key={m} value={String(i + 1)}>
            {m}
          </option>
        ))}
      </select>
      <select
        aria-label="Birth day"
        required={required}
        value={day}
        onChange={(e) => setDay(e.target.value)}
        className={selectClass}
      >
        <option value="">Day</option>
        {days.map((d) => (
          <option key={d} value={String(d)}>
            {d}
          </option>
        ))}
      </select>
      <select
        aria-label="Birth year"
        required={required}
        value={year}
        onChange={(e) => setYear(e.target.value)}
        className={selectClass}
      >
        <option value="">Year</option>
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
