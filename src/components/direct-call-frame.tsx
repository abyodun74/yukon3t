"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Mic, MicOff, Pause, Play, ScreenShare, ScreenShareOff, SwitchCamera, Video, VideoOff, Volume2 } from "lucide-react";
import type { DailyCall, DailyMediaDeviceInfo, DailyParticipant } from "@daily-co/daily-js";
import { Capacitor } from "@capacitor/core";
import { useViewportDrag } from "@/lib/use-viewport-drag";
import { broadcastHoldState, holdStateFromAppMessage } from "@/lib/call-hold";
import { broadcastCameraPaused, cameraPausedFromAppMessage } from "@/lib/call-camera-pause";
import {
  CALL_PEER_LOSS_FIRST_CHECK_MS,
  CALL_PEER_LOSS_GRACE_MS,
  CALL_PEER_LOSS_NOTICE_DELAY_MS,
  CALL_PEER_LOSS_STATUS_POLL_MS,
  CALL_RECONNECT_WINDOW_MS,
  CALL_STATUS_CHECK_TIMEOUT_MS,
  cameraRecoveryAction,
  dailyErrorType,
  involuntaryLeaveAction,
  isExpectedCallExpiry,
  reconnectDelayMs,
  remotesByUser,
  settledWithin,
  shouldAnnounceCameraPaused,
} from "@/lib/call-resilience";
import { captureError } from "@/lib/error-tracking";
import { takePrewarmedCall } from "@/lib/call-prewarm";
import { hapticSelection, hapticImpact } from "@/lib/haptics";
import { UserAvatar } from "@/components/user-link";
import { useCallsText } from "@/components/calls-text";
import { callPeer, peerNotice, type CallPeer } from "@/lib/call-names";
import type { CallRoster } from "@/lib/use-call-roster";

/** Same heuristic as call-frame.tsx's audio-output switcher — deviceId/ordering aren't reliable, the label is. */
function isSpeakerDevice(device: MediaDeviceInfo) {
  return /speaker/i.test(device.label);
}

function trackIsOn(state: DailyParticipant["tracks"]["audio"]["state"]) {
  return state !== "off" && state !== "blocked";
}

const NO_NOTICES: ReadonlySet<string> = new Set();

/**
 * Hold and camera-paused notices are kept per sender, filed under their
 * user id — or their session id when Daily hasn't listed that session yet —
 * so a notice follows the person across their own rejoin rather than the
 * session that sent it.
 */
function withNotice(notices: ReadonlySet<string>, userKey: string, sessionId: string, on: boolean) {
  const next = new Set(notices);
  next.delete(sessionId);
  if (on) next.add(userKey);
  else next.delete(userKey);
  return next;
}

function hasNotice(notices: ReadonlySet<string>, participant: DailyParticipant) {
  return notices.has(participant.user_id) || notices.has(participant.session_id);
}

/** Drops the notices of anyone no longer in the room; the same set back when there's nothing to drop. */
function noticesStillPresent(notices: ReadonlySet<string>, present: ReadonlySet<string>) {
  const kept = [...notices].filter((key) => present.has(key));
  return kept.length === notices.size ? notices : new Set(kept);
}

/** How long after returning to the foreground a still-muted camera track is given to come back by itself before it's restarted (see cameraRecoveryAction). */
const CAMERA_RECHECK_DELAY_MS = 2500;

/**
 * Whether the call row has ended server-side, or null when that can't be
 * determined: no checker, the check failed (offline), or it didn't answer
 * within CALL_STATUS_CHECK_TIMEOUT_MS. Null always means "not known to be
 * over — carry on"; nothing that waits on this may be held up by it.
 */
function callIsOver(check: (() => Promise<boolean>) | undefined): Promise<boolean | null> {
  if (!check) return Promise.resolve(null);
  return settledWithin(
    Promise.resolve().then(check),
    CALL_STATUS_CHECK_TIMEOUT_MS,
  );
}

/**
 * Hand-built 1:1 call UI — createCallObject() (not createFrame()), same
 * "custom UI" mode live-video-frame.tsx already uses for live streams,
 * chosen for exactly one reason: Daily Prebuilt's local camera track isn't
 * actually attachable/playable from the parent page (confirmed live — see
 * call-frame.tsx's own comment on this), which makes a draggable self-view
 * impossible to build as an overlay on top of Prebuilt's iframe. This
 * component owns the whole call UI itself instead, so there's a real local
 * MediaStreamTrack to attach the draggable self-view to.
 *
 * Scoped to regular calls only (see call-session.tsx's `renderer:
 * "direct"`) — Collab stays on CallFrame/Prebuilt for now. A call starts
 * 1:1 and with one other person in the room this renders exactly that: one
 * main view and the draggable self-view. Once people have been added (see
 * inviteToCall) and two or more others are in the room, the main view
 * becomes a grid of tiles instead. Ringing/pre-accept UI lives entirely in
 * call-button.tsx/incoming-call-listener.tsx; by the time this mounts the
 * call has already been accepted, so there's no lobby/prejoin state to
 * handle here — just "connecting" for the brief gap before the remote
 * participant's tracks arrive.
 *
 * Falling out of the Daily room is NOT the end of the call here. The only
 * intentional exit is the user's own hang-up, which never reaches this
 * component as an event (CallSessionProvider's hangUp ends the session and
 * unmounts it), so every "left-meeting"/"error" Daily reports is treated as
 * involuntary: this retries join() on the same call object for
 * CALL_RECONNECT_WINDOW_MS, and `onLeave` only fires once the call is
 * really over — retries exhausted, the room/token gone, the call row ended
 * by the other side, or the peer missing for CALL_PEER_LOSS_GRACE_MS. The
 * rules themselves live in call-resilience.ts.
 */
export function DirectCallFrame({
  roomUrl,
  token,
  type,
  onLeave,
  isCallOver,
  onCallObject,
  peerName,
  prewarmKey,
  roster,
  selfUserId,
}: {
  roomUrl: string;
  token: string;
  type: "AUDIO" | "VIDEO";
  /** Called once, when the call is really over — never for a drop this component is still reconnecting from (see above). */
  onLeave: () => void;
  /** Whether the call row has already ended server-side (see StartSessionInput.isOver). Omitted, or failing because the network is down, just means "not known to be over" — carry on. */
  isCallOver?: () => Promise<boolean>;
  onCallObject?: (call: DailyCall | null) => void;
  /** The other participant's display name — used only for the hold overlay's "X put the call on hold" text. Falls back to a generic phrase when omitted. */
  peerName?: string;
  /** Same `call:${callId}` key call-session.tsx uses — if call-prewarm.ts already has (or is still joining) a call object under this key, adopt it instead of creating/joining a fresh one (see call-prewarm.ts). Both sides can have one now: the caller's joins live, the callee's joins muted and gets unmuted below once adopted — either way, omitted means create fresh instead (the normal cold-start fallback, e.g. a prewarm that was never started or already failed). */
  prewarmKey?: string;
  /** Who is in the call server-side (see useCallRoster) — names and avatars for the tiles of a call people were added to, and whether someone is still being rung. Null until it has loaded. */
  roster?: CallRoster | null;
  selfUserId?: string;
}) {
  const callRef = useRef<DailyCall | null>(null);
  const [participants, setParticipants] = useState<DailyParticipant[]>([]);
  const { t: calls } = useCallsText();
  const t = calls.direct;
  const controls = calls.controls;
  // Which failure, not its sentence: worded in the reader's language where it is shown.
  const [joinError, setJoinError] = useState<"media" | "join" | null>(null);
  const [outputDevices, setOutputDevices] = useState<DailyMediaDeviceInfo[]>([]);
  const [outputIndex, setOutputIndex] = useState(0);
  const [cameraCount, setCameraCount] = useState(0);
  // isOnHold: this side placed the call on hold (local audio/video forced
  // off, remote's audio muted locally — see toggleHold). remoteOnHold: the
  // other side did, learned only from their broadcastHoldState app-message
  // (see call-hold.ts) since their tracks simply going "off" is otherwise
  // indistinguishable from an ordinary mute.
  const [isOnHold, setIsOnHold] = useState(false);
  const [remoteHolds, setRemoteHolds] = useState(NO_NOTICES);
  // What to restore on Resume — captured the moment Hold is pressed, not
  // read back from Daily, since setLocalAudio/setLocalVideo(false) below
  // overwrites the very state this needs to remember.
  const preHoldStateRef = useRef<{ audio: boolean; video: boolean } | null>(null);
  const selfViewRef = useRef<HTMLDivElement>(null);
  const { position: selfViewPosition, handlers: selfViewHandlers } = useViewportDrag(selfViewRef);
  // Tap-to-swap (FaceTime/Zoom-style): false is the normal layout (remote
  // fullscreen, your own camera as the small draggable tile); true swaps
  // them. Toggled by tapping the tile itself, whichever participant it
  // currently holds — see the tile's onClick below. A tap and a drag start
  // the same way (pointerdown on the tile), but the browser's own click
  // event only fires when the pointer didn't move past its drag threshold,
  // so this doesn't need its own separate tap-vs-drag detection.
  const [selfViewIsMain, setSelfViewIsMain] = useState(false);
  // reconnecting: this side is out of the room and retrying join() itself.
  // networkInterrupted: still in the room as far as Daily is concerned, but
  // its signaling link dropped and its own internal reconnect is running —
  // same "Reconnecting…" notice either way.
  const [reconnecting, setReconnecting] = useState(false);
  const [networkInterrupted, setNetworkInterrupted] = useState(false);
  // Learned only from the peer's broadcastCameraPaused app-message (see
  // call-camera-pause.ts) — their backgrounded camera otherwise just looks
  // like a frozen frame.
  const [remoteCamerasPaused, setRemoteCamerasPaused] = useState(NO_NOTICES);
  const [hadRemote, setHadRemote] = useState(false);
  const [peerLossNoticeDue, setPeerLossNoticeDue] = useState(false);
  // What the user wants their mic/camera to be, tracked separately from what
  // Daily currently reports: a rejoin starts from an empty participant list,
  // and a camera stopped by backgrounding reads exactly like one the user
  // turned off. Deliberately not touched by Hold (see localMediaIntent).
  const mediaIntentRef = useRef({ audio: true, video: type === "VIDEO" });
  const isOnHoldRef = useRef(false);
  const endCallRef = useRef<(() => void) | null>(null);
  // Ref mirrors: the effect below runs once per room and outlives any one
  // render's props.
  const onLeaveRef = useRef(onLeave);
  const isCallOverRef = useRef(isCallOver);
  useEffect(() => {
    onLeaveRef.current = onLeave;
    isCallOverRef.current = isCallOver;
  });

  useEffect(() => {
    let cancelled = false;
    let call: DailyCall | null = null;
    // Set the moment the decision to end is made (which can be a server
    // round trip before onLeave actually fires) so nothing starts a
    // reconnect in between.
    let ending = false;
    let finished = false;
    let reconnect: { startedAt: number; attempt: number } | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDeadline: ReturnType<typeof setTimeout> | null = null;
    let cameraRecheckTimer: ReturnType<typeof setTimeout> | null = null;
    let watchedCameraTrack: MediaStreamTrack | null = null;
    let announcedCameraPaused = false;

    function refreshParticipants() {
      if (!call) return;
      const next = Object.values(call.participants());
      setParticipants(next);
      // A hold or paused-camera notice belongs to the participant who sent
      // it — if they come back, their own resync says what's still true
      // (see announceStateToPeer).
      const present = new Set<string>();
      for (const p of next) {
        if (p.local) continue;
        present.add(p.user_id);
        present.add(p.session_id);
      }
      setRemoteHolds((prev) => noticesStillPresent(prev, present));
      setRemoteCamerasPaused((prev) => noticesStillPresent(prev, present));
    }

    function clearRemoteNotices() {
      setRemoteHolds(NO_NOTICES);
      setRemoteCamerasPaused(NO_NOTICES);
    }

    function localMediaIntent() {
      return isOnHoldRef.current ? { audio: false, video: false } : mediaIntentRef.current;
    }

    function clearReconnectTimers() {
      if (retryTimer) clearTimeout(retryTimer);
      if (reconnectDeadline) clearTimeout(reconnectDeadline);
      retryTimer = null;
      reconnectDeadline = null;
    }

    function finish() {
      if (cancelled || finished) return;
      ending = true;
      finished = true;
      clearReconnectTimers();
      onLeaveRef.current();
    }

    // Daily says the room or token is gone. Almost always that's the other
    // side having hung up (endCall deletes the room) or the call reaching
    // its 12-hour lifetime — both ordinary. Anything else is a call that
    // was cut off while the server still thinks it's live, which is worth
    // knowing about. The reconnect deadline (if one is armed) is left
    // running across the status check rather than cleared first — finish()
    // clears it — and the check itself can't outlast
    // CALL_STATUS_CHECK_TIMEOUT_MS, so this always ends. No answer in that
    // time isn't reported: that's a slow network, not a finding.
    async function endOnTerminalError(errorType: string | null) {
      ending = true;
      const over = await callIsOver(isCallOverRef.current);
      if (over === false && !isExpectedCallExpiry(errorType)) {
        void captureError(new Error(`1:1 call dropped by Daily: ${errorType}`), {
          component: "direct-call-frame",
          errorType,
        });
      }
      finish();
    }

    function localCameraTrack() {
      return call?.participants().local?.tracks.video.persistentTrack ?? null;
    }

    function cameraIsPaused() {
      const track = localCameraTrack();
      return shouldAnnounceCameraPaused({
        hidden: document.visibilityState === "hidden",
        wantVideo: localMediaIntent().video,
        trackMuted: track?.muted ?? false,
        trackEnded: track?.readyState === "ended",
        // iOS stops camera capture for a backgrounded app, always.
        platformAlwaysPauses: Capacitor.getPlatform() === "ios",
      });
    }

    function announceCameraPausedIfStopped() {
      if (!call || cancelled || ending || announcedCameraPaused) return;
      if (!cameraIsPaused()) return;
      announcedCameraPaused = true;
      broadcastCameraPaused(call, true);
    }

    // Both notices are otherwise only sent when they change, so whoever has
    // just (re)joined — the peer, or this side — would be left with whatever
    // they last heard: a hold that has since been resumed, a camera that has
    // since come back, or neither when it was set while they were out. Sent
    // whether true or false, so a stale notice gets cleared too.
    function announceStateToPeer(c: DailyCall) {
      if (cancelled || ending || c.meetingState() !== "joined-meeting") return;
      broadcastHoldState(c, isOnHoldRef.current);
      broadcastCameraPaused(c, announcedCameraPaused);
    }

    function handleParticipantJoined() {
      refreshParticipants();
      if (call) announceStateToPeer(call);
    }

    function unwatchCameraTrack() {
      watchedCameraTrack?.removeEventListener("mute", announceCameraPausedIfStopped);
      watchedCameraTrack?.removeEventListener("ended", announceCameraPausedIfStopped);
      watchedCameraTrack = null;
    }

    function recoverCamera(mutedIsStale: boolean) {
      const c = call;
      if (!c || cancelled || ending || c.meetingState() !== "joined-meeting") return;
      const video = c.participants().local?.tracks.video;
      const track = video?.persistentTrack;
      const action = cameraRecoveryAction({
        wantVideo: localMediaIntent().video,
        trackState: video?.state,
        trackEnded: track?.readyState === "ended",
        trackMuted: track?.muted ?? false,
        mutedIsStale,
      });
      if (action === "restart") c.setLocalVideo(false);
      if (action !== "none") c.setLocalVideo(true);
    }

    function recovered(c: DailyCall) {
      reconnect = null;
      clearReconnectTimers();
      setReconnecting(false);
      setNetworkInterrupted(false);
      refreshParticipants();
      // The join() options above should already have brought these up as
      // they were — set explicitly rather than assumed, since coming back
      // silently muted would be worse than a redundant call.
      const intent = localMediaIntent();
      c.setLocalAudio(intent.audio);
      if (document.visibilityState === "visible") c.setLocalVideo(intent.video);
      // Whoever is in the room now may have missed either of these while
      // this side was out of it.
      announcedCameraPaused = cameraIsPaused();
      announceStateToPeer(c);
    }

    async function attemptRejoin() {
      retryTimer = null;
      const c = call;
      if (!c || cancelled || ending || !reconnect) return;
      // Bounded (see callIsOver): on the very network that just dropped
      // this side, an unanswered status check must not be what delays the
      // rejoin. No answer counts as "not over" — go ahead and join.
      const over = await callIsOver(isCallOverRef.current);
      if (involuntaryLeaveAction({ errorType: null, callOver: over === true }) === "end") {
        finish();
        return;
      }
      if (cancelled || ending || !reconnect) return;
      // "joining-meeting": an earlier attempt's join() is still in flight
      // (a join on a dead network can sit there a long while) — calling it
      // again just warns and returns, so wait on that one instead.
      if (c.meetingState() !== "joined-meeting" && c.meetingState() !== "joining-meeting") {
        const intent = localMediaIntent();
        try {
          await c.join({
            url: roomUrl,
            token,
            // The camera can't be started from the background (iOS refuses
            // outright) — it's brought back on return, see recoverCamera.
            startVideoOff: !intent.video || document.visibilityState === "hidden",
            startAudioOff: !intent.audio,
          });
        } catch (err) {
          if (cancelled || ending || !reconnect) return;
          const errorType = dailyErrorType(err);
          if (involuntaryLeaveAction({ errorType, callOver: false }) === "end") {
            void endOnTerminalError(errorType);
            return;
          }
        }
      }
      if (cancelled || ending || !reconnect) return;
      if (c.meetingState() === "joined-meeting") {
        recovered(c);
        return;
      }
      const delay = reconnectDelayMs(reconnect.attempt, Date.now() - reconnect.startedAt);
      reconnect.attempt += 1;
      if (delay === null) {
        finish();
        return;
      }
      retryTimer = setTimeout(attemptRejoin, delay);
    }

    // Every way this side can fall out of the room without having hung up:
    // Daily's "error" (its own internal reconnect gave up, or the room/
    // token is gone), a "left-meeting" nobody here asked for, a failed
    // first join, or coming back to the foreground to find the call object
    // no longer joined. An "error" is often followed by a "left-meeting"
    // for the same drop, and a failing retry raises its own "error" — both
    // land here again and are ignored while a reconnect is already running.
    function handleInvoluntaryLeave(errorType: string | null) {
      if (cancelled || ending || reconnect) return;
      if (involuntaryLeaveAction({ errorType, callOver: false }) === "end") {
        void endOnTerminalError(errorType);
        return;
      }
      reconnect = { startedAt: Date.now(), attempt: 0 };
      setReconnecting(true);
      // Daily empties its own participant list on leaving; without this the
      // last frame of the other side would sit there frozen.
      setParticipants([]);
      clearRemoteNotices();
      // Backstop for a join() that never settles either way — the retry
      // schedule alone only advances when an attempt actually returns.
      reconnectDeadline = setTimeout(finish, CALL_RECONNECT_WINDOW_MS);
      void attemptRejoin();
    }

    function handleLeftMeeting() {
      handleInvoluntaryLeave(null);
    }

    function handleFatalError(ev: unknown) {
      handleInvoluntaryLeave(dailyErrorType(ev));
    }

    // Daily's own connection to its signaling server dropping and coming
    // back — it reconnects that by itself, and only raises "error" if it
    // can't. Only "signaling" is this side's own link; the peer-to-peer/sfu
    // media variants also fire for the other side's trouble.
    function handleNetworkConnection(ev: { type: string; event: string }) {
      if (ev.type !== "signaling") return;
      if (ev.event === "interrupted") setNetworkInterrupted(true);
      else if (ev.event === "connected") setNetworkInterrupted(false);
    }

    // Audio is deliberately left alone on hide — the whole point is that
    // the conversation carries on with the app in the background. Only the
    // camera needs handling, and only because the OS stops it regardless.
    function handleVisibilityChange() {
      const c = call;
      if (!c || cancelled || ending) return;
      if (cameraRecheckTimer) clearTimeout(cameraRecheckTimer);
      cameraRecheckTimer = null;
      unwatchCameraTrack();
      if (document.visibilityState === "hidden") {
        // Capture usually stops a beat after the page is hidden, not before.
        watchedCameraTrack = localCameraTrack();
        watchedCameraTrack?.addEventListener("mute", announceCameraPausedIfStopped);
        watchedCameraTrack?.addEventListener("ended", announceCameraPausedIfStopped);
        announceCameraPausedIfStopped();
        return;
      }
      const state = c.meetingState();
      if (state === "left-meeting" || state === "error") {
        handleInvoluntaryLeave(null);
        return;
      }
      recoverCamera(false);
      cameraRecheckTimer = setTimeout(() => recoverCamera(true), CAMERA_RECHECK_DELAY_MS);
      if (announcedCameraPaused) {
        announcedCameraPaused = false;
        broadcastCameraPaused(c, false);
      }
    }

    function applyDevices(devices: DailyMediaDeviceInfo[]) {
      setOutputDevices(devices.filter((d) => d.kind === "audiooutput"));
      setCameraCount(devices.filter((d) => d.kind === "videoinput").length);
    }

    function handleAppMessage(ev: { data: unknown; fromId: string }) {
      const userKey = call?.participants()[ev.fromId]?.user_id || ev.fromId;
      const onHold = holdStateFromAppMessage(ev.data);
      if (onHold !== null) setRemoteHolds((prev) => withNotice(prev, userKey, ev.fromId, onHold));
      const cameraPaused = cameraPausedFromAppMessage(ev.data);
      if (cameraPaused !== null) {
        setRemoteCamerasPaused((prev) => withNotice(prev, userKey, ev.fromId, cameraPaused));
      }
    }

    // Daily's call-machine emits "camera-error" specifically for a
    // getUserMedia failure inside setLocalVideo/setLocalAudio (confirmed
    // precedent: live-stream-room.tsx's own onCameraError). setLocalAudio/
    // setLocalVideo themselves return the call object, not a Promise —
    // there's nothing to .catch() on that call below, so without this
    // listener a permission denial at the adopted-prewarm unmute step
    // (the callee's first-ever media request, now deferred to exactly that
    // moment — see call-prewarm.ts's `muted` option) would silently do
    // nothing instead of surfacing through the same joinError the
    // cold-start path's .join().catch() already shows.
    function handleCameraError(ev: { errorMsg?: { errorMsg?: string } }) {
      console.error("Daily camera-error:", ev.errorMsg?.errorMsg);
      setJoinError("media");
    }

    function attach(c: DailyCall) {
      c.on("participant-joined", handleParticipantJoined);
      c.on("participant-updated", refreshParticipants);
      c.on("participant-left", refreshParticipants);
      c.on("left-meeting", handleLeftMeeting);
      c.on("error", handleFatalError);
      c.on("network-connection", handleNetworkConnection);
      c.on("available-devices-updated", (ev) =>
        applyDevices(ev.availableDevices as DailyMediaDeviceInfo[]),
      );
      c.on("app-message", handleAppMessage);
      c.on("camera-error", handleCameraError);
      // Covers devices already available the moment the call starts — the
      // event above only fires on a later change.
      c.enumerateDevices().then(({ devices }) => applyDevices(devices as DailyMediaDeviceInfo[]));
    }

    function coldStart() {
      // Dynamic import, not static — same reasoning as CallFrame/
      // LiveVideoFrame: this package touches browser globals at module load,
      // which can't happen during this "use client" component's initial
      // server-rendered pass.
      import("@daily-co/daily-js")
        .then(({ default: DailyIframe }) => {
          if (cancelled) return;

          // avoidEval: true — this app's CSP (src/proxy.ts) never allows
          // 'unsafe-eval' in production; without this the call object fails to
          // initialize (same requirement live-video-frame.tsx already has).
          const c = DailyIframe.createCallObject({ dailyConfig: { avoidEval: true } });
          call = c;
          callRef.current = c;
          attach(c);

          c.join({ url: roomUrl, token, startVideoOff: type === "AUDIO" })
            .then(() => {
              if (cancelled) return;
              refreshParticipants();
            })
            .catch((err: unknown) => {
              // A failed first join is retried the same way as a drop
              // mid-call, rather than leaving a call that never connected
              // sitting on screen. Daily may also raise "error" for the
              // same failure; whichever of the two gets here first starts
              // the reconnect and the other is ignored (see
              // handleInvoluntaryLeave).
              handleInvoluntaryLeave(dailyErrorType(err));
            });

          onCallObject?.(c);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          // No call object at all — the daily-js chunk didn't load, or
          // createCallObject refused (it throws while another instance
          // still exists). There's nothing to retry join() on, so this is
          // the one failure that's only reported; the user can hang up, and
          // the other side's grace period ends the call otherwise.
          console.error("Daily call setup failed:", err);
          setJoinError("join");
        });
    }

    // Either side can have a prewarmed join waiting under this key by now
    // (see call-prewarm.ts) — the caller's already joined live, the
    // callee's joined muted during their own ring. Adopting it means this
    // mount (which only ever happens post-Accept) skips redoing the
    // import+createCallObject+join sequence entirely. Falls back to the
    // normal cold-start path otherwise (no prewarm was ever started, or its
    // join failed).
    const prewarmed = prewarmKey ? takePrewarmedCall(prewarmKey) : undefined;

    if (prewarmed) {
      prewarmed
        .then((c) => {
          if (cancelled) {
            c.destroy();
            return;
          }
          call = c;
          callRef.current = c;
          attach(c);
          // Already joined — no join() call here (Daily doesn't support
          // joining twice; see call-session.tsx's reconnectingRef comment
          // on that same constraint). participants() already reflects
          // whoever's in the room by now.
          refreshParticipants();
          // The actual "Accept" moment for local media: a no-op for the
          // caller's prewarm (already live), but for the callee's muted
          // prewarm this is the first time audio/video is requested at
          // all — exactly now, not during ringing, so the permission
          // prompt (if needed) and any capture/send only ever happen once
          // the user has actually accepted. A failure here (denied
          // permission, device in use, ...) surfaces via the
          // "camera-error" listener attach() just registered, not a thrown
          // error from these two calls themselves (they return the call
          // object, not a Promise).
          c.setLocalAudio(true);
          if (type === "VIDEO") c.setLocalVideo(true);
          onCallObject?.(c);
          // Dropped out of the room while still ringing, before there was
          // anything here listening for it.
          if (c.meetingState() !== "joined-meeting") handleInvoluntaryLeave(null);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          // The prewarmed join failed — often just the network not being
          // up yet while the phone was still ringing. That call object is
          // already destroyed (prewarmCall does it before rejecting), so
          // start over from scratch: the cold-start path gets the same
          // bounded retry as any other failed first join, instead of the
          // call sitting on an error it could have recovered from.
          console.error("Prewarmed Daily call join failed, starting fresh:", err);
          coldStart();
        });
    } else {
      coldStart();
    }

    endCallRef.current = finish;
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      endCallRef.current = null;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearReconnectTimers();
      if (cameraRecheckTimer) clearTimeout(cameraRecheckTimer);
      unwatchCameraTrack();
      const c = callRef.current;
      if (c) {
        c.off("participant-joined", handleParticipantJoined);
        c.off("participant-updated", refreshParticipants);
        c.off("participant-left", refreshParticipants);
        c.off("left-meeting", handleLeftMeeting);
        c.off("error", handleFatalError);
        c.off("network-connection", handleNetworkConnection);
        c.off("app-message", handleAppMessage);
        c.off("camera-error", handleCameraError);
        onCallObject?.(null);
        c.destroy();
        callRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomUrl, token]);

  const local = participants.find((p) => p.local);
  // Not just "everyone that isn't us" — see remotesByUser.
  const remotes = remotesByUser(participants.filter((p) => !p.local));
  // Two or more other people: a grid of tiles. Otherwise the 1:1 layout,
  // with `remote` the one other person (if they're here yet).
  const gridMode = remotes.length > 1;
  const remote = gridMode ? undefined : remotes[0];

  const inGroupCall = Boolean(roster?.group);
  // Someone added to the call hasn't answered yet. Bounded server-side: the
  // timeout-missed-calls cron resolves a ring within two minutes.
  const inviteeRinging = Boolean(
    roster?.group && roster.participants.some((p) => p.status === "RINGING" && p.userId !== selfUserId),
  );
  // This side left the call somewhere other than this UI, or it ended while
  // the room is still up for a moment. Only for a call people were added
  // to — a 1:1 call finds out the ways it always has.
  const removedFromCall = Boolean(roster?.group && roster.over);
  useEffect(() => {
    if (removedFromCall) endCallRef.current?.();
  }, [removedFromCall]);

  // Both adjusted during render (React's supported pattern for state derived
  // from other state) rather than in an effect.
  if (remotes.length > 0 && !hadRemote) setHadRemote(true);
  // While this side is itself out of the room there's no telling whether
  // anyone else is still there — its own reconnect window covers that case.
  const noRemotes = remotes.length === 0 && !reconnecting;
  // Alone, and not because someone this call is ringing hasn't picked up
  // yet: waiting for them isn't a lost connection, and giving up on it
  // after the grace period would end a call they were about to join.
  const peerAbsent = noRemotes && !inviteeRinging;
  if (!peerAbsent && peerLossNoticeDue) setPeerLossNoticeDue(false);

  // Alone in the room for any reason: keep asking whether the call is over.
  // A hang-up over there normally shows up first as the call row ending,
  // which this catches even when the component that started the call (and
  // its realtime subscription) has long since unmounted — and so does a
  // ring that was declined or ran out while this side waited on it.
  useEffect(() => {
    if (!noRemotes) return undefined;
    let stopped = false;
    // Bounded like every other status check (see callIsOver), which also
    // keeps one that never answers from stacking up behind the next.
    function checkStatus() {
      void callIsOver(isCallOverRef.current).then((over) => {
        if (over === true && !stopped) endCallRef.current?.();
      });
    }
    // An ordinary hang-up is by far the likeliest reason for this, so the
    // first check doesn't wait for the poll — it runs soon enough to end
    // the call before the "connection was lost" notice below is due.
    const firstCheck = setTimeout(checkStatus, CALL_PEER_LOSS_FIRST_CHECK_MS);
    const poll = setInterval(checkStatus, CALL_PEER_LOSS_STATUS_POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(firstCheck);
      clearInterval(poll);
    };
  }, [noRemotes]);

  // The other side is gone without the call having ended: their app was
  // killed, their network dropped, or (before anyone arrived) they never
  // made it in. Wait out CALL_PEER_LOSS_GRACE_MS — long enough for their
  // own reconnect attempts to run out first — then end the call from here,
  // rather than sitting on "Connecting…" indefinitely. The status checks
  // above run alongside and normally end an ordinary hang-up first.
  useEffect(() => {
    if (!peerAbsent) return undefined;
    const notice = setTimeout(() => setPeerLossNoticeDue(true), CALL_PEER_LOSS_NOTICE_DELAY_MS);
    const grace = setTimeout(() => endCallRef.current?.(), CALL_PEER_LOSS_GRACE_MS);
    return () => {
      clearTimeout(notice);
      clearTimeout(grace);
    };
  }, [peerAbsent]);
  const localVideoTrack = local?.tracks.video.persistentTrack;

  // Both of these turned out unreliable on their own — confirmed live on a
  // Samsung phone that (a) enumerateDevices() reported only one videoinput
  // entry (some Android camera HALs collapse front+back into a single
  // device that changes facing mode via constraints instead of exposing two
  // devices) AND (b) getCapabilities().facingMode came back undefined too
  // (Android Chrome's camera-capability reporting is itself incomplete —
  // this is a known Chromium/Android gap, not specific to that HAL). Kept
  // as best-effort signals for browsers that DO report them accurately
  // (most laptops correctly report exactly one camera; the flip button
  // should stay hidden there), but isNativeApp below is the signal that
  // actually decides it for this app's real audience — see below.
  function getCanFlipFacingMode() {
    if (!localVideoTrack || typeof localVideoTrack.getCapabilities !== "function") return false;
    try {
      const facingModes = localVideoTrack.getCapabilities().facingMode;
      return Array.isArray(facingModes) && facingModes.length > 1;
    } catch {
      return false;
    }
  }
  const canFlipFacingMode = getCanFlipFacingMode();
  // This component only ever renders for a 1:1 video call, and the native
  // Android/iOS wrapper (capacitor.config.ts) is this app's actual mobile
  // audience — every device it runs on has a front and back camera, so
  // there's no "dead click" risk to gate against the way there is for the
  // audio-output button. Unlike cameraCount/canFlipFacingMode, this is a
  // signal about the RUNTIME (native app vs. browser tab), not the specific
  // hardware, which is exactly why it doesn't share their false-negative
  // problem on this device.
  const isNativeApp = typeof window !== "undefined" && Capacitor.isNativePlatform();

  const localAudioOn = Boolean(local && trackIsOn(local.tracks.audio.state));
  const localVideoOn = Boolean(local && trackIsOn(local.tracks.video.state));
  const localScreenSharing = Boolean(local && trackIsOn(local.tracks.screenVideo.state));

  function toggleAudio() {
    hapticSelection();
    mediaIntentRef.current = { ...mediaIntentRef.current, audio: !localAudioOn };
    callRef.current?.setLocalAudio(!localAudioOn);
  }
  function toggleVideo() {
    hapticSelection();
    mediaIntentRef.current = { ...mediaIntentRef.current, video: !localVideoOn };
    callRef.current?.setLocalVideo(!localVideoOn);
  }
  function toggleScreenShare() {
    hapticSelection();
    if (localScreenSharing) callRef.current?.stopScreenShare();
    else callRef.current?.startScreenShare();
  }
  function toggleHold() {
    const call = callRef.current;
    if (!call) return;
    if (isOnHold) {
      // Resuming is the lighter touch of the two — picking back up where
      // you left off, not a new commitment.
      hapticImpact("light");
      const prev = preHoldStateRef.current;
      call.setLocalAudio(prev?.audio ?? true);
      call.setLocalVideo(prev?.video ?? false);
      setIsOnHold(false);
      isOnHoldRef.current = false;
      broadcastHoldState(call, false);
    } else {
      // Putting the call on hold is the more deliberate action of the two —
      // a medium impact, same weight as the call accept/decline below.
      hapticImpact("medium");
      // Captured before muting below — setLocalAudio/Video(false) is what
      // Resume needs to undo, so the pre-hold state has to be read first.
      preHoldStateRef.current = { audio: localAudioOn, video: localVideoOn };
      if (localScreenSharing) call.stopScreenShare();
      call.setLocalAudio(false);
      call.setLocalVideo(false);
      setIsOnHold(true);
      isOnHoldRef.current = true;
      broadcastHoldState(call, true);
    }
  }
  function switchOutput() {
    if (outputDevices.length === 0) return;
    const nextIndex = (outputIndex + 1) % outputDevices.length;
    callRef.current
      ?.setOutputDeviceAsync({ outputDeviceId: outputDevices[nextIndex].deviceId })
      .then(() => setOutputIndex(nextIndex));
  }
  function switchCamera() {
    callRef.current?.cycleCamera({ preferDifferentFacingMode: true });
  }

  const onSpeaker = Boolean(outputDevices[outputIndex] && isSpeakerDevice(outputDevices[outputIndex]));

  // The tile only ever holds whichever participant ISN'T currently the
  // main view — undefined when that participant isn't actually available
  // yet (e.g. swapped to "remote main" before remote has joined), which
  // hides the tile entirely rather than showing an empty box. Also hidden
  // during a hold on either side — there's no local video being sent (ours
  // off while isOnHold) or worth showing (remote's off while remoteOnHold)
  // for the draggable tile to usefully display.
  const remoteOnHold = Boolean(remote && hasNotice(remoteHolds, remote));
  const remoteCameraPaused = Boolean(remote && hasNotice(remoteCamerasPaused, remote));
  const onHold = isOnHold || remoteOnHold;
  function knownRemoteName(participant: DailyParticipant) {
    const listed = roster?.participants.find((p) => p.userId === participant.user_id);
    return listed?.name || participant.user_name || null;
  }
  function remoteName(participant: DailyParticipant) {
    return knownRemoteName(participant) ?? t.guest;
  }
  // The session's label names whoever the call started with, which stops
  // being the right name once people have been added and others have left.
  // Who the notices below are about: a name where there is one, otherwise "the other participant" or "everyone
  // else" (each notice has its own wording for those, see peerNotice).
  function groupPeer(): CallPeer {
    if (remote) return callPeer(knownRemoteName(remote));
    const others = roster?.participants.filter((p) => p.status === "JOINED" && p.userId !== selfUserId) ?? [];
    return others.length === 1 ? callPeer(others[0].name) : { kind: "everyone" };
  }
  const peer = inGroupCall ? groupPeer() : callPeer(peerName);
  // Tap-to-swap only exists in the 1:1 layout; in the grid the tile is
  // always this side's own camera.
  const swapped = selfViewIsMain && !gridMode;
  const statusNotice =
    reconnecting || networkInterrupted
      ? t.reconnecting
      : peerLossNoticeDue && hadRemote
        ? peerNotice(peer, {
            named: t.peerLost,
            other: t.peerLostOther,
            everyone: t.peerLostEveryone,
            private: t.peerLostPrivate,
          })
        : null;
  const remoteCameraPausedLabel = remoteCameraPaused
    ? peerNotice(peer, {
        named: t.cameraPaused,
        other: t.cameraPausedOther,
        everyone: t.cameraPausedEveryone,
        private: t.cameraPausedPrivate,
      })
    : undefined;
  const tileParticipant = onHold ? undefined : swapped ? remote : local && localVideoOn ? local : undefined;

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-black">
      {/* Muted (not unmounted) while we're the one on hold — keeps the
          remote audio track alive so it picks back up instantly on Resume,
          same reasoning as SelfVideo always muting its own mic playback. */}
      {/* One element per person, keyed by who they are rather than by
          session, so neither a rejoin nor the layout changing between 1:1
          and grid re-creates anyone's audio. */}
      {remotes.map((r) => (
        <RemoteAudio key={r.user_id || r.session_id} participant={r} muted={isOnHold} />
      ))}

      {isOnHold ? (
        <HoldOverlay text={t.callOnHold} />
      ) : gridMode ? (
        // Same grid as live-video-frame.tsx's broadcaster tiles, with rows
        // sharing the height so eight people still fit one screen.
        <div
          className="absolute inset-0 grid gap-1 p-1"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gridAutoRows: "minmax(0, 1fr)" }}
        >
          {remotes.map((r) => (
            <RemoteTile
              key={r.user_id || r.session_id}
              participant={r}
              name={remoteName(r)}
              avatarUrl={roster?.participants.find((p) => p.userId === r.user_id)?.avatarUrl ?? null}
              onHold={hasNotice(remoteHolds, r)}
              cameraPaused={hasNotice(remoteCamerasPaused, r)}
            />
          ))}
        </div>
      ) : remoteOnHold ? (
        <HoldOverlay
          text={peerNotice(peer, {
            named: t.peerHold,
            other: t.peerHoldOther,
            everyone: t.peerHoldEveryone,
            private: t.peerHoldPrivate,
          })}
        />
      ) : swapped && local ? (
        <SelfVideo participant={local} />
      ) : remote ? (
        <RemoteVideo participant={remote} className="h-full w-full object-contain" pausedLabel={remoteCameraPausedLabel} />
      ) : (
        <div className="flex flex-col items-center gap-1 px-4 text-center text-sm text-white/60">
          {joinError ? (
            <span role="alert" className="text-danger">
              {t.errors[joinError]}
            </span>
          ) : (
            !statusNotice && <span role="status">{t.connecting}</span>
          )}
        </div>
      )}

      {/* Centred over whatever the main view is showing rather than tucked
          into a corner: every corner is already taken (the self-view tile,
          the minimized widget's own label and buttons, the control tray),
          and this has to stay readable in the minimized widget too. */}
      {statusNotice && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-4">
          <span
            role="status"
            className="hig-material-dark rounded-full bg-black/60 px-3 py-1.5 text-center text-sm text-white backdrop-blur-md"
          >
            {statusNotice}
          </span>
        </div>
      )}

      {tileParticipant && (
        <div
          ref={selfViewRef}
          {...selfViewHandlers}
          onClick={() => {
            if (!gridMode) setSelfViewIsMain((v) => !v);
          }}
          // A div rather than a real <button> because it's also the drag
          // target (selfViewHandlers) and wraps a <video> — so the button
          // semantics are added by hand instead.
          role="button"
          tabIndex={0}
          aria-label={gridMode ? t.yourVideo : t.swap}
          onKeyDown={(e) => {
            if (gridMode) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setSelfViewIsMain((v) => !v);
            }
          }}
          title={gridMode ? t.dragToMove : t.dragOrSwap}
          className="chrome-scale fixed z-10 h-32 w-24 cursor-grab touch-none select-none overflow-hidden rounded-xl border border-white/20 bg-black shadow-lg active:cursor-grabbing sm:h-40 sm:w-28"
          style={selfViewPosition ? { left: selfViewPosition.left, top: selfViewPosition.top } : { top: "calc(1rem + max(env(safe-area-inset-top), var(--status-bar-inset-top, 0px)))", left: "1rem" }}
        >
          {swapped ? (
            <RemoteVideo participant={tileParticipant} className="h-full w-full object-cover" pausedLabel={remoteCameraPausedLabel} />
          ) : (
            <SelfVideo participant={tileParticipant} />
          )}
        </div>
      )}

      {/* Fills the same bottom-tray footprint Daily's Prebuilt tray used to
          — GlobalCallFrame's own Leave/Minimize bar (bottom-right, z-[80])
          sits above this, same as it does over CallFrame's iframe. Falls
          back to var(--safe-area-inset-bottom) alongside env() — see
          nav.tsx's comment on why the plain env() alone isn't reliable
          enough on Android here.

          Below sm the tray is raised to sit above that Leave/Minimize bar
          rather than beside it: five or six buttons centred on a ~390px
          phone reach under the bar, which covered the Switch camera button
          (confirmed live on a real Android call). From sm up the centred
          tray already clears the bar's bottom-right corner. */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center pb-[calc(4.25rem+max(env(safe-area-inset-bottom),var(--safe-area-inset-bottom,0px)))] sm:pb-[calc(0.75rem+max(env(safe-area-inset-bottom),var(--safe-area-inset-bottom,0px)))]"
      >
        {/* chrome-scale: an icon-only row that can't wrap — see globals.css. */}
        <div className="hig-material-dark chrome-scale pointer-events-auto flex items-center gap-2 rounded-full bg-black/60 backdrop-blur-md px-3 py-2">
          <button
            type="button"
            onClick={toggleAudio}
            disabled={isOnHold || reconnecting}
            title={localAudioOn ? controls.mute : controls.unmute}
            aria-label={localAudioOn ? controls.muteMic : controls.unmuteMic}
            className={`flex h-10 w-10 items-center justify-center rounded-full text-white transition-transform active:scale-90 disabled:opacity-50 ${localAudioOn ? "bg-white/20" : "bg-danger"}`}
          >
            {localAudioOn ? <Mic size={16} /> : <MicOff size={16} />}
          </button>
          <button
            type="button"
            onClick={toggleVideo}
            disabled={isOnHold || reconnecting}
            // Not gated on the call's initial `type` — the underlying Daily
            // room/token draws no distinction between "audio" and "video"
            // calls (see daily.ts), so switching video on/off is always
            // available regardless of how the call started, letting either
            // side turn a voice call into a video call and back mid-call.
            title={localVideoOn ? controls.cameraOff : controls.cameraOn}
            aria-label={localVideoOn ? controls.cameraOff : controls.cameraOn}
            className={`flex h-10 w-10 items-center justify-center rounded-full text-white transition-transform active:scale-90 disabled:opacity-50 ${localVideoOn ? "bg-white/20" : "bg-danger"}`}
          >
            {localVideoOn ? <Video size={16} /> : <VideoOff size={16} />}
          </button>
          {/* Hold/Resume — pauses this side's outgoing audio/video (and any
              screen share) and mutes incoming audio locally, same mental
              model as a phone system's hold, without hold music. Left
              enabled even while remoteOnHold (either side can hold
              independently) — only our OWN hold state gates the other
              media buttons above/below, since resuming those mid-hold would
              silently undo the hold without the explicit Resume tap. */}
          <button
            type="button"
            onClick={toggleHold}
            // Out of the room there's nobody to tell and nothing to pause —
            // same for the mic/camera/share buttons either side of this.
            disabled={reconnecting}
            title={isOnHold ? controls.resume : controls.hold}
            aria-label={isOnHold ? controls.resume : controls.holdLabel}
            className={`flex h-10 w-10 items-center justify-center rounded-full text-white transition-transform active:scale-90 disabled:opacity-50 ${isOnHold ? "bg-accent text-accent-ink" : "bg-white/20"}`}
          >
            {isOnHold ? <Play size={16} /> : <Pause size={16} />}
          </button>
          <button
            type="button"
            onClick={toggleScreenShare}
            disabled={isOnHold || reconnecting}
            title={localScreenSharing ? controls.stopSharing : controls.shareScreen}
            aria-label={localScreenSharing ? controls.stopSharingScreen : controls.shareScreen}
            className={`flex h-10 w-10 items-center justify-center rounded-full text-white transition-transform active:scale-90 disabled:opacity-50 ${localScreenSharing ? "bg-accent text-accent-ink" : "bg-white/20"}`}
          >
            {localScreenSharing ? <ScreenShareOff size={16} /> : <ScreenShare size={16} />}
          </button>
          {/* isNativeApp is the primary signal (see above) — always shown
              in the actual mobile app. cameraCount/canFlipFacingMode are
              the fallback for a browser tab, where hardware isn't a given.
              Gated on localVideoOn (not the call's initial `type`) so this
              appears/disappears live as video gets turned on/off mid-call,
              matching the always-available toggleVideo button above. */}
          {localVideoOn && (isNativeApp || cameraCount > 1 || canFlipFacingMode) && (
            <button
              type="button"
              onClick={switchCamera}
              disabled={isOnHold}
              title={controls.switchCameraHint}
              aria-label={controls.switchCamera}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-white transition-transform active:scale-90 disabled:opacity-50"
            >
              <SwitchCamera size={16} />
            </button>
          )}
          {/* Only shown once more than one output device is known — a
              single-option "switch" button would be a dead click, same
              reasoning as call-frame.tsx's own speaker button. */}
          {outputDevices.length > 1 && (
            <button
              type="button"
              onClick={switchOutput}
              title={controls.switchOutputHint}
              aria-label={controls.switchOutput}
              className={`flex h-10 w-10 items-center justify-center rounded-full text-white transition-transform active:scale-90 ${onSpeaker ? "bg-accent text-accent-ink" : "bg-white/20"}`}
            >
              <Volume2 size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Replaces the main video area while either side has the call on hold. */
function HoldOverlay({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 text-center text-sm text-white/70">
      <Pause size={28} />
      <span>{text}</span>
    </div>
  );
}

/**
 * One person's tile in the grid a call with several others shows: their
 * camera or screen share, their avatar when there's no picture, and their
 * name. A hold or a backgrounded camera is shown on their tile alone — it's
 * theirs, not the call's.
 */
function RemoteTile({
  participant,
  name,
  avatarUrl,
  onHold,
  cameraPaused,
}: {
  participant: DailyParticipant;
  name: string;
  avatarUrl: string | null;
  onHold: boolean;
  cameraPaused: boolean;
}) {
  const { t: calls } = useCallsText();
  const t = calls.direct;
  const muted = !trackIsOn(participant.tracks.audio.state);
  return (
    <div className="relative flex min-h-0 min-w-0 items-center justify-center overflow-hidden rounded-lg bg-white/5">
      {onHold ? (
        <HoldOverlay text={t.onHold} />
      ) : (
        <RemoteVideo
          participant={participant}
          className="h-full w-full object-cover"
          pausedLabel={cameraPaused ? t.cameraPausedShort : undefined}
          fallback={<UserAvatar avatarUrl={avatarUrl} name={name} size={56} />}
        />
      )}
      {/* Top rather than bottom: the control tray overlays the bottom row. */}
      <span className="absolute left-1 top-1 flex max-w-[calc(100%-0.5rem)] items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-xs text-white">
        {muted && <MicOff size={12} className="shrink-0" aria-label={t.muted} />}
        <span dir="auto" className="truncate">{name}</span>
      </span>
    </div>
  );
}

/**
 * Remote participant's audio only — mounted once, unconditionally,
 * regardless of whether their video is currently in the main slot or the
 * draggable tile (see the tap-to-swap state in DirectCallFrame). Keeping
 * it independent of that layout means swapping never has to tear down and
 * recreate the audio element, which would otherwise blip the call audio
 * on every tap.
 */
function RemoteAudio({ participant, muted = false }: { participant: DailyParticipant; muted?: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioTrack = participant.tracks.audio;

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.srcObject =
      audioTrack.state === "playable" && audioTrack.persistentTrack
        ? new MediaStream([audioTrack.persistentTrack])
        : null;
  }, [audioTrack.state, audioTrack.persistentTrack]);

  // Muted via the element itself, not by tearing down srcObject — the track
  // stays attached so Resume picks audio back up instantly instead of
  // waiting on a fresh attach.
  useEffect(() => {
    const el = audioRef.current;
    if (el) el.muted = muted;
  }, [muted]);

  return <audio ref={audioRef} autoPlay playsInline />;
}

/**
 * Remote participant's video only (camera, or their screen share if they're
 * sharing) — sized by whichever slot renders it. `pausedLabel` is set while
 * their camera is stopped because their app is in the background (see
 * call-camera-pause.ts): the picture is hidden behind that text instead of
 * left frozen on its last frame. A screen share isn't affected. `fallback`
 * (a grid tile's avatar) replaces the plain name shown when there's no
 * picture.
 */
function RemoteVideo({
  participant,
  className,
  pausedLabel,
  fallback,
}: {
  participant: DailyParticipant;
  className: string;
  pausedLabel?: string;
  fallback?: ReactNode;
}) {
  const { t: calls } = useCallsText();
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoTrack = participant.tracks.video;
  const screenTrack = participant.tracks.screenVideo;
  const displayTrack = screenTrack.state === "playable" ? screenTrack : videoTrack;

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject =
      displayTrack.state === "playable" && displayTrack.persistentTrack
        ? new MediaStream([displayTrack.persistentTrack])
        : null;
  }, [displayTrack.state, displayTrack.persistentTrack]);

  const cameraPaused = Boolean(pausedLabel) && displayTrack === videoTrack;
  const hasVideo = displayTrack.state === "playable" && !cameraPaused;

  return (
    <>
      <video ref={videoRef} autoPlay playsInline className={`${className} ${hasVideo ? "" : "hidden"}`} />
      {!hasVideo &&
        (fallback ? (
          <div className="absolute flex flex-col items-center gap-2 px-2 text-center text-xs text-white/60">
            {fallback}
            {cameraPaused && <span>{pausedLabel}</span>}
          </div>
        ) : (
          <span className="absolute px-2 text-center text-sm text-white/60">
            {cameraPaused ? pausedLabel : participant.user_name || calls.direct.connecting}
          </span>
        ))}
    </>
  );
}

/** Local self-view: camera only, muted (never play your own mic back to yourself), mirrored like any other self-view. */
function SelfVideo({ participant }: { participant: DailyParticipant }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoTrack = participant.tracks.video;

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject =
      videoTrack.state === "playable" && videoTrack.persistentTrack
        ? new MediaStream([videoTrack.persistentTrack])
        : null;
  }, [videoTrack.state, videoTrack.persistentTrack]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      className="h-full w-full object-cover [transform:scaleX(-1)]"
    />
  );
}
