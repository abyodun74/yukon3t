"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Circle as RecordIcon, Download, Eye, Users } from "lucide-react";
import type { DailyParticipant } from "@daily-co/daily-js";
import { useCallSession } from "@/lib/call-session";
import {
  joinLiveStream,
  leaveLiveStream,
  endLiveStream,
  getLiveStreamViewerCount,
  getLiveStreamStageUserIds,
  listLiveStreamRecordings,
  getLiveStreamRecordingLink,
} from "@/app/actions/live-streams";
import { usePolling } from "@/lib/use-polling";

const POLL_INTERVAL_MS = 5000;

type ActiveRoom = { roomUrl: string; token: string };
type StageRole = "GUEST" | "COHOST";
type Role = "VIEWER" | StageRole;
type Recording = { id: string; startedAt: number; durationSeconds: number | null };

function joinErrorMessage(code?: string) {
  switch (code) {
    case "not_configured":
      return "Live streaming isn't set up yet.";
    case "not_a_member":
      return "Join that Circle first to watch this stream.";
    case "not_found":
      return "This stream has ended.";
    case "rate_limited":
      return "Slow down a little and try again.";
    default:
      return "Couldn't join the stream — try again.";
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
 * Captures a single frame of the current tab via the Screen Capture API and
 * downloads it as a PNG. Daily's call UI renders inside a cross-origin
 * iframe (see CallFrame), so its pixels can't be read with a plain
 * <canvas>.drawImage of the page — grabbing the tab itself is the only way
 * to screenshot it short of a full custom (non-prebuilt) video UI.
 */
async function captureScreenshot(filenameHint: string) {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
  try {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filenameHint}-${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(url);
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

/** Host-broadcasts/viewers-watch live room, plus up to 3 guest/co-host stage slots (see joinLiveStream's owner_only_broadcast + permissions.canSend). */
export function LiveStreamRoom({
  liveStreamId,
  isHost,
  title,
  initiallyEnded,
}: {
  liveStreamId: string;
  isHost: boolean;
  title: string;
  initiallyEnded: boolean;
}) {
  const [phase, setPhase] = useState<"choosing" | "joining" | "active" | "error">(
    initiallyEnded ? "error" : isHost ? "joining" : "choosing",
  );
  const [active, setActive] = useState<ActiveRoom | null>(null);
  const [role, setRole] = useState<Role>("VIEWER");
  const [error, setError] = useState<string | null>(initiallyEnded ? "not_found" : null);
  const [chooserError, setChooserError] = useState<string | null>(null);
  const [viewerCount, setViewerCount] = useState(0);
  const [stageCount, setStageCount] = useState(0);
  const [stageCapacity, setStageCapacity] = useState(3);
  const [recording, setRecording] = useState(false);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [showRecordings, setShowRecordings] = useState(false);
  const [fetchingLinkId, setFetchingLinkId] = useState<string | null>(null);
  const [screenshotBusy, setScreenshotBusy] = useState(false);
  const router = useRouter();
  const { dailyCall, startSession } = useCallSession();
  const stageUserIdsRef = useRef<Set<string>>(new Set());

  // Split from doJoin below: this only fires the request and reacts to its
  // result inside the .then() callback, so the effect that calls it (for the
  // host's auto-join) never sets state synchronously in the effect body —
  // just from that async callback, which is the pattern React's hooks lint
  // rule wants.
  const requestJoin = useCallback(
    (selectedRole?: StageRole) => {
      joinLiveStream(liveStreamId, selectedRole).then((result) => {
        if (result.error === "stage_full") {
          setChooserError("That stage just filled up — try watching instead.");
          setPhase("choosing");
          return;
        }
        if (result.error || !result.roomUrl || !result.token) {
          setError(result.error ?? "unknown");
          setPhase("error");
          return;
        }
        setRole(result.role ?? "VIEWER");
        setActive({ roomUrl: result.roomUrl, token: result.token });
        setPhase("active");
      });
    },
    [liveStreamId],
  );

  function doJoin(selectedRole?: StageRole) {
    setChooserError(null);
    setPhase("joining");
    requestJoin(selectedRole);
  }

  useEffect(() => {
    if (initiallyEnded || !isHost) return;
    requestJoin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveStreamId, initiallyEnded, isHost]);

  const poll = useCallback(async () => {
    const [{ count, stageCount: sc, stageCapacity: cap }, { recordings: recs }] = await Promise.all([
      getLiveStreamViewerCount(liveStreamId),
      listLiveStreamRecordings(liveStreamId),
    ]);
    setViewerCount(count);
    setStageCount(sc);
    setStageCapacity(cap);
    setRecordings(recs);

    if (isHost) {
      const { userIds } = await getLiveStreamStageUserIds(liveStreamId);
      stageUserIdsRef.current = new Set(userIds);
    }
  }, [liveStreamId, isHost]);

  usePolling(poll, POLL_INTERVAL_MS, phase !== "joining");

  // owner_only_broadcast (see createLiveStreamRoom) can only be lifted for a
  // participant by the actual room owner acting live — a joiner's own token
  // can't grant it to themselves (Daily's meeting-tokens API has no
  // per-participant permissions override). The host cross-references each
  // Daily participant's user_id (== our User.id) against stageUserIdsRef
  // (kept fresh by poll()) and grants canSend to anyone holding a GUEST/
  // COHOST stage slot.
  useEffect(() => {
    if (!isHost || !dailyCall) return;

    function grantIfEligible(p: DailyParticipant) {
      if (p.local || p.permissions.canSend === true) return;
      if (!stageUserIdsRef.current.has(p.user_id)) return;
      dailyCall!.updateParticipant(p.session_id, { updatePermissions: { canSend: true } });
    }

    async function handleJoined(ev: { participant: DailyParticipant }) {
      const p = ev.participant;
      if (p.local || p.permissions.canSend === true) return;
      if (!stageUserIdsRef.current.has(p.user_id)) {
        // Poll may not have caught up yet — fetch fresh rather than miss the grant.
        const { userIds } = await getLiveStreamStageUserIds(liveStreamId);
        stageUserIdsRef.current = new Set(userIds);
      }
      grantIfEligible(p);
    }

    Object.values(dailyCall.participants()).forEach(grantIfEligible);
    dailyCall.on("participant-joined", handleJoined);
    return () => {
      dailyCall.off("participant-joined", handleJoined);
    };
  }, [isHost, dailyCall, liveStreamId]);

  // Recording state used to live inside CallFrame's onRecordingChange prop —
  // now that CallFrame only renders once, globally (GlobalCallFrame), this
  // subscribes to the same Daily events directly via the shared call object.
  useEffect(() => {
    if (!dailyCall) return;
    function onStarted() {
      setRecording(true);
    }
    function onStopped() {
      setRecording(false);
    }
    dailyCall.on("recording-started", onStarted);
    dailyCall.on("recording-stopped", onStopped);
    return () => {
      dailyCall.off("recording-started", onStarted);
      dailyCall.off("recording-stopped", onStopped);
    };
  }, [dailyCall]);

  async function handleLeave() {
    if (isHost) {
      await endLiveStream(liveStreamId);
    } else {
      await leaveLiveStream(liveStreamId);
    }
    setActive(null);
    router.push("/home");
  }

  // Hands the fullscreen/minimizable UI off to the root-mounted
  // GlobalCallFrame the moment we've joined the room (see call-session.tsx)
  // — LiveStreamRoom's own stage/chat/recording controls below stay
  // rendered as independently `fixed` overlays, which stack correctly on
  // top of GlobalCallFrame's video by z-index alone regardless of not being
  // DOM-nested inside it.
  useEffect(() => {
    if (!active) return;
    startSession({
      key: `live:${liveStreamId}`,
      roomUrl: active.roomUrl,
      token: active.token,
      type: "VIDEO",
      activeSpeakerMode: false,
      label: title,
      onLeave: handleLeave,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.roomUrl, active?.token, liveStreamId]);

  async function toggleRecording() {
    if (!dailyCall) return;
    if (recording) {
      await dailyCall.stopRecording();
    } else {
      await dailyCall.startRecording();
    }
  }

  async function handleScreenshot() {
    if (screenshotBusy) return;
    setScreenshotBusy(true);
    try {
      await captureScreenshot(title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "livestream");
    } catch {
      // user cancelled the screen-share picker, or the browser doesn't support it
    } finally {
      setScreenshotBusy(false);
    }
  }

  async function downloadRecording(recordingId: string) {
    setFetchingLinkId(recordingId);
    const result = await getLiveStreamRecordingLink(liveStreamId, recordingId);
    setFetchingLinkId(null);
    if (result.error || !result.url) return;
    window.open(result.url, "_blank", "noopener,noreferrer");
  }

  function renderRecordingsPanel(variant: "themed" | "dark") {
    if (recordings.length === 0) return null;
    const soft = variant === "dark" ? "text-white/70" : "text-foreground-soft";
    const border = variant === "dark" ? "border-white/20" : "border-line";
    return (
      <div className={`mt-3 border-t ${border} pt-3 text-left`}>
        <p className={`text-xs font-semibold uppercase tracking-wide ${soft}`}>Recordings</p>
        <ul className="mt-1.5 space-y-1">
          {recordings.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 text-xs">
              <span className={soft}>{formatRecordingLabel(r)}</span>
              <button
                type="button"
                disabled={fetchingLinkId === r.id}
                onClick={() => downloadRecording(r.id)}
                className={`flex shrink-0 items-center gap-1 rounded-md border ${border} px-2 py-1 font-medium hover:border-accent hover:text-accent disabled:opacity-50`}
              >
                <Download size={12} />
                {fetchingLinkId === r.id ? "Loading..." : "Get link"}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-sm text-foreground-soft">{joinErrorMessage(error ?? undefined)}</p>
        <button
          type="button"
          onClick={() => router.push("/home")}
          className="mt-4 rounded-lg border border-line px-3 py-1.5 text-sm font-medium hover:border-accent hover:text-accent"
        >
          Back to Home
        </button>
        {renderRecordingsPanel("themed")}
      </div>
    );
  }

  if (phase === "choosing") {
    const stageFull = stageCount >= stageCapacity;
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-xs text-foreground-soft">
          {stageCount}/{stageCapacity} co-host/guest spots filled
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => doJoin()}
            className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-ink"
          >
            Watch
          </button>
          <button
            type="button"
            disabled={stageFull}
            onClick={() => doJoin("GUEST")}
            className="rounded-lg border border-line px-3 py-2 text-sm font-medium hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            Join as guest
          </button>
          <button
            type="button"
            disabled={stageFull}
            onClick={() => doJoin("COHOST")}
            className="rounded-lg border border-line px-3 py-2 text-sm font-medium hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            Join as co-host
          </button>
        </div>
        {chooserError && <p className="mt-3 text-xs text-danger">{chooserError}</p>}
      </div>
    );
  }

  if (phase === "joining" || !active) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center text-sm text-foreground-soft">
        {isHost ? "Starting your live stream…" : "Joining live stream…"}
      </div>
    );
  }

  const canRecord = isHost || role === "COHOST";

  return (
    <>
      <div className="fixed left-3 top-3 z-[70] flex flex-wrap items-center gap-3 rounded-full bg-black/60 px-3 py-1.5 text-xs text-white">
        <span className="flex items-center gap-1 font-semibold text-danger">
          <span className="h-1.5 w-1.5 rounded-full bg-danger" />
          LIVE
        </span>
        <span className="max-w-[40vw] truncate">{title}</span>
        <span className="flex items-center gap-1" title="Watching">
          <Eye size={12} />
          {viewerCount}
        </span>
        <span className="flex items-center gap-1" title="On stage">
          <Users size={12} />
          {stageCount}/{stageCapacity}
        </span>
      </div>

      <div className="fixed top-3 z-[70] flex flex-col items-end gap-2" style={{ right: "0.75rem" }}>
        <div className="flex items-center gap-2">
          {canRecord && (
            <button
              type="button"
              onClick={toggleRecording}
              className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold text-white ${
                recording ? "bg-danger" : "bg-black/60"
              }`}
            >
              <RecordIcon size={10} className={recording ? "fill-white" : "fill-danger text-danger"} />
              {recording ? "Stop recording" : "Record"}
            </button>
          )}
          <button
            type="button"
            disabled={screenshotBusy}
            onClick={handleScreenshot}
            className="flex items-center gap-1 rounded-full bg-black/60 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            <Camera size={12} />
            Screenshot
          </button>
          {recordings.length > 0 && (
            <button
              type="button"
              onClick={() => setShowRecordings((v) => !v)}
              className="flex items-center gap-1 rounded-full bg-black/60 px-3 py-1.5 text-xs font-semibold text-white"
            >
              <Download size={12} />
              Recordings ({recordings.length})
            </button>
          )}
        </div>
        {showRecordings && recordings.length > 0 && (
          <div className="w-64 rounded-lg bg-black/80 p-3 text-white">{renderRecordingsPanel("dark")}</div>
        )}
      </div>
    </>
  );
}
