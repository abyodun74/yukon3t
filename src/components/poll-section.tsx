"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BarChart3, CalendarCheck, Plus } from "lucide-react";
import { deletePoll, loadPolls, schedulePollOption, setPollOpen, votePoll } from "@/app/actions/polls";
import { PollFormSheet } from "@/components/poll-form-sheet";
import { PollCalendarLinks, PollInstant, formatPollInstant } from "@/components/poll-time";
import { useUiText } from "@/components/ui-text";
import { byCode, format, intlLocale, plural, type Locale } from "@/lib/i18n/locales";
import {
  POLL_SIGNAL_COOLDOWN_MS,
  POLL_SIGNAL_MAX_DELAY_MS,
  appendPollPage,
  mergeFirstPage,
  pollCursorOf,
  pollScrollTarget,
} from "@/lib/polls";
import type { PollView } from "@/lib/polls-data";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";
import { createSignalThrottle, useRealtimeEvent } from "@/lib/realtime-client";

/**
 * A Circle's or collab's polls: the list (first page from the server, "Load more" for older ones), voting, live
 * results and the organizer's controls. Results are counts and percentages only, for everyone (admins included); the
 * only picks shown are the viewer's own. After a vote the action answers with the poll's fresh counts; organizer
 * actions refresh the page. Other people's votes and changes arrive live: a thin signal on the parent's poll channel,
 * after which this re-reads everything it has loaded through loadPolls (coalesced: POLL_SIGNAL_* in lib/polls.ts).
 * The section is the `#polls` anchor notification links land on (and each card `#poll-<id>`).
 */
export function PollSection({
  circleId,
  collabId,
  polls: initialPolls,
  hasMore: initialHasMore,
  canCreate,
  channels = [],
}: {
  circleId?: string;
  collabId?: string;
  polls: PollView[];
  hasMore: boolean;
  canCreate: boolean;
  channels?: { id: string; name: string }[];
}) {
  const { locale, dir, t: ui } = useUiText();
  const t = ui.polls;
  const [creating, setCreating] = useState(false);
  const [polls, setPolls] = useState(initialPolls);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // A fresh first page from the server (router.refresh after an organizer's action): it replaces what it covers,
  // older polls already loaded with "Load more" stay (React's "adjusting state when a prop changes").
  const [source, setSource] = useState(initialPolls);
  if (source !== initialPolls) {
    setSource(initialPolls);
    setPolls(mergeFirstPage(initialPolls, initialHasMore, polls));
    if (!initialHasMore) setHasMore(false);
  }

  const pollsRef = useRef(polls);
  useEffect(() => {
    pollsRef.current = polls;
  });

  // The live refresh: everything from the newest poll down to the oldest one loaded (new polls, fresh counts, edits;
  // a deleted poll drops out). Failures are left to the next signal or focus resync.
  const refresh = useCallback(async () => {
    const last = pollsRef.current[pollsRef.current.length - 1];
    const result = await loadPolls({
      circleId: circleId ?? null,
      collabId: collabId ?? null,
      cursor: last ? pollCursorOf(last) : null,
      mode: "through",
    });
    if (result.error) return;
    setPolls(result.polls);
    setHasMore(result.hasMore);
  }, [circleId, collabId]);

  const throttleRef = useRef<ReturnType<typeof createSignalThrottle> | null>(null);
  useEffect(() => {
    const throttle = createSignalThrottle(() => refresh(), {
      maxDelayMs: POLL_SIGNAL_MAX_DELAY_MS,
      cooldownMs: POLL_SIGNAL_COOLDOWN_MS,
    });
    throttleRef.current = throttle;
    return () => {
      throttle.cancel();
      throttleRef.current = null;
    };
  }, [refresh]);

  // A signal goes through the throttle (a vote burst on a popular poll is one refetch per cooldown, not one per vote);
  // the hook's own focus resync (null payload) is already spread out and rate-limited, so it refetches directly.
  const handleSignal = useCallback(
    (payload: unknown) => {
      if (payload === null) return refresh();
      throttleRef.current?.signal();
    },
    [refresh],
  );
  useRealtimeEvent(
    circleId ? REALTIME_CHANNELS.circlePolls(circleId) : collabId ? REALTIME_CHANNELS.collabPolls(collabId) : null,
    "changed",
    handleSignal,
  );

  // Notification links land on #polls (or #poll-<id>). The section renders with the page, but the browser's own jump
  // can happen before the content above it has settled, so scroll once more after mount, and on a later hash change.
  useEffect(() => {
    function scrollToHash() {
      const target = pollScrollTarget(
        window.location.hash,
        pollsRef.current.map((p) => p.id),
      );
      if (!target) return;
      requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView({ block: "start" }));
    }
    scrollToHash();
    window.addEventListener("hashchange", scrollToHash);
    return () => window.removeEventListener("hashchange", scrollToHash);
  }, []);

  async function loadMore() {
    const last = polls[polls.length - 1];
    if (!last || loadingMore) return;
    setLoadingMore(true);
    setLoadError(null);
    try {
      const result = await loadPolls({
        circleId: circleId ?? null,
        collabId: collabId ?? null,
        cursor: pollCursorOf(last),
        mode: "older",
      });
      if (result.error) {
        setLoadError(byCode(t.errors, result.error));
        return;
      }
      setPolls((current) => appendPollPage(current, result.polls));
      setHasMore(result.hasMore);
    } catch {
      setLoadError(t.errors.network);
    } finally {
      setLoadingMore(false);
    }
  }

  if (polls.length === 0 && !canCreate) return null;

  return (
    <section id="polls" aria-labelledby="polls-heading" lang={locale} dir={dir} className="mt-8 scroll-mt-20">
      <div className="flex items-center justify-between gap-2">
        <h2
          id="polls-heading"
          className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-foreground-soft"
        >
          <BarChart3 size={14} aria-hidden />
          {t.heading}
        </h2>
        {canCreate && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:border-accent hover:text-accent"
          >
            <Plus size={14} aria-hidden />
            {t.newPoll}
          </button>
        )}
      </div>
      {polls.length === 0 ? (
        <p className="mt-3 text-sm text-foreground-soft">{t.empty}</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {polls.map((poll) => (
            <li key={poll.id} id={`poll-${poll.id}`} className="scroll-mt-20">
              <PollCard poll={poll} circle={!!circleId} collabId={collabId} />
            </li>
          ))}
        </ul>
      )}
      {hasMore && polls.length > 0 && (
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
      {canCreate && (
        <PollFormSheet
          open={creating}
          onClose={() => setCreating(false)}
          parent={{ circleId, collabId }}
          channels={channels}
        />
      )}
    </section>
  );
}

function sameIds(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((id) => b.includes(id));
}

function percentText(percent: number, locale: Locale) {
  return new Intl.NumberFormat(intlLocale(locale), { style: "percent", maximumFractionDigits: 0 }).format(percent / 100);
}

function PollCard({ poll, circle, collabId }: { poll: PollView; circle: boolean; collabId?: string }) {
  const { locale, t: ui } = useUiText();
  const t = ui.polls;
  const router = useRouter();
  // The latest server view: the prop after a page refresh, or what votePoll answered with. Re-synced when the prop
  // changes (a refresh), per React's "adjusting state when a prop changes".
  const [view, setView] = useState(poll);
  const [source, setSource] = useState(poll);
  const [selected, setSelected] = useState<string[]>(poll.myOptionIds);
  if (source !== poll) {
    setSource(poll);
    setView(poll);
    // A live refresh (someone else voted) mustn't throw away picks this viewer hasn't submitted yet: only follow the
    // server's picks while the selection still matches what was saved.
    if (sameIds(selected, view.myOptionIds)) setSelected(poll.myOptionIds);
  }
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState<"delete" | { schedule: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const inputName = `poll-${view.id}`;
  const changed = !sameIds(selected, view.myOptionIds);

  function run(action: () => Promise<{ error: string | null }>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (result.error) {
          setError(byCode(t.errors, result.error));
          return;
        }
        setConfirming(null);
        after?.();
        router.refresh();
      } catch {
        setError(t.errors.network);
      }
    });
  }

  function vote(optionIds: string[]) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await votePoll(view.id, optionIds);
        if (result.error) {
          setError(byCode(t.errors, result.error));
          return;
        }
        if (result.poll) {
          setView(result.poll);
          setSelected(result.poll.myOptionIds);
        }
      } catch {
        setError(t.errors.network);
      }
    });
  }

  function toggle(optionId: string) {
    if (view.allowMultiple) {
      setSelected((current) =>
        current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId],
      );
    } else {
      setSelected([optionId]);
    }
  }

  const optionLabel = (option: PollView["options"][number]) =>
    option.startsAt ? formatPollInstant(option.startsAt, locale, "utc") : (option.text ?? "");

  return (
    <article className="rounded-xl border border-line p-4" aria-labelledby={`${inputName}-q`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={`${inputName}-q`} dir="auto" className="break-words font-semibold">
            {view.question}
          </h3>
          <p className="mt-0.5 text-[0.6875rem] text-foreground-soft">
            <span dir="auto">{format(t.by, { name: view.creatorName ?? ui.unknownName })}</span>
            {view.channelName && <> · {format(t.inChannel, { channel: view.channelName })}</>}
            {" · "}
            <span className={view.open ? "text-teal" : undefined}>{view.open ? t.open : t.closed}</span>
            {view.open && view.closesAt && (
              <span suppressHydrationWarning>
                {" · "}
                {format(t.closesOn, { when: formatPollInstant(view.closesAt, locale, "utc") })}
              </span>
            )}
          </p>
        </div>
      </div>
      {view.description && (
        <p dir="auto" className="mt-2 whitespace-pre-line break-words text-sm text-foreground-soft">
          {view.description}
        </p>
      )}

      <fieldset className="mt-3" disabled={!view.canVote || isPending}>
        <legend className="sr-only">{view.question}</legend>
        <p className="text-[0.6875rem] text-foreground-soft">{view.allowMultiple ? t.pickAny : t.pickOne}</p>
        <ul className="mt-1.5 space-y-2">
          {view.options.map((option) => {
            const checked = selected.includes(option.id);
            const isLeading = view.voterCount > 0 && view.leadingOptionIds.includes(option.id);
            const votes = plural(locale, t.votes, option.count);
            const resultText = `${votes} · ${percentText(option.percent, locale)}`;
            const canScheduleThis = view.canSchedule && isLeading && !!option.startsAt;
            return (
              <li key={option.id}>
                <label
                  className={`relative block overflow-hidden rounded-lg border px-3 py-2 ${
                    checked ? "border-accent" : "border-line"
                  } ${view.canVote ? "cursor-pointer" : ""}`}
                >
                  {/* The result bar: decoration only, the same numbers are in the text. */}
                  <span
                    aria-hidden
                    className="absolute inset-y-0 start-0 bg-accent/10 transition-[width] duration-300 motion-reduce:transition-none"
                    style={{ width: `${option.percent}%` }}
                  />
                  <span className="relative flex items-start gap-2">
                    <input
                      type={view.allowMultiple ? "checkbox" : "radio"}
                      name={inputName}
                      value={option.id}
                      checked={checked}
                      onChange={() => toggle(option.id)}
                      className="mt-1"
                      aria-describedby={`${inputName}-${option.id}-result`}
                    />
                    <span className="min-w-0 flex-1">
                      {option.startsAt ? (
                        <PollInstant iso={option.startsAt} className="block text-sm font-medium" />
                      ) : (
                        <span dir="auto" className="block break-words text-sm font-medium">
                          {option.text}
                        </span>
                      )}
                      <span className="mt-0.5 flex flex-wrap gap-x-2 text-[0.6875rem] text-foreground-soft">
                        <span id={`${inputName}-${option.id}-result`}>{resultText}</span>
                        {isLeading && <span className="font-medium text-teal">{t.leading}</span>}
                        {view.myOptionIds.includes(option.id) && (
                          <span className="font-medium text-accent">{t.yourPick}</span>
                        )}
                      </span>
                    </span>
                  </span>
                </label>
                {canScheduleThis && (
                  <button
                    type="button"
                    onClick={() => setConfirming({ schedule: option.id })}
                    disabled={isPending}
                    className="mt-1 flex items-center gap-1.5 rounded-lg border border-line px-3 py-1 text-xs font-medium hover:border-accent hover:text-accent disabled:opacity-50"
                  >
                    <CalendarCheck size={14} aria-hidden />
                    {t.schedule}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </fieldset>

      <p className="mt-2 text-[0.6875rem] text-foreground-soft" aria-live="polite">
        {plural(locale, t.voters, view.voterCount)}
      </p>
      <p className="mt-0.5 text-[0.6875rem] text-foreground-soft">{t.anonymous}</p>

      {view.canVote && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => vote(selected)}
            disabled={isPending || !changed || selected.length === 0}
            className="rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-accent-ink disabled:opacity-50"
          >
            {isPending ? t.voting : t.vote}
          </button>
          {view.myOptionIds.length > 0 && (
            <button
              type="button"
              onClick={() => vote([])}
              disabled={isPending}
              className="rounded-lg border border-line px-3 py-1.5 text-xs disabled:opacity-50"
            >
              {t.withdraw}
            </button>
          )}
        </div>
      )}
      {view.open && !view.canVote && <p className="mt-2 text-xs text-foreground-soft">{t.joinToVote}</p>}

      {view.scheduledAt && (
        <div className="mt-3 rounded-lg border border-line p-3">
          <p className="text-sm font-medium" suppressHydrationWarning>
            {format(t.scheduled, { when: formatPollInstant(view.scheduledAt, locale, "utc") })}
          </p>
          {view.scheduledPostId && (
            <Link href={`/post/${view.scheduledPostId}`} className="mt-1 inline-block text-xs text-accent hover:underline">
              {t.viewEvent}
            </Link>
          )}
          <PollCalendarLinks
            title={view.question}
            description={view.description ?? ""}
            startAt={view.scheduledAt}
            icsHref={
              collabId && view.scheduledSessionId
                ? `/api/collab/${collabId}/calendar?session=${encodeURIComponent(view.scheduledSessionId)}`
                : null
            }
          />
        </div>
      )}

      {confirming && typeof confirming === "object" && (
        <div role="alert" className="mt-3 space-y-2 rounded-lg border border-accent/40 p-3">
          <p className="text-xs" suppressHydrationWarning>
            {format(circle ? t.scheduleCircle : t.scheduleCollab, {
              when: optionLabel(view.options.find((o) => o.id === confirming.schedule)!),
            })}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={() => run(() => schedulePollOption(view.id, confirming.schedule))}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink disabled:opacity-50"
            >
              {t.scheduleYes}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => setConfirming(null)}
              className="rounded-lg border border-line px-3 py-1.5 text-xs disabled:opacity-50"
            >
              {ui.cancel}
            </button>
          </div>
        </div>
      )}

      {view.canManage && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3" role="group" aria-label={t.manage}>
          {!view.scheduledAt && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={isPending}
              className="rounded-lg border border-line px-3 py-1 text-xs hover:border-accent hover:text-accent disabled:opacity-50"
            >
              {t.edit}
            </button>
          )}
          <button
            type="button"
            onClick={() => run(() => setPollOpen(view.id, !view.open))}
            disabled={isPending}
            className="rounded-lg border border-line px-3 py-1 text-xs hover:border-accent hover:text-accent disabled:opacity-50"
          >
            {view.open ? t.closePoll : t.reopen}
          </button>
          {confirming === "delete" ? (
            <span className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-foreground-soft">{t.confirmDelete}</span>
              <button
                type="button"
                disabled={isPending}
                onClick={() => run(() => deletePoll(view.id))}
                className="rounded-md bg-danger px-2.5 py-1 font-medium text-white disabled:opacity-50"
              >
                {t.deletePoll}
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => setConfirming(null)}
                className="rounded-md border border-line px-2.5 py-1 disabled:opacity-50"
              >
                {ui.cancel}
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming("delete")}
              disabled={isPending}
              className="rounded-lg border border-line px-3 py-1 text-xs text-danger hover:border-danger disabled:opacity-50"
            >
              {t.deletePoll}
            </button>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}

      {view.canManage && editing && (
        <PollFormSheet open={editing} onClose={() => setEditing(false)} poll={view} />
      )}
    </article>
  );
}
