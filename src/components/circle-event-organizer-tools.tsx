"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { ClipboardCheck, Download, Megaphone, Search, UserPlus } from "lucide-react";
import {
  exportCircleEventCsv,
  loadEventCheckIn,
  postEventAnnouncement,
  searchEventWalkIns,
  setEventAttendance,
} from "@/app/actions/circle-event-organizer";
import { formatEventTime } from "@/components/circle-events-section";
import { useIsNativeApp } from "@/components/poll-time";
import { useUiText } from "@/components/ui-text";
import { UserAvatar } from "@/components/user-link";
import {
  EVENT_ANNOUNCEMENT_MAX_LENGTH,
  EVENT_CHECK_IN_LIST_MAX,
  EVENT_CHECK_IN_REFRESH_MS,
} from "@/lib/circle-event-organizer";
import type {
  AttendanceSummaryView,
  CheckInPerson,
  EventUpdateView,
  OrganizerToolsView,
  WalkInCandidate,
} from "@/lib/circle-event-organizer-data";
import { csvFileContent } from "@/lib/csv";
import { byCode, format, plural, type Locale } from "@/lib/i18n/locales";

type Messages = ReturnType<typeof useUiText>["t"]["eventTools"];

function summaryLine(summary: AttendanceSummaryView, locale: Locale, t: Messages) {
  const parts = [plural(locale, t.summaryGoing, summary.going)];
  if (summary.maybe > 0) parts.push(plural(locale, t.summaryMaybe, summary.maybe));
  parts.push(plural(locale, t.summaryAttended, summary.attended));
  const line = parts.join(" · ");
  return summary.walkIns > 0 ? `${line} (${plural(locale, t.summaryWalkIns, summary.walkIns)})` : line;
}

/**
 * "Organizer tools" in a Circle event's panel (circle-event-panel.tsx), for its organizers only: post an update to
 * everyone going, the attendance list (check-in) with the going-vs-attended summary, and the CSV export. Each part
 * opens in place so the panel stays short on a phone. The server decides every permission and window again
 * (actions/circle-event-organizer.ts); `tools` only chooses what to offer.
 */
export function CircleEventOrganizerTools({
  postId,
  tools,
  onUpdates,
}: {
  postId: string;
  tools: OrganizerToolsView;
  onUpdates: (updates: EventUpdateView[]) => void;
}) {
  const { locale, t: ui } = useUiText();
  const t = ui.eventTools;
  const [summary, setSummary] = useState(tools.summary);

  return (
    <section aria-labelledby={`organizer-tools-${postId}`} className="rounded-lg border border-line p-3">
      <h2 id={`organizer-tools-${postId}`} className="text-sm font-semibold">
        {t.heading}
      </h2>
      <p className="mt-0.5 text-xs text-foreground-soft">{t.help}</p>
      {summary && (
        <p className="mt-2 text-xs font-medium" aria-live="polite">
          {summaryLine(summary, locale, t)}
        </p>
      )}
      <div className="mt-2 divide-y divide-line">
        {tools.announce && <AnnounceTool postId={postId} tools={tools} onUpdates={onUpdates} />}
        <CheckInTool postId={postId} tools={tools} onSummary={setSummary} />
        <ExportTool postId={postId} canExportSeries={tools.canExportSeries} />
      </div>
    </section>
  );
}

const toggleClass =
  "flex w-full items-center gap-1.5 py-2 text-start text-sm font-medium hover:text-accent disabled:opacity-50";
const buttonClass =
  "flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:border-accent hover:text-accent disabled:opacity-50";
const primaryClass =
  "flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink disabled:opacity-50";

function Feedback({ error, notice }: { error: string | null; notice: string | null }) {
  if (!error && !notice) return null;
  return (
    <p role={error ? "alert" : "status"} className={error ? "mt-1 text-xs text-danger" : "mt-1 text-xs text-success"}>
      {error ?? notice}
    </p>
  );
}

function AnnounceTool({
  postId,
  tools,
  onUpdates,
}: {
  postId: string;
  tools: OrganizerToolsView;
  onUpdates: (updates: EventUpdateView[]) => void;
}) {
  const { locale, t: ui } = useUiText();
  const t = ui.eventTools;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [left, setLeft] = useState(tools.announcementsLeft);
  const [nextAt, setNextAt] = useState(tools.nextAnnouncementAt);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || isPending || left <= 0) return;
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        const result = await postEventAnnouncement(postId, { text: trimmed });
        if (result.error) {
          setError(byCode(t.errors, result.error));
          return;
        }
        setText("");
        setLeft(result.announcementsLeft);
        setNextAt(result.nextAnnouncementAt);
        onUpdates(result.updates);
        setNotice(plural(locale, t.announceSent, result.notified));
      } catch {
        setError(t.errors.network);
      }
    });
  }

  return (
    <div className="py-1">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={toggleClass}>
        <Megaphone size={14} aria-hidden />
        {t.announce}
      </button>
      {open && (
        <form onSubmit={submit} className="space-y-2 pb-2">
          <p className="text-xs text-foreground-soft">{t.announceHelp}</p>
          <label htmlFor={`event-update-${postId}`} className="sr-only">
            {t.announceLabel}
          </label>
          <textarea
            id={`event-update-${postId}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={EVENT_ANNOUNCEMENT_MAX_LENGTH}
            rows={3}
            dir="auto"
            placeholder={t.announcePlaceholder}
            className="w-full resize-y rounded-lg border border-line bg-background px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[0.6875rem] text-foreground-soft">
              {format(t.announceCount, { count: text.length, max: EVENT_ANNOUNCEMENT_MAX_LENGTH })}
              <span aria-hidden> · </span>
              {plural(locale, t.announceLeft, left)}
            </span>
            <button type="submit" disabled={isPending || !text.trim() || left <= 0} className={primaryClass}>
              {t.announceSend}
            </button>
          </div>
          {left <= 0 && nextAt && (
            <p className="text-xs text-foreground-soft" suppressHydrationWarning>
              {format(t.announceAgainAt, { when: formatEventTime(nextAt, locale) })}
            </p>
          )}
          <Feedback error={error} notice={notice} />
        </form>
      )}
    </div>
  );
}

function personLabel(person: { name: string | null; username: string | null }, fallback: string) {
  return person.name ?? (person.username ? `@${person.username}` : fallback);
}

function CheckInTool({
  postId,
  tools,
  onSummary,
}: {
  postId: string;
  tools: OrganizerToolsView;
  onSummary: (summary: AttendanceSummaryView) => void;
}) {
  const { locale, t: ui } = useUiText();
  const t = ui.eventTools;
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<CheckInPerson[] | null>(null);
  const [editable, setEditable] = useState(tools.checkIn.editable);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // A tick in flight: a refresh landing meanwhile must not undo it on screen.
  const marking = useRef(0);

  // While the list is open and the page is visible, re-read it every EVENT_CHECK_IN_REFRESH_MS so several organizers
  // checking people in at the door see each other's ticks; paused while hidden (and once more on return).
  const loaded = people !== null;
  useEffect(() => {
    if (!open || !loaded) return;
    let stopped = false;
    async function refresh() {
      if (stopped || document.visibilityState !== "visible" || marking.current > 0) return;
      try {
        const result = await loadEventCheckIn(postId);
        if (stopped || result.error || marking.current > 0) return;
        setPeople(result.people);
        setEditable(result.editable);
        setTruncated(result.truncated);
        onSummary(result.summary);
      } catch {
        // A missed refresh is retried on the next tick.
      }
    }
    const timer = setInterval(() => void refresh(), EVENT_CHECK_IN_REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [open, loaded, postId, onSummary]);

  function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (!next || people) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await loadEventCheckIn(postId);
        if (result.error) {
          setError(byCode(t.errors, result.error));
          return;
        }
        setPeople(result.people);
        setEditable(result.editable);
        setTruncated(result.truncated);
        onSummary(result.summary);
      } catch {
        setError(t.errors.network);
      }
    });
  }

  async function mark(person: { userId: string } & Partial<CheckInPerson>, attended: boolean) {
    setError(null);
    setBusyId(person.userId);
    marking.current += 1;
    try {
      const result = await setEventAttendance(postId, { userId: person.userId, attended });
      if (result.error) {
        setError(byCode(t.errors, result.error));
        return false;
      }
      onSummary(result.summary);
      setPeople((current) => {
        const list = current ?? [];
        if (list.some((p) => p.userId === person.userId)) {
          return list
            .map((p) => (p.userId === person.userId ? { ...p, attended } : p))
            // A walk-in unticked leaves the list (they hadn't replied).
            .filter((p) => p.rsvp !== null || p.attended);
        }
        return [
          ...list,
          {
            userId: person.userId,
            name: person.name ?? null,
            username: person.username ?? null,
            avatarUrl: person.avatarUrl ?? null,
            rsvp: null,
            attended,
            walkIn: true,
          },
        ];
      });
      return true;
    } catch {
      setError(t.errors.network);
      return false;
    } finally {
      marking.current -= 1;
      setBusyId(null);
    }
  }

  const { state } = tools.checkIn;
  return (
    <div className="py-1">
      {tools.checkIn.viewable ? (
        <button type="button" aria-expanded={open} onClick={toggleOpen} className={toggleClass}>
          <ClipboardCheck size={14} aria-hidden />
          {open ? t.checkInHide : t.checkInOpen}
        </button>
      ) : (
        <p className="flex items-center gap-1.5 py-2 text-sm font-medium">
          <ClipboardCheck size={14} aria-hidden />
          {t.checkInHeading}
        </p>
      )}
      {!open && (
        <p className="pb-2 text-xs text-foreground-soft" suppressHydrationWarning>
          {state === "before"
            ? format(t.checkInOpensAt, { when: formatEventTime(tools.checkIn.opensAt, locale) })
            : state === "closed"
              ? t.checkInClosed
              : t.checkInHelp}
        </p>
      )}
      {open && (
        <div className="space-y-2 pb-2">
          {!editable && <p className="text-xs text-foreground-soft">{t.checkInClosed}</p>}
          {isPending && !people && (
            <p role="status" className="animate-loading-pulse text-xs text-foreground-soft">
              {t.checkInLoading}
            </p>
          )}
          {people && people.length === 0 && <p className="text-xs text-foreground-soft">{t.listEmpty}</p>}
          {people && people.length > 0 && (
            <ul className="divide-y divide-line">
              {people.map((person) => {
                const label = personLabel(person, ui.unknownName);
                return (
                  <li key={person.userId} className="flex items-center gap-2 py-1.5">
                    <input
                      id={`attended-${postId}-${person.userId}`}
                      type="checkbox"
                      checked={person.attended}
                      disabled={!editable || busyId === person.userId}
                      onChange={(e) => void mark(person, e.target.checked)}
                      className="h-5 w-5 shrink-0 accent-accent"
                      aria-label={format(t.markAttended, { name: label })}
                    />
                    <label
                      htmlFor={`attended-${postId}-${person.userId}`}
                      className="flex min-w-0 flex-1 items-center gap-2"
                    >
                      <UserAvatar avatarUrl={person.avatarUrl} name={person.name} size={28} />
                      <span className="min-w-0 flex-1">
                        <bdi className="block truncate text-sm">{label}</bdi>
                        {person.username && person.name && (
                          <bdi className="block truncate text-[0.6875rem] text-foreground-soft">@{person.username}</bdi>
                        )}
                      </span>
                      <span
                        className={
                          person.rsvp === "GOING"
                            ? "shrink-0 rounded-full bg-success/15 px-2 py-0.5 text-[0.6875rem] text-success"
                            : person.rsvp === "MAYBE"
                              ? "shrink-0 rounded-full bg-teal/15 px-2 py-0.5 text-[0.6875rem] text-teal"
                              : "shrink-0 rounded-full border border-line px-2 py-0.5 text-[0.6875rem] text-foreground-soft"
                        }
                      >
                        {person.rsvp === "GOING" ? t.statusGoing : person.rsvp === "MAYBE" ? t.statusMaybe : t.walkInBadge}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {truncated && (
            <p className="text-xs text-foreground-soft">{format(t.listTruncated, { count: EVENT_CHECK_IN_LIST_MAX })}</p>
          )}
          {people && editable && (
            <WalkInSearch
              postId={postId}
              exclude={new Set(people.map((p) => p.userId))}
              onAdd={(candidate) => mark(candidate, true)}
            />
          )}
          <Feedback error={error} notice={null} />
        </div>
      )}
    </div>
  );
}

function WalkInSearch({
  postId,
  exclude,
  onAdd,
}: {
  postId: string;
  exclude: ReadonlySet<string>;
  onAdd: (candidate: WalkInCandidate) => Promise<boolean>;
}) {
  const { t: ui } = useUiText();
  const t = ui.eventTools;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WalkInCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const latest = useRef(0);

  function search(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q.replace(/^@+/, "").length < 2 || isPending) return;
    const ticket = ++latest.current;
    setError(null);
    startTransition(async () => {
      try {
        const result = await searchEventWalkIns(postId, { query: q });
        if (ticket !== latest.current) return;
        if (result.error) {
          setError(byCode(t.errors, result.error));
          return;
        }
        setResults([...result.candidates]);
      } catch {
        setError(t.errors.network);
      }
    });
  }

  const shown = results?.filter((c) => !exclude.has(c.userId)) ?? null;
  return (
    <div className="rounded-lg bg-surface p-2">
      <p className="flex items-center gap-1.5 text-xs font-semibold">
        <UserPlus size={13} aria-hidden />
        {t.walkInHeading}
      </p>
      <form onSubmit={search} className="mt-1.5 flex min-w-0 items-center gap-2">
        <label htmlFor={`walk-in-${postId}`} className="sr-only">
          {t.walkInLabel}
        </label>
        <input
          id={`walk-in-${postId}`}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.walkInPlaceholder}
          maxLength={60}
          dir="auto"
          className="min-w-0 flex-1 rounded-lg border border-line bg-background px-2 py-1.5 text-sm outline-none focus:border-accent"
        />
        <button type="submit" disabled={isPending} className={buttonClass} aria-label={t.walkInLabel} title={t.walkInLabel}>
          <Search size={14} aria-hidden />
        </button>
      </form>
      {shown && shown.length === 0 && <p className="mt-1.5 text-xs text-foreground-soft">{t.walkInNone}</p>}
      {shown && shown.length > 0 && (
        <ul className="mt-1.5 divide-y divide-line">
          {shown.map((candidate) => {
            const label = personLabel(candidate, ui.unknownName);
            return (
              <li key={candidate.userId} className="flex items-center gap-2 py-1.5">
                <UserAvatar avatarUrl={candidate.avatarUrl} name={candidate.name} size={24} />
                <span className="min-w-0 flex-1">
                  <bdi className="block truncate text-sm">{label}</bdi>
                  {candidate.username && candidate.name && (
                    <bdi className="block truncate text-[0.6875rem] text-foreground-soft">@{candidate.username}</bdi>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    void onAdd(candidate).then((ok) => {
                      if (ok) setResults((r) => r?.filter((c) => c.userId !== candidate.userId) ?? null);
                    });
                  }}
                  className={buttonClass}
                >
                  {t.walkInAdd}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <Feedback error={error} notice={null} />
    </div>
  );
}

/**
 * The CSV export. In a browser: a download (UTF-8 with a byte-order mark). In the native app the WebView has no
 * download handler (the same reason the .ics link is hidden there, see useIsNativeApp), so it shows the CSV text to
 * copy instead.
 */
function ExportTool({ postId, canExportSeries }: { postId: string; canExportSeries: boolean }) {
  const { locale, t: ui } = useUiText();
  const t = ui.eventTools;
  const isNative = useIsNativeApp();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<"event" | "series">("event");
  const [copyText, setCopyText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function run() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        const result = await exportCircleEventCsv(postId, { scope });
        if (result.error) {
          setError(byCode(t.errors, result.error));
          return;
        }
        if (isNative) {
          setCopyText(result.csv);
        } else {
          const blob = new Blob([csvFileContent(result.csv)], { type: "text/csv;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = result.fileName;
          document.body.appendChild(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 30_000);
        }
        setNotice(plural(locale, t.exportDone, result.rows));
      } catch {
        setError(t.errors.network);
      }
    });
  }

  async function copy() {
    if (copyText === null) return;
    try {
      await navigator.clipboard.writeText(copyText);
      setNotice(t.exportCopied);
    } catch {
      setError(t.errors.other);
    }
  }

  return (
    <div className="py-1">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={toggleClass}>
        <Download size={14} aria-hidden />
        {t.exportHeading}
      </button>
      {open && (
        <div className="space-y-2 pb-2">
          <p className="text-xs text-foreground-soft">{t.exportHelp}</p>
          {canExportSeries && (
            <fieldset className="space-y-1 text-xs">
              <legend className="sr-only">{t.exportHeading}</legend>
              {(["event", "series"] as const).map((value) => (
                <label key={value} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`export-scope-${postId}`}
                    value={value}
                    checked={scope === value}
                    onChange={() => {
                      setScope(value);
                      setCopyText(null);
                    }}
                  />
                  {value === "event" ? t.exportEvent : t.exportSeries}
                </label>
              ))}
            </fieldset>
          )}
          {isNative && <p className="text-xs text-foreground-soft">{t.exportNative}</p>}
          <button type="button" disabled={isPending} onClick={run} className={buttonClass}>
            <Download size={14} aria-hidden />
            {isNative ? t.exportPrepare : t.exportDownload}
          </button>
          {isNative && copyText !== null && (
            <div className="space-y-1.5">
              <label htmlFor={`export-text-${postId}`} className="sr-only">
                {t.exportTextLabel}
              </label>
              <textarea
                id={`export-text-${postId}`}
                readOnly
                value={copyText}
                rows={5}
                dir="ltr"
                onFocus={(e) => e.currentTarget.select()}
                className="ph-no-capture w-full resize-y rounded-lg border border-line bg-background px-2 py-1.5 font-mono text-[0.6875rem] outline-none"
              />
              <button type="button" onClick={() => void copy()} className={primaryClass}>
                {t.exportCopy}
              </button>
            </div>
          )}
          <Feedback error={error} notice={notice} />
        </div>
      )}
    </div>
  );
}
