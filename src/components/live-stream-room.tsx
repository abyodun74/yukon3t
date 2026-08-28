"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, Circle as RecordIcon, Download, Eye, Send, Smile, Users, X } from "lucide-react";
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
  sendLiveStreamComment,
  getLiveStreamComments,
} from "@/app/actions/live-streams";
import { isStaleDeploymentError, STALE_DEPLOYMENT_MESSAGE } from "@/lib/stale-deployment";
import { usePolling } from "@/lib/use-polling";

const POLL_INTERVAL_MS = 5000;
// Same set as StoryViewer's QUICK_REACTIONS (src/components/story-viewer.tsx) for consistency.
const QUICK_REACTIONS = ["❤️", "😂", "😮", "👏", "🔥", "😢"];

/**
 * Daily's own type defs claim `permissions.canSend` is `boolean |
 * Set<string>`, but this app's own diagnostic overlay caught it reading
 * false for a participant who was visibly, successfully broadcasting live
 * video at the time — the real runtime value doesn't reliably match that
 * shape (or a strict `.has()`/`.size` check on it doesn't behave as the
 * type suggests). This is very likely what silently broke "turn the
 * approved guest's camera on" in earlier attempts: the check that decided
 * whether canSend now covers video/audio always evaluated false, so the
 * code that should have called setLocalVideo/setLocalAudio never ran.
 * Checked defensively against every plausible representation (boolean,
 * Set, plain array, or a {video, audio, ...}-keyed object) instead of
 * assuming one.
 */
function canSendKind(canSend: unknown, kind: "video" | "audio"): boolean {
  if (canSend === true) return true;
  if (!canSend) return false;
  if (typeof (canSend as { has?: unknown }).has === "function") {
    return (canSend as Set<string>).has(kind);
  }
  if (Array.isArray(canSend)) return canSend.includes(kind);
  if (typeof canSend === "object") return Boolean((canSend as Record<string, unknown>)[kind]);
  return false;
}

/**
 * TEMPORARY — canSendKind above still reads false for a participant
 * visibly, successfully broadcasting live video (confirmed via the debug
 * overlay, twice now), so the real runtime shape of `permissions.canSend`
 * still isn't matched by any of the cases handled there. Daily's actual
 * call-machine logic is fetched dynamically from their CDN at runtime, not
 * present in the daily-js package installed here, so it can't be
 * determined by reading source — this dumps the exact raw value/type
 * instead of interpreting it, so the next test's screenshot shows the real
 * shape directly rather than another guess about it.
 */
function debugCanSend(canSend: unknown): string {
  if (canSend === true) return "true";
  if (canSend === false) return "false";
  if (canSend == null) return String(canSend);
  if (canSend instanceof Set) return `Set[${[...canSend].join(",")}]`;
  if (Array.isArray(canSend)) return `Arr[${canSend.join(",")}]`;
  if (typeof canSend === "object") {
    try {
      return `Obj${JSON.stringify(canSend)}`;
    } catch {
      return `Obj{${Object.keys(canSend).join(",")}}`;
    }
  }
  return `${typeof canSend}:${String(canSend)}`;
}

type ActiveRoom = { roomUrl: string; token: string };
type StageRole = "GUEST" | "COHOST";
type Role = "VIEWER" | StageRole;
type Recording = { id: string; startedAt: number; durationSeconds: number | null };
type StageRequest = {
  id: string;
  role: StageRole;
  user: { id: string; name: string | null; avatarUrl: string | null };
};
type StreamComment = {
  id: string;
  content: string;
  createdAt: Date;
  author: { id: string; name: string | null; avatarUrl: string | null };
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
  const [comments, setComments] = useState<StreamComment[]>([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [sendingComment, setSendingComment] = useState(false);
  // True once this participant's own camera/mic have actually started
  // sending (see the isHost===false effect below) — drives a manual
  // "Turn on camera & mic" fallback button for approved guests/co-hosts.
  // The automatic attempt in that effect fires from a Daily event handler,
  // not a direct tap, and some browsers (this app's own Android WebView
  // very much included) silently refuse to prompt for camera/mic
  // permission outside a real user gesture — this button exists so there's
  // always one available rather than leaving someone stuck approved but
  // silently camera-off with no way to fix it themselves.
  const [localMediaStarted, setLocalMediaStarted] = useState(false);
  // TEMPORARY diagnostic — setLocalVideo/setLocalAudio return no promise, so
  // a getUserMedia failure inside them is invisible. startCamera() (below)
  // does return one; surfacing its rejection reason is the only way to see
  // *why* the guest's camera never actually starts despite canSend:true.
  const [cameraStartError, setCameraStartError] = useState<string | null>(null);
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const [floatingReactions, setFloatingReactions] = useState<{ id: string; emoji: string }[]>([]);
  // TEMPORARY diagnostic state — see the dailyCall participant-tracking effect below.
  const [dailyParticipants, setDailyParticipants] = useState<
    { userName: string; canSendRaw: string; video: boolean; audio: boolean }[]
  >([]);
  const router = useRouter();
  const { dailyCall, startSession } = useCallSession();
  const stageUserIdsRef = useRef<Set<string>>(new Set());
  const lastRequestStatusRef = useRef<"PENDING" | "APPROVED" | "DECLINED" | null>(null);
  const lastCommentIdRef = useRef<string | undefined>(undefined);
  const commentsEndRef = useRef<HTMLDivElement>(null);

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
    const [{ count, stageCount: sc, stageCapacity: cap }, { recordings: recs }, { comments: fresh }] =
      await Promise.all([
        getLiveStreamViewerCount(liveStreamId),
        listLiveStreamRecordings(liveStreamId),
        getLiveStreamComments(liveStreamId, lastCommentIdRef.current),
      ]);
    setViewerCount(count);
    setStageCount(sc);
    setStageCapacity(cap);
    setRecordings(recs);
    if (fresh.length > 0) {
      lastCommentIdRef.current = fresh[fresh.length - 1]!.id;
      setComments((prev) => [...prev, ...fresh].slice(-100));
    }

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

      // The other half of the canSend-grant effect below: that effect only
      // re-checks eligibility on mount and on a brand-new "participant-
      // joined" event. But per joinLiveStream's own design, a requester
      // already joined the Daily room as a plain viewer the moment they
      // asked for a stage slot — approval typically lands *after* they're
      // already connected, not as a fresh join. Neither of that effect's
      // two triggers ever fires again for an already-connected participant
      // whose eligibility just changed, so an approval landing on someone
      // already in the room silently never got acted on until they
      // happened to reconnect. Re-scanning current participants against
      // the just-refreshed stageUserIdsRef on every poll tick (here) is
      // what actually catches that — within one 5s tick instead of never.
      if (dailyCall) {
        for (const p of Object.values(dailyCall.participants())) {
          if (p.local || canSendKind(p.permissions.canSend, "video")) continue;
          if (!stageUserIdsRef.current.has(p.user_id)) continue;
          dailyCall.updateParticipant(p.session_id, { updatePermissions: { canSend: true } });
        }
      }
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
  }, [liveStreamId, isHost, role, dailyCall]);

  usePolling(poll, POLL_INTERVAL_MS, phase !== "joining");

  // Keeps the newest comment in view as they arrive, the same way a normal
  // chat thread does — this is a small always-visible strip, not something
  // someone scrolls back through, so there's no "stick to bottom only if
  // already there" logic to preserve a manual scroll-up like chat-thread.tsx
  // has for full conversations.
  useEffect(() => {
    commentsEndRef.current?.scrollIntoView({ block: "end" });
  }, [comments]);

  function startMyCamera() {
    if (!dailyCall) return;
    dailyCall
      .startCamera({ videoSource: true, audioSource: true })
      .then(() => {
        dailyCall.setLocalVideo(true);
        dailyCall.setLocalAudio(true);
        setLocalMediaStarted(true);
        setCameraStartError(null);
      })
      .catch((err: unknown) => {
        setCameraStartError(err instanceof Error ? err.message : String(err));
      });
  }

  // Broadcasts an ephemeral emoji reaction to everyone currently in the
  // Daily room via sendAppMessage (same mechanism collab-material.ts uses
  // to share a file mid-call) — no LiveStreamComment/DB row, this is a
  // fire-and-forget visual, not a persisted message. Replaces Daily's own
  // built-in reaction picker (now disabled, see createLiveStreamRoom in
  // daily.ts) with one this app can actually center and style, at the cost
  // of reactions only reaching people currently connected, not a durable
  // history the way comments are.
  function sendReaction(emoji: string) {
    setReactionPickerOpen(false);
    setFloatingReactions((prev) => [...prev, { id: `${Date.now()}-${Math.random()}`, emoji }]);
    dailyCall?.sendAppMessage({ type: "live-reaction", emoji }, "*");
  }

  function sendComment() {
    const content = commentDraft.trim();
    if (!content || sendingComment) return;
    setSendingComment(true);
    const fd = new FormData();
    fd.set("content", content);
    sendLiveStreamComment(liveStreamId, fd)
      .then((result) => {
        setSendingComment(false);
        if (!result.error) setCommentDraft("");
      })
      .catch(() => setSendingComment(false));
  }

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
      if (p.local || canSendKind(p.permissions.canSend, "video")) return;
      if (!stageUserIdsRef.current.has(p.user_id)) return;
      dailyCall!.updateParticipant(p.session_id, { updatePermissions: { canSend: true } });
    }

    async function handleJoined(ev: { participant: DailyParticipant }) {
      const p = ev.participant;
      if (p.local || canSendKind(p.permissions.canSend, "video")) return;
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

  // The other half of the grant above, on the approved guest/co-host's own
  // client: getting canSend permission from the host does NOT itself turn
  // their camera/mic on. They originally joined an owner_only_broadcast
  // room, so Daily's prebuilt UI decided at that moment — correctly, at the
  // time — not to expose any camera/mic controls to them at all. Since that
  // decision was made once at join time, it never revisits itself just
  // because a permission changed mid-call; nothing here previously told it
  // to. Reacting to this participant's own "participant-updated" the
  // instant canSend actually includes video/audio is what actually starts
  // their stream — this is the concrete cause behind "approved as a
  // co-host but the stream still only shows one screen" rather than
  // anything to do with how the video grid itself is laid out.
  useEffect(() => {
    if (isHost || !dailyCall) return;
    let enabled = false;

    function tryEnable(p: DailyParticipant) {
      if (!p.local || enabled) return;
      if (!canSendKind(p.permissions.canSend, "video") && !canSendKind(p.permissions.canSend, "audio")) return;
      enabled = true;
      dailyCall!
        .startCamera({ videoSource: true, audioSource: true })
        .then(() => {
          dailyCall!.setLocalVideo(true);
          dailyCall!.setLocalAudio(true);
          setLocalMediaStarted(true);
          setCameraStartError(null);
        })
        .catch((err: unknown) => {
          // Let the manual fallback button retry (it's a real click, so it
          // isn't subject to whatever blocked this automatic attempt).
          enabled = false;
          setCameraStartError(err instanceof Error ? err.message : String(err));
        });
    }

    const local = dailyCall.participants().local;
    if (local) tryEnable(local);

    function handleUpdated(ev: { participant: DailyParticipant }) {
      tryEnable(ev.participant);
    }
    dailyCall.on("participant-updated", handleUpdated);
    return () => {
      dailyCall.off("participant-updated", handleUpdated);
    };
  }, [isHost, dailyCall]);

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

  // Other participants' reactions arrive as app-messages (see sendReaction
  // above) — this is what actually shows them float up on everyone else's
  // screen, not just the sender's own optimistic add.
  useEffect(() => {
    if (!dailyCall) return;
    function onAppMessage(ev: { data: unknown }) {
      const data = ev.data as { type?: string; emoji?: string } | null;
      if (data?.type !== "live-reaction" || typeof data.emoji !== "string") return;
      setFloatingReactions((prev) => [...prev, { id: `${Date.now()}-${Math.random()}`, emoji: data.emoji! }]);
    }
    dailyCall.on("app-message", onAppMessage);
    return () => {
      dailyCall.off("app-message", onAppMessage);
    };
  }, [dailyCall]);

  // TEMPORARY diagnostic — surfaces what Daily's own client actually thinks
  // is in the room, next to the "👥 1/3" pill (which only ever reflects our
  // own DB's approved-stage-slot bookkeeping, not Daily's live room state).
  // Screenshots alone couldn't settle whether two simultaneously-connected
  // devices were genuinely seeing each other as Daily participants at all —
  // this makes that directly visible instead of inferred. Safe to remove
  // once the split-screen issue is confirmed fixed.
  useEffect(() => {
    if (!dailyCall) return;
    function refresh() {
      const all = Object.values(dailyCall!.participants());
      setDailyParticipants(
        all.map((p) => ({
          userName: p.local ? `${p.user_name || "me"} (me)` : p.user_name || "?",
          canSendRaw: debugCanSend(p.permissions.canSend),
          video: p.video,
          audio: p.audio,
        })),
      );
    }
    refresh();
    dailyCall.on("participant-joined", refresh);
    dailyCall.on("participant-updated", refresh);
    dailyCall.on("participant-left", refresh);
    return () => {
      dailyCall.off("participant-joined", refresh);
      dailyCall.off("participant-updated", refresh);
      dailyCall.off("participant-left", refresh);
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
          {/* TEMPORARY diagnostic — see the dailyCall participant-tracking effect. Remove once split-screen is confirmed fixed. */}
          <span className="flex items-center gap-1 border-l border-white/30 pl-2 text-[10px] text-white/70" title="Daily's own participant list, for debugging">
            Daily:{" "}
            {dailyParticipants.length === 0
              ? "none"
              : dailyParticipants
                  .map((p) => `${p.userName}=canSend:${p.canSendRaw},video:${p.video},audio:${p.audio}`)
                  .join(" | ")}
            {cameraStartError ? ` | startCamera error: ${cameraStartError}` : ""}
          </span>
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap items-center justify-end gap-2">
            {canRecord && (
              <button
                type="button"
                onClick={toggleRecording}
                title={recording ? "Stop recording" : "Record"}
                aria-label={recording ? "Stop recording" : "Record"}
                className={`flex h-9 w-9 items-center justify-center rounded-full text-white ${
                  recording ? "bg-danger" : "bg-black/60"
                }`}
              >
                <RecordIcon size={14} className={recording ? "fill-white" : "fill-danger text-danger"} />
              </button>
            )}
            <button
              type="button"
              disabled={screenshotBusy}
              onClick={handleScreenshot}
              title="Screenshot"
              aria-label="Screenshot"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white disabled:opacity-50"
            >
              <Camera size={14} />
            </button>
            {recordings.length > 0 && (
              <button
                type="button"
                onClick={() => setShowRecordings((v) => !v)}
                title={`Recordings (${recordings.length})`}
                aria-label={`Recordings (${recordings.length})`}
                className="relative flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white"
              >
                <Download size={14} />
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-accent-ink">
                  {recordings.length}
                </span>
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

      {!isHost && (role === "GUEST" || role === "COHOST") && !localMediaStarted && (
        // The automatic attempt (see the isHost===false effect above) fires
        // from a Daily event callback, not a tap — several browsers,
        // Android WebView included, silently refuse to prompt for camera/
        // mic permission outside a real user gesture. This button is that
        // gesture, so being approved never leaves someone stuck camera-off
        // with no way to fix it themselves.
        <div
          className="fixed inset-x-0 z-[70] flex flex-col items-center gap-1 px-3"
          style={{ top: "calc(6.5rem + env(safe-area-inset-top))" }}
        >
          <button
            type="button"
            onClick={startMyCamera}
            className="rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-accent-ink"
          >
            You&apos;re on stage — tap to turn on your camera &amp; mic
          </button>
          {/* TEMPORARY diagnostic — surfaces startCamera()'s rejection reason right next to the button that triggers it, since the top pill can get covered/clipped by this button. Remove alongside the rest of the diagnostic block once split-screen is confirmed fixed. */}
          {cameraStartError && (
            <span className="max-w-[90vw] rounded-full bg-danger/90 px-3 py-1 text-[10px] text-white">
              startCamera error: {cameraStartError}
            </span>
          )}
        </div>
      )}

      {/*
        Fiber-style live chat overlay — comments scroll up from a fixed
        point above the input, both left-anchored and width-capped rather
        than spanning the full screen. Two things it deliberately stays
        clear of, neither of which this app can move or resize (Daily's
        cross-origin prebuilt iframe): Daily's own bottom-center control
        tray (mute/camera/leave — hiding that isn't an option, it's the
        only way to mute/unmute during the stream) and GlobalCallFrame's
        own bottom-right Leave/Minimize buttons (z-[80]). The
        `calc(4.5rem + env(safe-area-inset-bottom))` bottom offset sits
        this whole block above Daily's tray height rather than trying to
        dodge it horizontally, which would be guessing at a width this app
        has no way to measure.
      */}
      <div
        className="pointer-events-none fixed inset-x-3 z-[70] flex flex-col items-start gap-2"
        style={{ bottom: "calc(4.5rem + env(safe-area-inset-bottom))" }}
      >
        <div className="max-h-[32vh] w-full max-w-[75%] overflow-y-auto sm:max-w-xs">
          <div className="flex flex-col gap-1.5">
            {comments.map((c) => (
              <div
                key={c.id}
                className="w-fit max-w-full rounded-xl bg-black/50 px-2.5 py-1.5 text-xs text-white"
              >
                <span className="font-semibold">{c.author.name ?? "Someone"}</span>{" "}
                <span className="break-words">{c.content}</span>
              </div>
            ))}
            <div ref={commentsEndRef} />
          </div>
        </div>
        <form
          action={() => sendComment()}
          className="pointer-events-auto flex w-full max-w-[75%] items-center gap-1.5 sm:max-w-xs"
        >
          <input
            value={commentDraft}
            onChange={(e) => setCommentDraft(e.target.value)}
            maxLength={300}
            placeholder="Write something..."
            aria-label="Write a comment"
            className="min-w-0 flex-1 rounded-full bg-black/50 px-3 py-1.5 text-xs text-white placeholder-white/60 outline-none focus:bg-black/70"
          />
          <button
            type="submit"
            disabled={!commentDraft.trim() || sendingComment}
            aria-label="Send comment"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink disabled:opacity-50"
          >
            <Send size={14} />
          </button>
        </form>
      </div>

      {/*
        Centered reaction trigger + floating display — replaces Daily's own
        built-in reactions (now disabled in createLiveStreamRoom) with one
        this app fully controls, since the whole point was to have it
        actually centered rather than wherever Daily's cross-origin iframe
        happened to place it. Sits centered horizontally at the same bottom
        offset as the chat overlay, so it reads as a deliberate second
        control next to it rather than competing for the same corner.
      */}
      <div
        className="pointer-events-none fixed inset-x-0 z-[70] flex flex-col items-center gap-2"
        style={{ bottom: "calc(4.5rem + env(safe-area-inset-bottom))" }}
      >
        <div className="flex h-16 flex-col-reverse items-center overflow-hidden">
          {floatingReactions.map((r) => (
            <span
              key={r.id}
              className="reaction-float text-2xl"
              onAnimationEnd={() => setFloatingReactions((prev) => prev.filter((f) => f.id !== r.id))}
            >
              {r.emoji}
            </span>
          ))}
        </div>
        <div className="pointer-events-auto relative">
          {reactionPickerOpen && (
            <div className="absolute bottom-full mb-2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/70 px-2 py-1.5 left-1/2">
              {QUICK_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => sendReaction(emoji)}
                  className="rounded-full px-1.5 py-1 text-xl hover:bg-white/20"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setReactionPickerOpen((v) => !v)}
            aria-label="React"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white"
          >
            <Smile size={16} />
          </button>
        </div>
      </div>

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
