"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Video } from "lucide-react";
import {
  joinCollabSession,
  leaveCollabSession,
  getCollabSessionParticipants,
  listCollabRecordings,
  getCollabRecordingLink,
} from "@/app/actions/collab-session";
import { CallFrame } from "@/components/call-frame";
import { usePolling } from "@/lib/use-polling";

const POLL_INTERVAL_MS = 5000;

type Participant = { id: string; name: string };
type ActiveRoom = { roomUrl: string; token: string };
type Recording = { id: string; startedAt: number; durationSeconds: number | null };

function joinErrorMessage(code?: string) {
  switch (code) {
    case "not_configured":
      return "Live sessions aren't set up yet.";
    case "not_a_participant":
      return "Join this collaboration first to start the session.";
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
 * Persistent, drop-in group video session for a Collab — screen share,
 * in-call chat, emoji reactions, hand-raising, and cloud recording all come
 * for free from Daily's prebuilt call UI (see CallFrame + createCollabRoom),
 * no bespoke WebRTC UI needed here.
 */
export function CollabSessionRoom({ collabId, canJoin }: { collabId: string; canJoin: boolean }) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [active, setActive] = useState<ActiveRoom | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [fetchingLinkId, setFetchingLinkId] = useState<string | null>(null);

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

  usePolling(poll, POLL_INTERVAL_MS, !active);

  async function join() {
    setError(null);
    const result = await joinCollabSession(collabId);
    if (result.error || !result.roomUrl || !result.token) {
      setError(joinErrorMessage(result.error ?? undefined));
      return;
    }
    setActive({ roomUrl: result.roomUrl, token: result.token });
  }

  function leave() {
    leaveCollabSession(collabId);
    setActive(null);
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
      <div className="flex items-center justify-between gap-3">
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
        {canJoin && !active && (
          <button
            type="button"
            onClick={join}
            className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink"
          >
            Start / join session
          </button>
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

      {active && (
        <CallFrame roomUrl={active.roomUrl} token={active.token} type="VIDEO" onLeave={leave} />
      )}
    </div>
  );
}
