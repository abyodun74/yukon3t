"use client";

import { useState } from "react";
import { WEEKDAY_LABELS, weekdayName } from "@/lib/collab-schedule";
import { useCollabText } from "@/components/collab-text";

/**
 * Recurring-session scheduler for a Collab's create/edit form — a plain
 * checkbox toggles a day-of-week picker + a time input, both posted as
 * native form fields (`scheduleDays`/`scheduleTime`, see collabPostSchema)
 * rather than needing any client-side submit handling. Time is deliberately
 * entered directly in UTC, not the organizer's own local time — see
 * CollabBoardPost.scheduleDays's own doc comment on why this feature
 * doesn't convert to/from a per-user local timezone at all.
 */
export function CollabScheduleField({
  defaultDays = [],
  defaultTime = null,
}: {
  defaultDays?: number[];
  defaultTime?: string | null;
}) {
  const [enabled, setEnabled] = useState(defaultDays.length > 0 && !!defaultTime);
  const [days, setDays] = useState<Set<number>>(new Set(defaultDays));
  const [time, setTime] = useState(defaultTime ?? "");
  const { locale, t: collab } = useCollabText();
  const t = collab.form;

  function toggleDay(day: number) {
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  return (
    <div>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4 rounded border-line accent-accent"
        />
        {t.recurring}
      </label>
      <p className="mt-0.5 text-xs text-foreground-soft">
        {t.recurringHint}
      </p>

      {enabled && (
        <div className="mt-2 space-y-2 rounded-lg border border-line p-3">
          <div>
            <span className="block text-xs font-medium text-foreground-soft">{t.whichDays}</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {WEEKDAY_LABELS.map((label, day) => (
                <label
                  key={label}
                  className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs has-[:checked]:border-accent has-[:checked]:bg-accent/10 has-[:checked]:text-accent"
                >
                  <input
                    type="checkbox"
                    name="scheduleDays"
                    value={day}
                    checked={days.has(day)}
                    onChange={() => toggleDay(day)}
                    className="sr-only"
                  />
                  {weekdayName(day, locale, "short")}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="collab-schedule-time" className="block text-xs font-medium text-foreground-soft">
              {t.time}
            </label>
            <input
              id="collab-schedule-time"
              type="time"
              name="scheduleTime"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              required={enabled}
              className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-1.5 text-sm outline-none focus:border-accent"
            />
            <p className="mt-1 text-xs text-foreground-soft">
              {t.timeHint}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
