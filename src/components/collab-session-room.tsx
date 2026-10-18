"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Download, Upload, Video } from "lucide-react";
import {
  joinCollabSession,
  startCollabSession,
  leaveCollabSession,
  getCollabSessionParticipants,
  listCollabRecordings,
  getCollabRecordingLink,
} from "@/app/actions/collab-session";
import { shareCollabMaterial } from "@/lib/collab-material";
import { useCallSession } from "@/lib/call-session";
import { useRealtimeEvent } from "@/lib/realtime-client";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";
import { markNativePickerActive, markNativePickerInactive, isNativePickerActive } from "@/lib/native-picker-activity";
import { Sheet } from "@/components/sheet";
import { MultiSelect } from "@/components/multi-select";
import { COLLAB_CIRCLE_IDS_MAX, COLLAB_CIRCLE_INVITE_MAX } from "@/lib/collab-circle-invite";
import { useCollabText } from "@/components/collab-text";
import { useUiText } from "@/components/ui-text";
import { byCode, format, intlLocale, plural, type Locale } from "@/lib/i18n/locales";

const MATERIAL_ACCEPT =
  ".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,image/jpeg,image/png,image/webp";

type Participant = { id: string; name: string };
type Option = { value: string; label: string };
type Recording = { id: string; startedAt: number; durationSeconds: number | null };

function formatRecordingLabel(recording: Recording, locale: Locale, withMinutes: string) {
  const date = new Date(recording.startedAt * 1000).toLocaleString(intlLocale(locale) ?? [], {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const minutes = recording.durationSeconds ? Math.round(recording.durationSeconds / 60) : null;
  return minutes ? format(withMinutes, { date, minutes }) : date;
}

/** startCollabSession's refusals from its invite step, which leave nothing written. */
function isInviteError(error: string | null) {
  return error === "rate_limited" || error === "forbidden" || error === "too_large" || error === "invalid";
}

/**
 * Keeps Tab inside a modal's content: from its last focusable control Tab wraps to the first, and Shift+Tab from the
 * first wraps to the last. Sheet itself moves focus in, gives it back and handles Escape (useDialogFocus).
 */
function trapTab(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== "Tab") return;
  const focusable = [
    ...e.currentTarget.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    ),
  ];
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * Persistent, drop-in group video session for a Collab — screen share (every
 * participant, not just the organizer, since createCollabRoom's
 * enable_screenshare applies room-wide), in-call chat, emoji reactions,
 * hand-raising, and cloud recording all come for free from Daily's prebuilt
 * call UI (see CallFrame + createCollabRoom), no bespoke WebRTC UI needed
 * here. The call itself is handed off to the app-wide CallSessionProvider/
 * GlobalCallFrame (src/lib/call-session.tsx) the moment it's joined, so it
 * opens fullscreen and survives navigation, same as a 1:1 call — this
 * component only ever renders the pre-join card and the join-in-progress
 * confirm dialog.
 */
export function CollabSessionRoom({
  collabId,
  canJoin,
  canStart,
  hasSessionRoom,
  title,
  conversationId,
  startOptions = null,
}: {
  collabId: string;
  canJoin: boolean;
  /** Organizer or co-admin — the only roles allowed to start a session from cold (see joinCollabSession). Everyone else can only join one already underway. */
  canStart: boolean;
  /** Whether this collab's session room has ever been started — a regular participant needs this to know there's something to join. */
  hasSessionRoom: boolean;
  /** Shown in the minimized call widget once the session is joined. */
  title: string;
  /** The Collab's own group chat — "Upload material" posts shared files here. Every CollabBoardPost gets one at creation (see createCollabPost), so this is really only ever null defensively. */
  conversationId: string | null;
  /**
   * PRIVATE collab, organizer/co-admin only: starting a session nobody's in opens the "Start session" sheet (notify
   * participants, optionally invite more connections or Circles they created) instead of joining straight away. Same
   * candidates as CollabInviteManager. Null for a PUBLIC collab, where Start stays one tap.
   */
  startOptions?: { candidates: Option[]; circleCandidates: Option[] } | null;
}) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [joined, setJoined] = useState(false);
  const [confirmingJoin, setConfirmingJoin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [fetchingLinkId, setFetchingLinkId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [startSheetOpen, setStartSheetOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { startSession, dailyCall } = useCallSession();
  const { locale, t: collab } = useCollabText();
  const t = collab.session;
  const { t: ui } = useUiText();
  const names = participants.map((p) => p.name).join(ui.listSeparator);

  const collabIdRef = useRef(collabId);
  useEffect(() => {
    collabIdRef.current = collabId;
  });

  const refetch = useCallback(async () => {
    const forId = collabIdRef.current;
    const [{ participants: list }, { recordings: recs }] = await Promise.all([
      getCollabSessionParticipants(forId),
      listCollabRecordings(forId),
    ]);
    if (collabIdRef.current === forId) {
      setParticipants(list);
      setRecordings(recs);
    }
  }, []);

  // Fires immediately on mount/collab-switch (a realtime subscription alone
  // only reports *new* signals, not current state) and again on every
  // "changed" broadcast from here on — join/leave publish onto this
  // collab's own collab-session:{id} topic (see actions/collab-session.ts).
  // Ref indirection avoids a "setState synchronously within an effect" lint
  // false-positive, same pattern as every other realtime migration in this
  // app. Stops entirely once joined — same as the old poll's own !joined
  // gate, since GlobalCallFrame's own Daily integration shows live
  // participants directly once actually in the session.
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  });
  useEffect(() => {
    if (!joined) refetchRef.current();
  }, [collabId, joined]);
  useRealtimeEvent(!joined ? REALTIME_CHANNELS.collabSession(collabId) : null, "changed", refetch);

  // Live presence (from polling) covers the case where the organizer just
  // started it during this page view; hasSessionRoom covers "started before,
  // everyone's since left" — either one means there's something to join.
  const sessionActive = participants.length > 0 || hasSessionRoom;

  async function doJoin() {
    setError(null);
    const result = await joinCollabSession(collabId);
    if (result.error || !result.roomUrl || !result.token) {
      setError(byCode(t.joinErrors, result.error));
      return;
    }
    enterSession(result.roomUrl, result.token);
  }

  function enterSession(roomUrl: string, token: string) {
    setJoined(true);
    // Hands off to the root-mounted GlobalCallFrame — it always mounts
    // fullscreen (see global-call-frame.tsx), only shrinking to the corner
    // widget if the participant explicitly hits its Minimize button, never
    // on join.
    startSession({
      key: `collab:${collabId}`,
      roomUrl,
      token,
      type: "VIDEO",
      label: title,
      // Lets GlobalCallFrame offer "Upload material" and the shared-
      // material overlay while fullscreen, where this card is covered up
      // and unreachable — see collab-material.ts.
      collab: conversationId ? { collabId, conversationId } : undefined,
      onLeave: () => {
        leaveCollabSession(collabId);
        setJoined(false);
      },
    });
  }

  // Starting a session nobody's in yet needs no confirmation — clicking the
  // button already *is* the "ready to join" answer. Walking into one already
  // underway is a bigger interruption (camera/mic about to go live in front
  // of people already mid-conversation), so that path alone gets a
  // lightweight "ready to join, or leave it?" prompt instead of Daily's own
  // prejoin lobby (disabled room-wide, see createCollabRoom).
  function join() {
    if (participants.length > 0) {
      setConfirmingJoin(true);
      return;
    }
    // A PRIVATE collab's organizer/co-admin gets one more step before going
    // live: who to tell, and who else to bring in. Skipping both pickers is
    // still just "Start".
    if (canStart && startOptions) {
      setStartError(null);
      setStartSheetOpen(true);
      return;
    }
    doJoin();
  }

  async function submitStart(fd: FormData) {
    setStartError(null);
    setNotice(null);
    setStarting(true);
    const userIds = fd.getAll("inviteeIds").map(String);
    let result: Awaited<ReturnType<typeof startCollabSession>>;
    try {
      result = await startCollabSession(collabId, {
        notify: fd.get("notify") === "on",
        userIds,
        circleIds: fd.getAll("circleIds").map(String),
      });
    } catch {
      setStarting(false);
      setStartError(t.startSheet.errors.other);
      return;
    }
    setStarting(false);
    if (result.circleNames.length > 0) {
      setNotice(
        result.invited > 0
          ? format(plural(locale, collab.invites.circleInvited, result.invited), {
              circles: result.circleNames.join(ui.listSeparator),
            })
          : collab.invites.circleNoneNew,
      );
    }
    // Invites can have gone out even when joining afterwards failed (an
    // invite error itself writes nothing) — the Invited list on this page
    // needs to show them either way.
    const invitesSent = (userIds.length > 0 || result.circleNames.length > 0) && !isInviteError(result.error);
    if (result.error || !result.roomUrl || !result.token) {
      setStartError(
        result.error === "too_large"
          ? format(t.startSheet.errors.too_large, { max: COLLAB_CIRCLE_INVITE_MAX })
          : byCode(t.startSheet.errors, result.error),
      );
      if (invitesSent) router.refresh();
      return;
    }
    setStartSheetOpen(false);
    enterSession(result.roomUrl, result.token);
    if (invitesSent) router.refresh();
  }

  function confirmJoin() {
    setConfirmingJoin(false);
    doJoin();
  }

  async function uploadMaterial(file: File | undefined) {
    if (!file || !conversationId) return;
    setError(null);
    setUploading(true);
    // Also broadcasts to the live call (see shareCollabMaterial) if one's
    // active and this card hasn't been covered up by it yet — e.g.
    // uploading right before starting, or while minimized.
    const result = await shareCollabMaterial({ file, conversationId, dailyCall });
    setUploading(false);
    if (!result.ok) {
      setError(byCode(t.errors, result.error));
    }
  }

  async function downloadRecording(recordingId: string) {
    setFetchingLinkId(recordingId);
    const result = await getCollabRecordingLink(collabId, recordingId);
    setFetchingLinkId(null);
    if (result.error || !result.url) {
      setError(t.linkError);
      return;
    }
    window.open(result.url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <Video size={16} className="text-foreground-soft" />
          {participants.length === 0 ? (
            <span className="text-foreground-soft">{t.empty}</span>
          ) : (
            <span>
              {plural(locale, t.inSession, participants.length)}{" "}
              <span dir="auto" className="text-foreground-soft">
                {names}
              </span>
            </span>
          )}
        </div>
        {canJoin && !joined && (
          <div className="flex shrink-0 items-center gap-2">
            {conversationId && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={MATERIAL_ACCEPT}
                  className="hidden"
                  onChange={(e) => {
                    markNativePickerInactive();
                    uploadMaterial(e.target.files?.[0]);
                  }}
                />
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => {
                    if (isNativePickerActive()) return;
                    markNativePickerActive();
                    fileInputRef.current?.click();
                  }}
                  title={t.uploadHint}
                  className="flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:border-accent hover:text-accent disabled:opacity-50"
                >
                  <Upload size={14} />
                  {uploading ? t.uploading : t.upload}
                </button>
              </>
            )}
            {canStart || sessionActive ? (
              <button
                type="button"
                onClick={join}
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink"
              >
                {canStart ? t.start : t.join}
              </button>
            ) : (
              <span className="text-xs text-foreground-soft">
                {t.waiting}
              </span>
            )}
          </div>
        )}
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
      {notice && <p role="status" className="mt-2 text-xs text-foreground-soft">{notice}</p>}

      {recordings.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground-soft">{t.recordings}</p>
          <ul className="mt-1.5 space-y-1">
            {recordings.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-foreground-soft">{formatRecordingLabel(r, locale, t.recording)}</span>
                <button
                  type="button"
                  disabled={fetchingLinkId === r.id}
                  onClick={() => downloadRecording(r.id)}
                  className="flex shrink-0 items-center gap-1 rounded-md border border-line px-2 py-1 font-medium hover:border-accent hover:text-accent disabled:opacity-50"
                >
                  <Download size={12} />
                  {fetchingLinkId === r.id ? t.loading : t.getLink}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {startOptions && (
        <Sheet
          open={startSheetOpen}
          onClose={() => {
            if (!starting) setStartSheetOpen(false);
          }}
          ariaLabel={t.startSheet.title}
          panelClassName="max-w-md"
        >
          {/* No Sheet title, so no header Close button outside the trapped
              form: Cancel (and Escape) is the way out. */}
          <form
            onKeyDown={trapTab}
            onSubmit={(e) => {
              // A plain submit handler, not a form action: "Starting…" has to
              // show while the request runs, and an action's state updates
              // only land once it has finished.
              e.preventDefault();
              if (!starting) submitStart(new FormData(e.currentTarget));
            }}
            className="space-y-4"
          >
            <h2 className="text-sm font-semibold">{t.startSheet.title}</h2>
            <div>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  name="notify"
                  defaultChecked
                  aria-describedby="collab-start-notify-hint"
                  className="h-4 w-4 rounded border-line accent-accent"
                />
                {t.startSheet.notify}
              </label>
              <p id="collab-start-notify-hint" className="mt-0.5 text-xs text-foreground-soft">
                {t.startSheet.notifyHint}
              </p>
            </div>
            {startOptions.candidates.length > 0 && (
              <div>
                <span className="block text-xs font-medium text-foreground-soft">{t.startSheet.inviteMore}</span>
                <div className="mt-1">
                  <MultiSelect
                    name="inviteeIds"
                    options={startOptions.candidates}
                    placeholder={collab.invites.placeholder}
                    labels={collab.controls.multiSelect}
                  />
                </div>
              </div>
            )}
            {startOptions.circleCandidates.length > 0 && (
              <div>
                <span className="block text-xs font-medium text-foreground-soft">{t.startSheet.inviteCircles}</span>
                <p className="mt-0.5 text-xs text-foreground-soft">{collab.invites.circleHint}</p>
                <div className="mt-1">
                  <MultiSelect
                    name="circleIds"
                    options={startOptions.circleCandidates}
                    placeholder={collab.invites.circlePlaceholder}
                    max={COLLAB_CIRCLE_IDS_MAX}
                    labels={collab.controls.multiSelect}
                  />
                </div>
              </div>
            )}
            {startError && <p role="alert" className="text-xs text-danger">{startError}</p>}
            <div className="flex flex-col gap-2">
              <button
                type="submit"
                disabled={starting}
                className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-50"
              >
                {starting ? t.startSheet.starting : t.startSheet.start}
              </button>
              <button
                type="button"
                disabled={starting}
                onClick={() => setStartSheetOpen(false)}
                className="w-full rounded-lg border border-line px-4 py-2 text-sm font-medium hover:border-accent hover:text-accent disabled:opacity-50"
              >
                {t.startSheet.cancel}
              </button>
            </div>
          </form>
        </Sheet>
      )}

      <Sheet
        open={confirmingJoin}
        onClose={() => setConfirmingJoin(false)}
        panelClassName="max-w-xs text-center"
        ariaLabel={t.inProgress}
      >
        <p className="text-sm font-medium">{t.inProgress}</p>
        <p className="mt-1 text-sm text-foreground-soft">
          {format(participants.length === 1 ? t.alreadyOne : t.alreadyMany, { names })}
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            onClick={confirmJoin}
            className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink"
          >
            {t.joinNow}
          </button>
          <button
            type="button"
            onClick={() => setConfirmingJoin(false)}
            className="w-full rounded-lg border border-line px-4 py-2 text-sm font-medium hover:border-accent hover:text-accent"
          >
            {t.notNow}
          </button>
        </div>
      </Sheet>
    </div>
  );
}
