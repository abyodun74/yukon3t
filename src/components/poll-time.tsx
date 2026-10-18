"use client";

import { useSyncExternalStore } from "react";
import { CalendarPlus, Download } from "lucide-react";
import { useUiText } from "@/components/ui-text";
import { buildGoogleCalendarUrl } from "@/lib/calendar-export";
import { format, intlLocale, type Locale } from "@/lib/i18n/locales";

/**
 * How polls show an instant: in UTC first (the shared reference everyone enters times in, like a collab's schedule),
 * then the reader's own local time when that differs. The local part needs the browser's time zone, so it only
 * appears once mounted: the server would otherwise render its own zone and the page would flash a wrong time.
 */

const subscribe = () => () => {};

/** True once rendering in the browser (false during the server render and hydration). */
export function useIsClient() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

export function formatPollInstant(iso: string, locale: Locale, zone: "utc" | "local") {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    ...(zone === "utc" ? { timeZone: "UTC" } : {}),
  }).format(new Date(iso));
}

/** "Tue, Oct 20, 2026, 6:00 PM UTC" plus, in the browser and when different, "… 2:00 PM EDT your time". */
export function PollInstant({ iso, className }: { iso: string; className?: string }) {
  const { locale } = useUiText();
  return (
    <span className={className}>
      <time dateTime={iso} suppressHydrationWarning>
        {formatPollInstant(iso, locale, "utc")}
      </time>
      <PollLocalTime iso={iso} />
    </span>
  );
}

/** The "… your time" line under a UTC time: browser only, and only where local time isn't UTC. */
export function PollLocalTime({ iso }: { iso: string }) {
  const { locale, t } = useUiText();
  const isClient = useIsClient();
  if (!isClient || new Date(iso).getTimezoneOffset() === 0) return null;
  return (
    <span className="block text-[0.6875rem] font-normal text-foreground-soft">
      {format(t.polls.localTime, { when: formatPollInstant(iso, locale, "local") })}
    </span>
  );
}

/** Add-to-calendar for something scheduled from a poll: a Google Calendar link, and an .ics download when there is one. */
export function PollCalendarLinks({
  title,
  description,
  startAt,
  icsHref,
}: {
  title: string;
  description: string;
  startAt: string;
  icsHref?: string | null;
}) {
  const { t } = useUiText();
  const googleUrl = buildGoogleCalendarUrl({ title, description, startAt: new Date(startAt) });
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <a
        href={googleUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:border-accent hover:text-accent"
      >
        <CalendarPlus size={14} aria-hidden />
        {t.polls.addToGoogle}
      </a>
      {icsHref && (
        <a
          href={icsHref}
          className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:border-accent hover:text-accent"
        >
          <Download size={14} aria-hidden />
          {t.polls.downloadIcs}
        </a>
      )}
    </div>
  );
}

/** A collab's upcoming one-off session (scheduled from a poll), with add-to-calendar. */
export function CollabOneOffSession({
  collabId,
  title,
  description,
  startAt,
}: {
  collabId: string;
  title: string;
  description: string;
  startAt: string;
}) {
  const { locale, t } = useUiText();
  return (
    <div className="rounded-lg border border-line p-3">
      <p className="text-sm font-medium" suppressHydrationWarning>
        {format(t.polls.oneOffSession, { when: formatPollInstant(startAt, locale, "utc") })}
      </p>
      <PollLocalTime iso={startAt} />
      <PollCalendarLinks
        title={title}
        description={description}
        startAt={startAt}
        icsHref={`/api/collab/${collabId}/calendar?session=one-off`}
      />
    </div>
  );
}
