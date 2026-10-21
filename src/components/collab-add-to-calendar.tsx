"use client";

import { CalendarPlus, Download } from "lucide-react";
import { formatScheduleDays, formatScheduleTime } from "@/lib/collab-schedule";
import { buildGoogleCalendarUrl } from "@/lib/calendar-export";
import { useCollabText } from "@/components/collab-text";
import { useUiText } from "@/components/ui-text";
import { useIsNativeApp } from "@/components/poll-time";
import { format, intlLocale } from "@/lib/i18n/locales";

/**
 * Shown on a Collab's detail page when it has a recurring session schedule
 * — the next occurrence (in the viewer's own local time, safe to format
 * client-side since it's just one absolute instant, unlike the schedule's
 * own UTC day/time inputs — see CollabScheduleField) plus two ways to add
 * it to an external calendar: a direct Google Calendar link (built here,
 * client-side, no server round-trip needed) and a "download .ics" link to
 * the API route for Apple Calendar/Outlook/desktop clients. Both carry a
 * built-in reminder (see calendar-export.ts).
 */
export function CollabAddToCalendar({
  collabId,
  title,
  description,
  scheduleDays,
  scheduleTime,
  nextSessionAt,
}: {
  collabId: string;
  title: string;
  description: string;
  scheduleDays: number[];
  scheduleTime: string;
  nextSessionAt: string;
}) {
  const startAt = new Date(nextSessionAt);
  const { locale, t: collab } = useCollabText();
  const t = collab.calendar;
  const { t: ui } = useUiText();
  const googleUrl = buildGoogleCalendarUrl({ title, description, startAt });
  // The native app's WebView can't download the .ics (see useIsNativeApp): only the Google link there.
  const isNative = useIsNativeApp();

  return (
    <div className="rounded-lg border border-line p-3">
      <p className="text-sm font-medium">
        {format(t.repeats, {
          days: formatScheduleDays(scheduleDays, locale, ui.listSeparator),
          time: formatScheduleTime(scheduleTime, locale),
        })}
      </p>
      <p className="mt-0.5 text-xs text-foreground-soft">
        {format(t.next, {
          when: startAt.toLocaleString(intlLocale(locale), { dateStyle: "medium", timeStyle: "short" }),
        })}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <a
          href={googleUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:border-accent hover:text-accent"
        >
          <CalendarPlus size={14} />
          {t.google}
        </a>
        {!isNative && (
          <a
            href={`/api/collab/${collabId}/calendar`}
            download
            className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:border-accent hover:text-accent"
          >
            <Download size={14} />
            {t.ics}
          </a>
        )}
      </div>
    </div>
  );
}
