"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Megaphone, Pencil, Trash2 } from "lucide-react";
import { deleteEventAnnouncement, editEventAnnouncement } from "@/app/actions/circle-event-organizer";
import { useContentTranslation } from "@/components/content-translation";
import { formatEventTime } from "@/components/circle-events-section";
import { useUiText } from "@/components/ui-text";
import { EVENT_ANNOUNCEMENT_MAX_LENGTH } from "@/lib/circle-event-organizer";
import type { EventUpdateView } from "@/lib/circle-event-organizer-data";
import { byCode, format } from "@/lib/i18n/locales";

/**
 * "Organizer updates" pinned on a Circle event (in its panel, circle-event-panel.tsx): the latest few updates its
 * organizers sent to everyone who replied (postEventAnnouncement), newest first, for anyone who can see the event, so
 * someone who replies later still sees them. Plain text (dir="auto"), with "Translate" under one written in another
 * language, like a comment. Its author (still an organizer) can edit it, marked "edited" and never re-sent; any
 * organizer, or its author, can delete it (editEventAnnouncement / deleteEventAnnouncement decide again).
 */
export function CircleEventUpdates({
  updates,
  onUpdates,
}: {
  updates: EventUpdateView[];
  onUpdates: (updates: EventUpdateView[]) => void;
}) {
  const { t: ui } = useUiText();
  if (updates.length === 0) return null;
  return (
    <div className="rounded-lg border border-accent/40 bg-accent-soft p-3">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold">
        <Megaphone size={14} aria-hidden />
        {ui.eventTools.updatesHeading}
      </h2>
      <ul className="mt-2 space-y-3">
        {updates.map((update) => (
          <EventUpdateItem key={update.id} update={update} onUpdates={onUpdates} />
        ))}
      </ul>
    </div>
  );
}

function EventUpdateItem({
  update,
  onUpdates,
}: {
  update: EventUpdateView;
  onUpdates: (updates: EventUpdateView[]) => void;
}) {
  const { locale, t: ui } = useUiText();
  const t = ui.eventTools;
  const translation = useContentTranslation({ kind: "eventUpdate", id: update.id, text: update.text });
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function run(action: () => Promise<{ error: string | null; updates?: EventUpdateView[] }>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (result.error) {
          setError(byCode(t.errors, result.error));
          return;
        }
        after?.();
        if (result.updates) onUpdates(result.updates);
      } catch {
        setError(t.errors.network);
      }
    });
  }

  function save(e: FormEvent) {
    e.preventDefault();
    if (editing === null || !editing.trim() || isPending) return;
    const text = editing;
    run(() => editEventAnnouncement(update.id, { text }), () => setEditing(null));
  }

  const small = "rounded-md px-2 py-1 text-[0.6875rem] disabled:opacity-50";
  return (
    <li className="min-w-0">
      {editing !== null ? (
        <form onSubmit={save} className="space-y-1.5">
          <label htmlFor={`edit-update-${update.id}`} className="sr-only">
            {t.updateEditLabel}
          </label>
          <textarea
            id={`edit-update-${update.id}`}
            value={editing}
            onChange={(e) => setEditing(e.target.value)}
            maxLength={EVENT_ANNOUNCEMENT_MAX_LENGTH}
            rows={3}
            dir="auto"
            autoFocus
            className="w-full resize-y rounded-lg border border-line bg-background px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
          <div className="flex flex-wrap items-center gap-2">
            <span className="me-auto text-[0.6875rem] text-foreground-soft">
              {format(t.announceCount, { count: editing.length, max: EVENT_ANNOUNCEMENT_MAX_LENGTH })}
            </span>
            <button type="button" disabled={isPending} onClick={() => setEditing(null)} className={`${small} border border-line`}>
              {ui.cancel}
            </button>
            <button type="submit" disabled={isPending || !editing.trim()} className={`${small} bg-accent font-medium text-accent-ink`}>
              {t.updateSave}
            </button>
          </div>
        </form>
      ) : (
        <>
          <p dir="auto" className="whitespace-pre-wrap break-words text-sm">
            {translation.displayText}
          </p>
          {translation.control}
        </>
      )}
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.6875rem] text-foreground-soft">
        <span suppressHydrationWarning>
          <bdi>{update.authorName ?? t.someOrganizer}</bdi>
          <span aria-hidden> · </span>
          {formatEventTime(update.createdAt, locale)}
          {update.editedAt && (
            <>
              <span aria-hidden> · </span>
              {t.updateEdited}
            </>
          )}
        </span>
        {editing === null && update.canEdit && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              setConfirmDelete(false);
              setEditing(update.text);
            }}
            className="flex items-center gap-1 hover:text-accent disabled:opacity-50"
          >
            <Pencil size={11} aria-hidden />
            {t.updateEdit}
          </button>
        )}
        {editing === null && update.canDelete && !confirmDelete && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => setConfirmDelete(true)}
            className="flex items-center gap-1 hover:text-danger disabled:opacity-50"
          >
            <Trash2 size={11} aria-hidden />
            {t.updateDelete}
          </button>
        )}
      </div>
      {confirmDelete && (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[0.6875rem]">
          <span className="text-foreground-soft">{t.updateConfirmDelete}</span>
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => deleteEventAnnouncement(update.id), () => setConfirmDelete(false))}
            className={`${small} bg-danger font-medium text-white`}
          >
            {t.updateDelete}
          </button>
          <button type="button" disabled={isPending} onClick={() => setConfirmDelete(false)} className={`${small} border border-line`}>
            {ui.cancel}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </li>
  );
}
