"use client";

import { useState, useTransition } from "react";
import { Check, HelpCircle } from "lucide-react";
import { setRsvp } from "@/app/actions/rsvp";
import { useUiText } from "@/components/ui-text";
import { applyRsvpChange, nextRsvpStatus, type RsvpCounts, type RsvpStatus } from "@/lib/rsvp";
import { announceRsvp, useRsvpSync } from "@/lib/rsvp-sync";
import { byCode, plural } from "@/lib/i18n/locales";
import { cn } from "@/lib/utils";

/**
 * One event's reply state for a button pair (the event card in post-card.tsx and "Coming up" in
 * circle-events-section.tsx): optimistic, rolled back on any error, and announced to every other button for the same
 * event on the page (rsvp-sync.ts) with the server's counts.
 */
export function useEventRsvp(postId: string, initial: { status: RsvpStatus | null; counts: RsvpCounts }) {
  const { t: ui } = useUiText();
  const [status, setStatus] = useState(initial.status);
  const [counts, setCounts] = useState(initial.counts);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [source] = useState(() => Symbol("event-rsvp"));
  useRsvpSync(postId, source, (change) => {
    setStatus(change.status);
    setCounts({ going: change.rsvpCount, maybe: change.maybeCount });
  });

  function choose(tapped: RsvpStatus) {
    const before = { status, counts };
    const next = nextRsvpStatus(status, tapped);
    setStatus(next);
    setCounts(applyRsvpChange(counts, status, next));
    setError(null);
    const rollback = (message: string) => {
      setStatus(before.status);
      setCounts(before.counts);
      setError(message);
    };
    startTransition(async () => {
      try {
        const result = await setRsvp(postId, { status: next });
        if (result.error) {
          rollback(byCode(ui.events.errors, result.error));
          return;
        }
        setStatus(result.status);
        setCounts({ going: result.rsvpCount, maybe: result.maybeCount });
        announceRsvp({ postId, status: result.status, rsvpCount: result.rsvpCount, maybeCount: result.maybeCount, source });
      } catch {
        rollback(ui.events.errors.network);
      }
    });
  }

  return { status, counts, error, isPending, choose };
}

/** "12 going · 3 maybe" (the Maybe part only when there is one). */
export function useRsvpCountsLine(counts: RsvpCounts) {
  const { locale, t: ui } = useUiText();
  const going = plural(locale, ui.events.goingCount, counts.going);
  return counts.maybe > 0 ? `${going} · ${plural(locale, ui.events.maybeCount, counts.maybe)}` : going;
}

/** The two reply buttons: "Going" and "Maybe". Tapping the chosen one again takes the reply back. */
export function EventRsvpButtons({
  status,
  isPending,
  onChoose,
  title,
  size = "md",
}: {
  status: RsvpStatus | null;
  isPending: boolean;
  onChoose: (status: RsvpStatus) => void;
  /** The event's title, for screen readers (the buttons name it). */
  title: string;
  size?: "sm" | "md";
}) {
  const { t: ui } = useUiText();
  const t = ui.events;
  const base = cn(
    "flex items-center gap-1 rounded-full font-medium disabled:opacity-50",
    size === "sm" ? "px-2.5 py-1 text-[0.6875rem]" : "px-3 py-1.5 text-xs",
  );
  return (
    <div role="group" aria-label={`${t.replyGroup}: ${title}`} className="flex shrink-0 items-center gap-1.5">
      <button data-guest-block
        type="button"
        disabled={isPending}
        onClick={() => onChoose("GOING")}
        aria-pressed={status === "GOING"}
        className={cn(base, status === "GOING" ? "bg-success text-white" : "bg-accent text-accent-ink")}
      >
        {status === "GOING" && <Check size={12} aria-hidden />}
        {status === "GOING" ? t.going : t.imGoing}
      </button>
      <button data-guest-block
        type="button"
        disabled={isPending}
        onClick={() => onChoose("MAYBE")}
        aria-pressed={status === "MAYBE"}
        className={cn(
          base,
          status === "MAYBE" ? "bg-teal text-white" : "border border-line text-foreground hover:border-accent",
        )}
      >
        {status === "MAYBE" && <HelpCircle size={12} aria-hidden />}
        {t.maybe}
      </button>
    </div>
  );
}
