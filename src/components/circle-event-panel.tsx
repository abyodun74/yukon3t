"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { BellRing, Check, Package, Pencil, Plus, Repeat, Trash2, X } from "lucide-react";
import {
  addBringItem,
  claimBringItem,
  nudgeEventNonResponders,
  removeBringItem,
  stopEventSeries,
  unclaimBringItem,
  updateBringItem,
} from "@/app/actions/circle-events";
import { PollCalendarLinks } from "@/components/poll-time";
import { formatEventTime } from "@/components/circle-events-section";
import { useUiText } from "@/components/ui-text";
import { EVENT_BRING_ITEMS_MAX, EVENT_BRING_ITEM_MAX_LENGTH } from "@/lib/circle-events";
import type { BringItemView, CircleEventPanelData } from "@/lib/circle-events-data";
import { byCode, format, plural } from "@/lib/i18n/locales";

type ItemsResult = { error: string | null; items?: BringItemView[] };

/**
 * Under a Circle event post on its own page (/post/[id]): add to calendar, the repeat it belongs to (and "Stop
 * repeating" for organizers), "Remind people who haven't replied" (organizers, upcoming events only) and "Who's
 * bringing what". The server decides every permission again (actions/circle-events.ts); these flags only choose what to
 * offer. Bring-list actions answer with the fresh list, which replaces the local one.
 */
export function CircleEventPanel({ data }: { data: CircleEventPanelData }) {
  const { locale, dir, t: ui } = useUiText();
  const t = ui.events;
  const router = useRouter();
  const [items, setItems] = useState(data.items);
  const [source, setSource] = useState(data.items);
  if (source !== data.items) {
    setSource(data.items);
    setItems(data.items);
  }
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function runItems(action: () => Promise<ItemsResult>, after?: () => void) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (result.items) setItems(result.items);
        if (result.error) {
          setError(byCode(t.errors, result.error));
          return;
        }
        after?.();
      } catch {
        setError(t.errors.network);
      }
    });
  }

  function addItem(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || isPending) return;
    runItems(() => addBringItem(data.postId, text), () => setDraft(""));
  }

  function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing || !editing.text.trim() || isPending) return;
    const { id, text } = editing;
    runItems(() => updateBringItem(id, text), () => setEditing(null));
  }

  function nudge() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        const result = await nudgeEventNonResponders(data.postId);
        if (result.error) {
          setError(byCode(t.errors, result.error));
          return;
        }
        setNotice(plural(locale, t.nudgeSent, result.sent));
        router.refresh();
      } catch {
        setError(t.errors.network);
      }
    });
  }

  function stopRepeating() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await stopEventSeries(data.postId);
        if (result.error) {
          setError(byCode(t.errors, result.error));
          return;
        }
        setConfirmStop(false);
        router.refresh();
      } catch {
        setError(t.errors.network);
      }
    });
  }

  const repeatText = data.series
    ? data.series.active
      ? { WEEKLY: t.repeatsWeekly, BIWEEKLY: t.repeatsBiweekly, MONTHLY: t.repeatsMonthly }[data.series.frequency]
      : t.repeatEnded
    : null;
  const showBring = items.length > 0 || (data.isOrganizer && data.upcoming);
  const buttonClass =
    "flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:border-accent hover:text-accent disabled:opacity-50";

  return (
    <section lang={locale} dir={dir} aria-label={data.title || t.untitled} className="mt-4 space-y-4">
      {data.upcoming && (
        <PollCalendarLinks
          title={data.title || t.untitled}
          description={data.description}
          startAt={data.startAt}
          location={data.location}
          icsHref={`/api/events/${encodeURIComponent(data.postId)}/calendar`}
        />
      )}

      {repeatText && (
        <div className="rounded-lg border border-line p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Repeat size={14} aria-hidden />
            {repeatText}
          </p>
          {data.series?.active && <p className="mt-0.5 text-xs text-foreground-soft">{t.repeatNote}</p>}
          {data.series?.active && data.isOrganizer && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              {confirmStop ? (
                <>
                  <span className="text-foreground-soft">{t.confirmStop}</span>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={stopRepeating}
                    className="rounded-md bg-danger px-2.5 py-1 font-medium text-white disabled:opacity-50"
                  >
                    {t.stopRepeating}
                  </button>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => setConfirmStop(false)}
                    className="rounded-md border border-line px-2.5 py-1 disabled:opacity-50"
                  >
                    {ui.cancel}
                  </button>
                </>
              ) : (
                <button type="button" disabled={isPending} onClick={() => setConfirmStop(true)} className={buttonClass}>
                  {t.stopRepeating}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {data.isOrganizer && data.upcoming && (
        <div className="rounded-lg border border-line p-3">
          <button
            type="button"
            onClick={nudge}
            disabled={isPending || !!data.nextNudgeAt}
            aria-describedby={`nudge-help-${data.postId}`}
            className={buttonClass}
          >
            <BellRing size={14} aria-hidden />
            {t.nudge}
          </button>
          <p id={`nudge-help-${data.postId}`} className="mt-1 text-xs text-foreground-soft">
            {t.nudgeHelp}
          </p>
          {data.nextNudgeAt && (
            <p className="mt-1 text-xs text-foreground-soft" suppressHydrationWarning>
              {format(t.nudgeAgainAt, { when: formatEventTime(data.nextNudgeAt, locale) })}
            </p>
          )}
        </div>
      )}

      {showBring && (
        <div className="rounded-lg border border-line p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <Package size={14} aria-hidden />
              {t.bringHeading}
            </h2>
            {data.isOrganizer && (
              <span className="text-[0.6875rem] text-foreground-soft">
                {format(t.bringCount, { count: items.length, max: EVENT_BRING_ITEMS_MAX })}
              </span>
            )}
          </div>
          {items.length === 0 ? (
            <p className="mt-2 text-xs text-foreground-soft">{data.isOrganizer ? t.bringEmptyOrganizer : t.bringEmpty}</p>
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {items.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 py-2">
                  {editing?.id === item.id ? (
                    <form onSubmit={saveEdit} className="flex w-full min-w-0 flex-wrap items-center gap-2">
                      <input
                        value={editing.text}
                        onChange={(e) => setEditing({ id: item.id, text: e.target.value })}
                        maxLength={EVENT_BRING_ITEM_MAX_LENGTH}
                        aria-label={format(t.bringEdit, { item: item.text })}
                        autoFocus
                        dir="auto"
                        className="min-w-0 flex-1 basis-40 rounded-lg border border-line bg-background px-2 py-1 text-sm outline-none focus:border-accent"
                      />
                      <button
                        type="submit"
                        disabled={isPending || !editing.text.trim()}
                        className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-ink disabled:opacity-50"
                      >
                        {t.bringSave}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        disabled={isPending}
                        className="rounded-md border border-line px-2.5 py-1 text-xs disabled:opacity-50"
                      >
                        {ui.cancel}
                      </button>
                    </form>
                  ) : (
                    <>
                      <div className="min-w-0 flex-1 basis-40">
                        <p dir="auto" className="break-words text-sm font-medium">
                          {item.text}
                        </p>
                        <p className="mt-0.5 truncate text-[0.6875rem] text-foreground-soft">
                          {item.claimedByMe ? (
                            <span className="font-medium text-success">{t.bringYou}</span>
                          ) : item.claimed ? (
                            item.claimerName ? (
                              <bdi>{format(t.bringBy, { name: item.claimerName })}</bdi>
                            ) : (
                              t.bringTaken
                            )
                          ) : (
                            t.bringOpen
                          )}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                        {!item.claimed && data.isMember && (
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => runItems(() => claimBringItem(item.id))}
                            className="flex items-center gap-1 rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-ink disabled:opacity-50"
                          >
                            <Check size={12} aria-hidden />
                            {t.bringClaim}
                          </button>
                        )}
                        {item.canUnclaim && (
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => runItems(() => unclaimBringItem(item.id))}
                            className="rounded-full border border-line px-3 py-1 text-xs disabled:opacity-50"
                          >
                            {item.claimedByMe ? t.bringUnclaim : t.bringUnassign}
                          </button>
                        )}
                        {data.isOrganizer && (
                          <>
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => setEditing({ id: item.id, text: item.text })}
                              aria-label={format(t.bringEdit, { item: item.text })}
                              title={format(t.bringEdit, { item: item.text })}
                              className="rounded-md p-1.5 text-foreground-soft hover:bg-line hover:text-foreground disabled:opacity-50"
                            >
                              <Pencil size={14} aria-hidden />
                            </button>
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => runItems(() => removeBringItem(item.id))}
                              aria-label={format(t.bringRemove, { item: item.text })}
                              title={format(t.bringRemove, { item: item.text })}
                              className="rounded-md p-1.5 text-foreground-soft hover:bg-line hover:text-danger disabled:opacity-50"
                            >
                              <Trash2 size={14} aria-hidden />
                            </button>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          {!data.isMember && items.some((i) => !i.claimed) && (
            <p className="mt-2 text-xs text-foreground-soft">{t.bringJoin}</p>
          )}
          {data.isOrganizer && data.upcoming && items.length < EVENT_BRING_ITEMS_MAX && (
            <form onSubmit={addItem} className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={EVENT_BRING_ITEM_MAX_LENGTH}
                placeholder={t.bringPlaceholder}
                aria-label={t.bringAddLabel}
                dir="auto"
                className="min-w-0 flex-1 basis-40 rounded-lg border border-line bg-background px-3 py-1.5 text-sm outline-none focus:border-accent"
              />
              <button type="submit" disabled={isPending || !draft.trim()} className={buttonClass}>
                <Plus size={14} aria-hidden />
                {t.bringAdd}
              </button>
            </form>
          )}
        </div>
      )}

      {(error || notice) && (
        <p role={error ? "alert" : "status"} className={error ? "text-xs text-danger" : "text-xs text-success"}>
          {error ?? notice}
          {error && (
            <button
              type="button"
              onClick={() => setError(null)}
              aria-label={ui.close}
              className="ms-2 inline-flex align-middle text-foreground-soft"
            >
              <X size={12} aria-hidden />
            </button>
          )}
        </p>
      )}
    </section>
  );
}
