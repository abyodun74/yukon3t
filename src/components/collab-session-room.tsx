"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Upload, Video } from "lucide-react";
import {
  joinCollabSession,
  leaveCollabSession,
  getCollabSessionParticipants,
  listCollabRecordings,
  getCollabRecordingLink,
} from "@/app/actions/collab-session";
import { shareCollabMaterial } from "@/lib/collab-material";
import { useCallSession } from "@/lib/call-session";
import { usePolling } from "@/lib/use-polling";

const POLL_INTERVAL_MS = 5000;
const MATERIAL_ACCEPT =
  ".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,image/jpeg,image/png,image/webp";

type Participant = { id: string; name: string };
type Recording = { id: string; startedAt: number; durationSeconds: number | null };

function joinErrorMessage(code?: string) {
  switch (code) {
    case "not_configured":
      return "Live sessions aren't set up yet.";
    case "not_a_participant":
      return "Join this collaboration first to start the session.";
    case "not_started":
      return "The organizer or a co-admin hasn't started this session yet.";
    case "rate_limited":
      return "Slow down a little and try again.";
    default:
      return "Couldn't join the session — try again.";
  }
}

function formatRecordingLabel(recording: Recording) {
  const date = new Date(recording.startedAt * 1000).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const minutes = recording.durationSeconds ? Math.round(recording.durationSeconds / 60) : null;
  return minutes ? `${date} · ${minutes} min` : date;
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
}) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [joined, setJoined] = useState(false);
  const [confirmingJoin, setConfirmingJoin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [fetchingLinkId, setFetchingLinkId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const { startSession, dailyCall } = useCallSession();

  const collabIdRef = useRef(collabId);
  useEffect(() => {
    collabIdRef.current = collabId;
  });

  const poll = useCallback(async () => {
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

  usePolling(poll, POLL_INTERVAL_MS, !joined);

  // Live presence (from polling) covers the case where the organizer just
  // started it during this page view; hasSessionRoom covers "started before,
  // everyone's since left" — either one means there's something to join.
  const sessionActive = participants.length > 0 || hasSessionRoom;

  async function doJoin() {
    setError(null);
    const result = await joinCollabSession(collabId);
    if (result.error || !result.roomUrl || !result.token) {
      setError(joinErrorMessage(result.error ?? undefined));
      return;
    }
    setJoined(true);
    // Hands off to the root-mounted GlobalCallFrame — it always mounts
    // fullscreen (see global-call-frame.tsx), only shrinking to the corner
    // widget if the participant explicitly hits its Minimize button, never
    // on join.
    startSession({
      key: `collab:${collabId}`,
      roomUrl: result.roomUrl,
      token: result.token,
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
    doJoin();
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
      setError(
        result.error === "upload_failed"
          ? "Couldn't upload that file — try again."
          : "Uploaded, but couldn't share it in chat — try again.",
      );
    }
  }

  async function downloadRecording(recordingId: string) {
    setFetchingLinkId(recordingId);
    const result = await getCollabRecordingLink(collabId, recordingId);
    setFetchingLinkId(null);
    if (result.error || !result.url) {
      setError("Couldn't get that recording's link — try again.");
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
            <span className="text-foreground-soft">No one&apos;s in the session</span>
          ) : (
            <span>
              {participants.length} in session:{" "}
              <span className="text-foreground-soft">{participants.map((p) => p.name).join(", ")}</span>
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
                  onChange={(e) => uploadMaterial(e.target.files?.[0])}
                />
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                  title="Upload material to share with participants"
                  className="flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:border-accent hover:text-accent disabled:opacity-50"
                >
                  <Upload size={14} />
                  {uploading ? "Uploading…" : "Upload material"}
                </button>
              </>
            )}
            {canStart || sessionActive ? (
              <button
                type="button"
                onClick={join}
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink"
              >
                {canStart ? "Start session" : "Join session"}
              </button>
            ) : (
              <span className="text-xs text-foreground-soft">
                Waiting for the organizer to start the session
              </span>
            )}
          </div>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}

      {recordings.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground-soft">Recordings</p>
          <ul className="mt-1.5 space-y-1">
            {recordings.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-foreground-soft">{formatRecordingLabel(r)}</span>
                <button
                  type="button"
                  disabled={fetchingLinkId === r.id}
                  onClick={() => downloadRecording(r.id)}
                  className="flex shrink-0 items-center gap-1 rounded-md border border-line px-2 py-1 font-medium hover:border-accent hover:text-accent disabled:opacity-50"
                >
                  <Download size={12} />
                  {fetchingLinkId === r.id ? "Loading..." : "Get link"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {confirmingJoin && (
        <div className="animate-modal-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="animate-modal-panel-in w-full max-w-xs rounded-xl bg-surface p-5 text-center">
            <p className="text-sm font-medium">A session is already in progress</p>
            <p className="mt-1 text-sm text-foreground-soft">
              {participants.map((p) => p.name).join(", ")}{" "}
              {participants.length === 1 ? "is" : "are"} already in this session. Ready to join?
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={confirmJoin}
                className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink"
              >
                Yes, join now
              </button>
              <button
                type="button"
                onClick={() => setConfirmingJoin(false)}
                className="w-full rounded-lg border border-line px-4 py-2 text-sm font-medium hover:border-accent hover:text-accent"
              >
                Leave — not now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
