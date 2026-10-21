"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { CalendarClock, CalendarDays, MapPin, Repeat } from "lucide-react";
import { toggleRsvp } from "@/app/actions/rsvp";
import { loadCircleEvents } from "@/app/actions/circle-events";
import { useUiText } from "@/components/ui-text";
import { appendCircleEventPage, circleEventCursorOf } from "@/lib/circle-events";
import { announceRsvp, useRsvpSync } from "@/lib/rsvp-sync";
import type { CircleEventView } from "@/lib/circle-events-data";
import { byCode, format, intlLocale, plural, type Locale } from "@/lib/i18n/locales";
import { cn } from "@/lib/utils";

/** An event's start in the reader's own time, the way an event card shows it (post-card.tsx's EventBlock). */
export function formatEventTime(iso: string, locale: Locale) {
  return new Date(iso).toLocaleString(intlLocale(locale) ?? [], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * "Coming up" on a Circle page: a compact agenda of the Circle's upcoming event posts the viewer may see (soonest
 * first; the first page from the server, "Load more" after it), each with its time in the viewer's own time, where,
 * how many are going, a one-tap RSVP through the same toggleRsvp the event card uses (kept in step with the card's own
 * button, rsvp-sync.ts), and "Event details" to the post itself. The full event (bring list, calendar, organizer
 * controls) is the post, in its channel's feed and on /post/[id]; this list doesn't repeat it. Cancelled events leave
 * the list. The `#events` anchor; each item is `#event-<id>`.
 */
export function CircleEventsSection({
  circleId,
  events: initialEvents,
  hasMore: initialHasMore,
}: {
  circleId: string;
  events: CircleEventView[];
  hasMore: boolean;
}) {
  const { locale, dir, t: ui } = useUiText();
  const t = ui.events;
  const [events, setEvents] = useState(initialEvents);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // A fresh first page from the server (router.refresh, e.g. after posting an event) replaces what it covers.
  const [source, setSource] = useState(initialEvents);
  if (source !== initialEvents) {
    setSource(initialEvents);
    setEvents(initialEvents);
    setHasMore(initialHasMore);
  }

  // Links to #events land here once the page above has settled.
  useEffect(() => {
    if (window.location.hash !== "#events") return;
    requestAnimationFrame(() => document.getElementById("events")?.scrollIntoView({ block: "start" }));
  }, []);

  async function loadMore() {
    const last = events[events.length - 1];
    if (!last || loadingMore) return;
    setLoadingMore(true);
    setLoadError(null);
    try {
      const result = await loadCircleEvents({ circleId, cursor: circleEventCursorOf(last) });
      if (result.error) {
        setLoadError(byCode(t.errors, result.error));
        return;
      }
      setEvents((current) => appendCircleEventPage(current, result.events));
      setHasMore(result.hasMore);
    } catch {
      setLoadError(t.errors.network);
    } finally {
      setLoadingMore(false);
    }
  }

  if (events.length === 0) return null;

  return (
    <section id="events" aria-labelledby="events-heading" lang={locale} dir={dir} className="mt-6 scroll-mt-20">
      <h2
        id="events-heading"
        className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-foreground-soft rtl:tracking-normal"
      >
        <CalendarDays size={14} aria-hidden />
        {t.heading}
      </h2>
      <ul className="mt-3 space-y-2">
        {events.map((event) => (
          <li key={event.id} id={`event-${event.id}`} className="scroll-mt-20">
            <CircleEventItem event={event} />
          </li>
        ))}
      </ul>
      {hasMore && (
        <div className="mt-3">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="w-full rounded-lg border border-line px-3 py-2 text-xs font-medium hover:border-accent hover:text-accent disabled:opacity-50"
          >
            {loadingMore ? t.loadingMore : t.loadMore}
          </button>
          {loadError && (
            <p role="alert" className="mt-2 text-xs text-danger">
              {loadError}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function CircleEventItem({ event }: { event: CircleEventView }) {
  const { locale, t: ui } = useUiText();
  const t = ui.events;
  const [going, setGoing] = useState(event.going);
  const [count, setCount] = useState(event.rsvpCount);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // A tap on the same event's card in the feed below updates this one too.
  const [rsvpSource] = useState(() => Symbol("coming-up-rsvp"));
  useRsvpSync(event.id, rsvpSource, (change) => {
    setGoing(change.going);
    setCount(change.rsvpCount);
  });

  // Same optimistic toggle as the event card (post-card.tsx's handleRsvp), rolled back on any error.
  function toggle() {
    const next = !going;
    setGoing(next);
    setCount((c) => c + (next ? 1 : -1));
    setError(null);
    startTransition(async () => {
      try {
        const result = await toggleRsvp(event.id);
        if (result.error) {
          setGoing(!next);
          setCount((c) => c + (next ? -1 : 1));
          setError(byCode(t.errors, result.error));
          return;
        }
        if (typeof result.rsvpCount === "number") {
          setCount(result.rsvpCount);
          if (typeof result.going === "boolean") {
            announceRsvp({ postId: event.id, going: result.going, rsvpCount: result.rsvpCount, source: rsvpSource });
          }
        }
      } catch {
        setGoing(!next);
        setCount((c) => c + (next ? -1 : 1));
        setError(t.errors.network);
      }
    });
  }

  const title = event.title || t.untitled;
  return (
    <article className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 rounded-xl border border-line p-3">
      <div className="min-w-0 flex-1 basis-48">
        <Link
          href={`/post/${event.id}`}
          dir="auto"
          className="block truncate text-sm font-semibold hover:text-accent hover:underline"
        >
          {title}
        </Link>
        <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-foreground-soft">
          <CalendarDays size={13} className="shrink-0" aria-hidden />
          <time dateTime={event.eventAt} suppressHydrationWarning className="truncate">
            {formatEventTime(event.eventAt, locale)}
          </time>
        </p>
        {event.location && (
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-foreground-soft">
            <MapPin size={13} className="shrink-0" aria-hidden />
            <span dir="auto" className="truncate">
              {event.location}
            </span>
          </p>
        )}
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.6875rem] text-foreground-soft">
          {event.channelName && (
            <span dir="auto" className="max-w-full truncate">
              {format(t.inChannel, { channel: event.channelName })}
            </span>
          )}
          <span aria-live="polite">{plural(locale, t.goingCount, count)}</span>
          {event.repeating && (
            <span className="flex items-center gap-1">
              <Repeat size={11} aria-hidden />
              {t.repeating}
            </span>
          )}
          {event.rescheduled && (
            <span className="flex items-center gap-1 font-medium text-accent">
              <CalendarClock size={11} aria-hidden />
              {t.rescheduledBadge}
            </span>
          )}
          <Link href={`/post/${event.id}`} className="font-medium text-accent hover:underline">
            {t.details}
          </Link>
        </p>
        {error && (
          <p role="alert" className="mt-1 text-xs text-danger">
            {error}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={toggle}
        disabled={isPending}
        aria-pressed={going}
        aria-label={`${t.imGoing}: ${title}`}
        className={cn(
          "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium disabled:opacity-50",
          going ? "bg-success text-white" : "bg-accent text-accent-ink",
        )}
      >
        {going ? t.going : t.imGoing}
      </button>
    </article>
  );
}
