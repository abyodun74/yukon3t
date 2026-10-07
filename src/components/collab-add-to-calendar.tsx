"use client";

import { CalendarPlus, Download } from "lucide-react";
import { formatScheduleDays, formatScheduleTime } from "@/lib/collab-schedule";
import { buildGoogleCalendarUrl } from "@/lib/calendar-export";

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
  const googleUrl = buildGoogleCalendarUrl({ title, description, startAt });

  return (
    <div className="rounded-lg border border-line p-3">
      <p className="text-sm font-medium">
        Repeats every {formatScheduleDays(scheduleDays)} at {formatScheduleTime(scheduleTime)} UTC
      </p>
      <p className="mt-0.5 text-xs text-foreground-soft">
        Next session: {startAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <a
          href={googleUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:border-accent hover:text-accent"
        >
          <CalendarPlus size={14} />
          Add to Google Calendar
        </a>
        <a
          href={`/api/collab/${collabId}/calendar`}
          className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:border-accent hover:text-accent"
        >
          <Download size={14} />
          Download .ics (Apple/Outlook)
        </a>
      </div>
    </div>
  );
}
