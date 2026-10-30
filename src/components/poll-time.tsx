"use client";

import { useSyncExternalStore } from "react";
import { Capacitor } from "@capacitor/core";
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
function useIsClient() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

/**
 * True inside the native app (the Capacitor WebView loading the site), false in a browser and during the server render.
 * The WebView has no download handler: a link to an .ics file (same origin, so it isn't handed to the OS like an outside
 * link) does nothing there, so the calendar-file download is offered only in a browser.
 */
export function useIsNativeApp() {
  return useSyncExternalStore(
    subscribe,
    () => Capacitor.isNativePlatform(),
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
function PollLocalTime({ iso }: { iso: string }) {
  const { locale, t } = useUiText();
  const isClient = useIsClient();
  if (!isClient || new Date(iso).getTimezoneOffset() === 0) return null;
  return (
    <span className="block text-[0.6875rem] font-normal text-foreground-soft">
      {format(t.polls.localTime, { when: formatPollInstant(iso, locale, "local") })}
    </span>
  );
}

/**
 * Add-to-calendar: a Google Calendar link (an outside link, which the native app hands to the OS, so it opens the
 * browser / Google Calendar app), and an .ics download when there is one, in a browser only (useIsNativeApp). Used for
 * anything scheduled from a poll and for a Circle event post (circle-event-panel.tsx).
 */
export function PollCalendarLinks({
  title,
  description,
  startAt,
  location,
  icsHref,
}: {
  title: string;
  description: string;
  startAt: string;
  location?: string | null;
  icsHref?: string | null;
}) {
  const { t } = useUiText();
  const isNative = useIsNativeApp();
  const googleUrl = buildGoogleCalendarUrl({ title, description, startAt: new Date(startAt), location });
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
      {icsHref && !isNative && (
        <a
          href={icsHref}
          download
          className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:border-accent hover:text-accent"
        >
          <Download size={14} aria-hidden />
          {t.polls.downloadIcs}
        </a>
      )}
    </div>
  );
}

/**
 * A collab's upcoming one-off sessions (each scheduled from a poll; the page passes only those still ahead, soonest
 * first), each with add-to-calendar: a Google link and that session's own .ics (?session=<id>).
 */
export function CollabOneOffSessions({
  collabId,
  title,
  description,
  sessions,
}: {
  collabId: string;
  title: string;
  description: string;
  sessions: { id: string; startAt: string }[];
}) {
  const { locale, t } = useUiText();
  return (
    <ul className="space-y-2">
      {sessions.map((session) => (
        <li key={session.id} className="rounded-lg border border-line p-3">
          <p className="text-sm font-medium" suppressHydrationWarning>
            {format(t.polls.oneOffSession, { when: formatPollInstant(session.startAt, locale, "utc") })}
          </p>
          <PollLocalTime iso={session.startAt} />
          <PollCalendarLinks
            title={title}
            description={description}
            startAt={session.startAt}
            icsHref={`/api/collab/${collabId}/calendar?session=${encodeURIComponent(session.id)}`}
          />
        </li>
      ))}
    </ul>
  );
}
