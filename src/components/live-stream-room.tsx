"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, Circle as RecordIcon, Download, Eye, Users, X } from "lucide-react";
import type { DailyParticipant } from "@daily-co/daily-js";
import { useCallSession } from "@/lib/call-session";
import {
  joinLiveStream,
  leaveLiveStream,
  endLiveStream,
  getLiveStreamViewerCount,
  getLiveStreamStageUserIds,
  getLiveStreamStageRequests,
  respondToStageRequest,
  cancelStageRequest,
  getMyLiveStreamStatus,
  listLiveStreamRecordings,
  getLiveStreamRecordingLink,
  recordLiveStreamHeartbeat,
} from "@/app/actions/live-streams";
import { isStaleDeploymentError, STALE_DEPLOYMENT_MESSAGE } from "@/lib/stale-deployment";
import { usePolling } from "@/lib/use-polling";

const POLL_INTERVAL_MS = 5000;

type ActiveRoom = { roomUrl: string; token: string };
type StageRole = "GUEST" | "COHOST";
type Role = "VIEWER" | StageRole;
type Recording = { id: string; startedAt: number; durationSeconds: number | null };
type StageRequest = {
  id: string;
  role: StageRole;
  user: { id: string; name: string | null; avatarUrl: string | null };
};

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
    case "unavailable":
    case "network":
      return "Couldn't connect — check your connection and try again.";
    case "stale_deployment":
      return STALE_DEPLOYMENT_MESSAGE;
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
  const [viewerCount, setViewerCount] = useState(0);
  const [stageCount, setStageCount] = useState(0);
  const [stageCapacity, setStageCapacity] = useState(3);
  const [recording, setRecording] = useState(false);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [showRecordings, setShowRecordings] = useState(false);
  const [fetchingLinkId, setFetchingLinkId] = useState<string | null>(null);
  const [screenshotBusy, setScreenshotBusy] = useState(false);
  // Non-null while this participant has asked for a stage slot and the host
  // hasn't decided yet — drives the "waiting for approval" banner below.
  const [pendingStageRole, setPendingStageRole] = useState<StageRole | null>(null);
  const [cancellingRequest, setCancellingRequest] = useState(false);
  // Shown once, right at the moment a pending request flips to DECLINED (see
  // the PENDING→DECLINED transition check in poll below) — not derived
  // straight from server state, since that would keep re-showing it forever
  // on every subsequent poll tick.
  const [declinedNotice, setDeclinedNotice] = useState(false);
  // Host-only: who's currently asking for a stage slot.
  const [stageRequests, setStageRequests] = useState<StageRequest[]>([]);
  const [respondingRequestId, setRespondingRequestId] = useState<string | null>(null);
  const router = useRouter();
  const { dailyCall, startSession } = useCallSession();
  const stageUserIdsRef = useRef<Set<string>>(new Set());
  const lastRequestStatusRef = useRef<"PENDING" | "APPROVED" | "DECLINED" | null>(null);

  // Split from doJoin below: this only fires the request and reacts to its
  // result inside the .then() callback, so the effect that calls it (for the
  // host's auto-join) never sets state synchronously in the effect body —
  // just from that async callback, which is the pattern React's hooks lint
  // rule wants.
  const requestJoin = useCallback(
    (selectedRole?: StageRole) => {
      joinLiveStream(liveStreamId, selectedRole)
        .then((result) => {
          if (result.error || !result.roomUrl || !result.token) {
            setError(result.error ?? "unknown");
            setPhase("error");
            return;
          }
          setRole(result.role ?? "VIEWER");
          setPendingStageRole(result.pendingStageRequest ?? null);
          setDeclinedNotice(false);
          setActive({ roomUrl: result.roomUrl, token: result.token });
          setPhase("active");
        })
        .catch((err) => {
          // A rejected call (network drop, or the Server Action itself
          // throwing — e.g. a transient DB hiccup, see live-streams.ts's
          // own hardening) used to leave this screen stuck on "Joining
          // live stream…" forever, since nothing here ever ran without a
          // .catch(). Confirmed live: a real user's screen sat on that
          // loading text indefinitely with no way forward but leaving the
          // page. Route it through the same error phase as a normal
          // {error: ...} result, with a retry action, instead.
          //
          // A stale Server Action id (this tab's been open since before a
          // redeploy) is its own case, not ordinary flakiness — retrying
          // never helps, only a refresh does, since the old action id will
          // never be found again. post-composer.tsx hit this exact failure
          // mode first ("the entire cause of a burst of 'couldn't reach the
          // server' reports during a run of back-to-back deploys" per
          // stale-deployment.ts's own comment) — same fix here.
          setError(isStaleDeploymentError(err) ? "stale_deployment" : "network");
          setPhase("error");
        });
    },
    [liveStreamId],
  );

  function doJoin(selectedRole?: StageRole) {
    setPhase("joining");
    requestJoin(selectedRole);
  }

  useEffect(() => {
    if (initiallyEnded || !isHost) return;
    requestJoin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveStreamId, initiallyEnded, isHost]);

  function doCancelRequest() {
    if (cancellingRequest) return;
    setCancellingRequest(true);
    cancelStageRequest(liveStreamId)
      .then(() => {
        setCancellingRequest(false);
        setPendingStageRole(null);
        lastRequestStatusRef.current = null;
      })
      // Without this, a rejected call left `cancellingRequest` true
      // forever — the Cancel button permanently disabled with no way to
      // retry short of leaving the page. Same class of bug as
      // requestJoin's missing .catch() above: just re-enable and let them
      // try again.
      .catch(() => setCancellingRequest(false));
  }

  function respondToRequest(requestId: string, approve: boolean) {
    if (respondingRequestId) return;
    setRespondingRequestId(requestId);
    respondToStageRequest(requestId, approve)
      .then((result) => {
        setRespondingRequestId(null);
        // Drop it from the list optimistically either way — a "stage_full"
        // rejection on approve still means this particular request is done
        // (declined by capacity), and the next poll tick will re-add it if
        // that assumption was somehow wrong.
        if (!result.error || result.error === "stage_full") {
          setStageRequests((prev) => prev.filter((r) => r.id !== requestId));
        }
      })
      // Same reasoning as doCancelRequest above — a rejected call must
      // still clear respondingRequestId, or these Approve/Decline buttons
      // stay disabled forever for this request.
      .catch(() => setRespondingRequestId(null));
  }

  const poll = useCallback(async () => {
    const [{ count, stageCount: sc, stageCapacity: cap }, { recordings: recs }] = await Promise.all([
      getLiveStreamViewerCount(liveStreamId),
      listLiveStreamRecordings(liveStreamId),
    ]);
    setViewerCount(count);
    setStageCount(sc);
    setStageCapacity(cap);
    setRecordings(recs);

    if (isHost || role === "COHOST") {
      recordLiveStreamHeartbeat(liveStreamId);
    }

    if (isHost) {
      const [{ userIds }, { requests }] = await Promise.all([
        getLiveStreamStageUserIds(liveStreamId),
        getLiveStreamStageRequests(liveStreamId),
      ]);
      stageUserIdsRef.current = new Set(userIds);
      setStageRequests(requests);
    } else {
      const status = await getMyLiveStreamStatus(liveStreamId);
      setRole(status.role);
      const prevStatus = lastRequestStatusRef.current;
      lastRequestStatusRef.current = status.requestStatus;
      if (status.requestStatus === "PENDING") {
        setPendingStageRole(status.requestedRole);
      } else {
        setPendingStageRole(null);
        if (status.requestStatus === "DECLINED" && prevStatus === "PENDING") {
          setDeclinedNotice(true);
        }
      }
    }
  }, [liveStreamId, isHost, role]);

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
        <div className="mt-4 flex items-center justify-center gap-2">
          {error === "stale_deployment" ? (
            // Retrying with the same "Try again" click would just hit the
            // exact same already-gone Server Action id again — only a real
            // reload picks up the new deployment's JS bundle.
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink"
            >
              Refresh
            </button>
          ) : (
            // Most of what lands here (a dropped connection, the transient
            // DB hiccup live-streams.ts now guards against) is worth a
            // plain retry, not a trip back to Home — host retries the same
            // auto-join; a viewer/requester goes back to "choosing" since
            // their exact prior selection (watch/guest/co-host) isn't
            // tracked in state.
            <button
              type="button"
              onClick={() => {
                setError(null);
                if (isHost) {
                  setPhase("joining");
                  requestJoin();
                } else {
                  setPhase("choosing");
                }
              }}
              className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink"
            >
              Try again
            </button>
          )}
          <button
            type="button"
            onClick={() => router.push("/home")}
            className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium hover:border-accent hover:text-accent"
          >
            Back to Home
          </button>
        </div>
        {renderRecordingsPanel("themed")}
      </div>
    );
  }

  if (phase === "choosing") {
    const stageFull = stageCount >= stageCapacity;
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="break-words text-sm font-medium">{title}</p>
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
            onClick={() => doJoin("GUEST")}
            className="rounded-lg border border-line px-3 py-2 text-sm font-medium hover:border-accent hover:text-accent"
          >
            Ask to join as guest
          </button>
          <button
            type="button"
            onClick={() => doJoin("COHOST")}
            className="rounded-lg border border-line px-3 py-2 text-sm font-medium hover:border-accent hover:text-accent"
          >
            Ask to join as co-host
          </button>
        </div>
        <p className="mt-3 text-[11px] text-foreground-soft">
          {stageFull
            ? "The stage is full right now, but you can still ask — a spot may open up."
            : "The host approves guest/co-host requests before you go live on stage."}
        </p>
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
      {/* A single wrapping flex row, not two independently `fixed` corners —
          the old left-anchored info pill and right-anchored button column
          had no shared container, so nothing stopped them overlapping once
          their combined content (title + counts + Record/Screenshot/stage-
          request panel) didn't fit side by side — confirmed on a real phone
          screenshot (~412px wide) where "0/3" ran straight into "Record"
          with no space between them. `flex-wrap` here means the right
          group drops to its own line below the left pill instead, at any
          viewport width, rather than painting on top of it. The top offset
          adds env(safe-area-inset-top) on top of the old fixed spacing —
          both native shells render edge-to-edge under the status bar/notch
          (see layout.tsx's viewportFit: "cover" comment), so a bare
          `top-3`/`top-14` placed these controls partly or fully behind the
          status bar/notch in the actual mobile app, even though they looked
          fine in an ordinary browser tab (which always reserves its own
          chrome above the page). env() is 0 anywhere that isn't
          edge-to-edge, so both of these are no-ops there. */}
      <div
        className="fixed inset-x-0 z-[70] flex flex-wrap items-start justify-between gap-2 px-3"
        style={{ top: "calc(0.75rem + env(safe-area-inset-top))" }}
      >
        <div className="flex flex-wrap items-center gap-3 rounded-full bg-black/60 px-3 py-1.5 text-xs text-white">
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

        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap items-center justify-end gap-2">
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
            <div className="w-72 max-w-[calc(100vw-1.5rem)] rounded-lg bg-black/80 p-3 text-white">
              {renderRecordingsPanel("dark")}
            </div>
          )}
          {isHost && stageRequests.length > 0 && (
            // max-w caps this at the viewport width (minus the same 0.75rem
            // margin used on both sides) so it can never overflow off-screen
            // on a narrow phone — w-72 is just the preferred width when
            // there's room for it.
            <div className="w-72 max-w-[calc(100vw-1.5rem)] rounded-lg bg-black/80 p-3 text-white">
              <p className="text-xs font-semibold uppercase tracking-wide text-white/70">
                Waiting to join the stage
              </p>
              <ul className="mt-1.5 space-y-2.5">
                {stageRequests.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate">
                      {r.user.name ?? "Someone"}
                      <span className="text-white/60"> · {r.role === "COHOST" ? "co-host" : "guest"}</span>
                    </span>
                    {/* Explicit 40px (h-10 w-10) tap targets — the icons
                        themselves are small, but on a real phone (not a
                        mouse cursor) the old p-1/12px-icon buttons were well
                        under Apple/Material's ~44px minimum touch target and
                        were genuinely hard to hit reliably in the mobile
                        app's WebView, stacked this close together next to
                        the Record/Screenshot controls. */}
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        disabled={respondingRequestId === r.id}
                        onClick={() => respondToRequest(r.id, true)}
                        title="Approve"
                        aria-label={`Approve ${r.user.name ?? "this request"}`}
                        className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-accent-ink disabled:opacity-50"
                      >
                        <Check size={18} />
                      </button>
                      <button
                        type="button"
                        disabled={respondingRequestId === r.id}
                        onClick={() => respondToRequest(r.id, false)}
                        title="Decline"
                        aria-label={`Decline ${r.user.name ?? "this request"}`}
                        className="flex h-10 w-10 items-center justify-center rounded-full border border-white/30 text-white disabled:opacity-50"
                      >
                        <X size={18} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {!isHost && pendingStageRole && (
        <div
          className="fixed inset-x-0 z-[70] flex justify-center px-3"
          style={{ top: "calc(3.5rem + env(safe-area-inset-top))" }}
        >
          <div className="flex max-w-full items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-xs text-white">
            <span className="min-w-0">
              Waiting for the host to approve your {pendingStageRole === "COHOST" ? "co-host" : "guest"} request…
            </span>
            <button
              type="button"
              disabled={cancellingRequest}
              onClick={doCancelRequest}
              className="shrink-0 font-semibold text-white/80 underline disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {!isHost && !pendingStageRole && declinedNotice && (
        <div
          className="fixed inset-x-0 z-[70] flex justify-center px-3"
          style={{ top: "calc(3.5rem + env(safe-area-inset-top))" }}
        >
          <div className="flex max-w-full items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-xs text-white">
            <span className="min-w-0">The host declined your stage request.</span>
            <button
              type="button"
              onClick={() => setDeclinedNotice(false)}
              aria-label="Dismiss"
              className="shrink-0 text-white/80"
            >
              <X size={12} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
