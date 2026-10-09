"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Pause, Play, ScreenShare, ScreenShareOff, SwitchCamera, Video, VideoOff, Volume2 } from "lucide-react";
import type { DailyCall, DailyMediaDeviceInfo, DailyParticipant } from "@daily-co/daily-js";
import { Capacitor } from "@capacitor/core";
import { useViewportDrag } from "@/lib/use-viewport-drag";
import { broadcastHoldState, holdStateFromAppMessage } from "@/lib/call-hold";
import { takePrewarmedCall } from "@/lib/call-prewarm";
import { hapticSelection, hapticImpact } from "@/lib/haptics";

/** Same heuristic as call-frame.tsx's audio-output switcher — deviceId/ordering aren't reliable, the label is. */
function isSpeakerDevice(device: MediaDeviceInfo) {
  return /speaker/i.test(device.label);
}

function trackIsOn(state: DailyParticipant["tracks"]["audio"]["state"]) {
  return state !== "off" && state !== "blocked";
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
 * Scoped to regular 1:1 calls only (see call-session.tsx's `renderer:
 * "direct"`) — Collab (which can have more than 2 participants) stays on
 * CallFrame/Prebuilt for now. Ringing/pre-accept UI lives entirely in
 * call-button.tsx/incoming-call-listener.tsx; by the time this mounts the
 * call has already been accepted, so there's no lobby/prejoin state to
 * handle here — just "connecting" for the brief gap before the remote
 * participant's tracks arrive.
 */
export function DirectCallFrame({
  roomUrl,
  token,
  type,
  onLeave,
  onCallObject,
  peerName,
  prewarmKey,
}: {
  roomUrl: string;
  token: string;
  type: "AUDIO" | "VIDEO";
  onLeave: () => void;
  onCallObject?: (call: DailyCall | null) => void;
  /** The other participant's display name — used only for the hold overlay's "X put the call on hold" text. Falls back to a generic phrase when omitted. */
  peerName?: string;
  /** Same `call:${callId}` key call-session.tsx uses — if call-prewarm.ts already has (or is still joining) a call object under this key, adopt it instead of creating/joining a fresh one (see call-prewarm.ts). Both sides can have one now: the caller's joins live, the callee's joins muted and gets unmuted below once adopted — either way, omitted means create fresh instead (the normal cold-start fallback, e.g. a prewarm that was never started or already failed). */
  prewarmKey?: string;
}) {
  const callRef = useRef<DailyCall | null>(null);
  const [participants, setParticipants] = useState<DailyParticipant[]>([]);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [outputDevices, setOutputDevices] = useState<DailyMediaDeviceInfo[]>([]);
  const [outputIndex, setOutputIndex] = useState(0);
  const [cameraCount, setCameraCount] = useState(0);
  // isOnHold: this side placed the call on hold (local audio/video forced
  // off, remote's audio muted locally — see toggleHold). remoteOnHold: the
  // other side did, learned only from their broadcastHoldState app-message
  // (see call-hold.ts) since their tracks simply going "off" is otherwise
  // indistinguishable from an ordinary mute.
  const [isOnHold, setIsOnHold] = useState(false);
  const [remoteOnHold, setRemoteOnHold] = useState(false);
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

  useEffect(() => {
    let cancelled = false;
    let call: DailyCall | null = null;

    function refreshParticipants() {
      if (!call) return;
      setParticipants(Object.values(call.participants()));
    }

    function applyDevices(devices: DailyMediaDeviceInfo[]) {
      setOutputDevices(devices.filter((d) => d.kind === "audiooutput"));
      setCameraCount(devices.filter((d) => d.kind === "videoinput").length);
    }

    function handleAppMessage(ev: { data: unknown }) {
      const onHold = holdStateFromAppMessage(ev.data);
      if (onHold !== null) setRemoteOnHold(onHold);
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
      setJoinError("Couldn't access your camera or microphone — check your permissions and try again.");
    }

    function attach(c: DailyCall) {
      c.on("participant-joined", refreshParticipants);
      c.on("participant-updated", refreshParticipants);
      c.on("participant-left", refreshParticipants);
      c.on("left-meeting", onLeave);
      c.on("available-devices-updated", (ev) =>
        applyDevices(ev.availableDevices as DailyMediaDeviceInfo[]),
      );
      c.on("app-message", handleAppMessage);
      c.on("camera-error", handleCameraError);
      // Covers devices already available the moment the call starts — the
      // event above only fires on a later change.
      c.enumerateDevices().then(({ devices }) => applyDevices(devices as DailyMediaDeviceInfo[]));
    }

    // Either side can have a prewarmed join waiting under this key by now
    // (see call-prewarm.ts) — the caller's already joined live, the
    // callee's joined muted during their own ring. Adopting it means this
    // mount (which only ever happens post-Accept) skips redoing the
    // import+createCallObject+join sequence entirely. Falls back to the
    // normal cold-start path otherwise (no prewarm was ever started, or it
    // already failed).
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
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          // Same clean, fixed message as the cold-start path below — not
          // err.message — regardless of what Daily's SDK actually threw.
          console.error("Daily call join failed:", err);
          setJoinError("Couldn't join the call. Check your connection and try again.");
        });
    } else {
      // Dynamic import, not static — same reasoning as CallFrame/
      // LiveVideoFrame: this package touches browser globals at module load,
      // which can't happen during this "use client" component's initial
      // server-rendered pass.
      import("@daily-co/daily-js").then(({ default: DailyIframe }) => {
        if (cancelled) return;

        // avoidEval: true — this app's CSP (src/proxy.ts) never allows
        // 'unsafe-eval' in production; without this the call object fails to
        // initialize (same requirement live-video-frame.tsx already has).
        call = DailyIframe.createCallObject({ dailyConfig: { avoidEval: true } });
        callRef.current = call;
        attach(call);

        call
          .join({ url: roomUrl, token, startVideoOff: type === "AUDIO" })
          .then(() => {
            if (cancelled) return;
            refreshParticipants();
          })
          .catch((err: unknown) => {
            if (cancelled) return;
            // A clean, fixed message — not err.message — regardless of what
            // Daily's SDK actually threw.
            console.error("Daily call join failed:", err);
            setJoinError("Couldn't join the call. Check your connection and try again.");
          });

        onCallObject?.(call);
      });
    }

    return () => {
      cancelled = true;
      const c = callRef.current;
      if (c) {
        c.off("participant-joined", refreshParticipants);
        c.off("participant-updated", refreshParticipants);
        c.off("participant-left", refreshParticipants);
        c.off("left-meeting", onLeave);
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
  const remote = participants.find((p) => !p.local);
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
    callRef.current?.setLocalAudio(!localAudioOn);
  }
  function toggleVideo() {
    hapticSelection();
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
  const onHold = isOnHold || remoteOnHold;
  const tileParticipant = onHold ? undefined : selfViewIsMain ? remote : local && localVideoOn ? local : undefined;

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-black">
      {/* Muted (not unmounted) while we're the one on hold — keeps the
          remote audio track alive so it picks back up instantly on Resume,
          same reasoning as SelfVideo always muting its own mic playback. */}
      {remote && <RemoteAudio participant={remote} muted={isOnHold} />}

      {isOnHold ? (
        <HoldOverlay text="Call on hold" />
      ) : remoteOnHold ? (
        <HoldOverlay text={`${peerName || "The other participant"} put the call on hold`} />
      ) : selfViewIsMain && local ? (
        <SelfVideo participant={local} />
      ) : remote ? (
        <RemoteVideo participant={remote} className="h-full w-full object-contain" />
      ) : (
        <div className="flex flex-col items-center gap-1 px-4 text-center text-sm text-white/60">
          {joinError ? (
            <span role="alert" className="text-danger">
              {joinError}
            </span>
          ) : (
            <span role="status">Connecting…</span>
          )}
        </div>
      )}

      {tileParticipant && (
        <div
          ref={selfViewRef}
          {...selfViewHandlers}
          onClick={() => setSelfViewIsMain((v) => !v)}
          // A div rather than a real <button> because it's also the drag
          // target (selfViewHandlers) and wraps a <video> — so the button
          // semantics are added by hand instead.
          role="button"
          tabIndex={0}
          aria-label="Swap your video with the main view"
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setSelfViewIsMain((v) => !v);
            }
          }}
          title="Drag to move, tap to swap with the main view"
          className="chrome-scale fixed z-10 h-32 w-24 cursor-grab touch-none select-none overflow-hidden rounded-xl border border-white/20 bg-black shadow-lg active:cursor-grabbing sm:h-40 sm:w-28"
          style={selfViewPosition ? { left: selfViewPosition.left, top: selfViewPosition.top } : { top: "1rem", left: "1rem" }}
        >
          {selfViewIsMain ? (
            <RemoteVideo participant={tileParticipant} className="h-full w-full object-cover" />
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
            disabled={isOnHold}
            title={localAudioOn ? "Mute" : "Unmute"}
            aria-label={localAudioOn ? "Mute microphone" : "Unmute microphone"}
            className={`flex h-10 w-10 items-center justify-center rounded-full text-white transition-transform active:scale-90 disabled:opacity-50 ${localAudioOn ? "bg-white/20" : "bg-danger"}`}
          >
            {localAudioOn ? <Mic size={16} /> : <MicOff size={16} />}
          </button>
          <button
            type="button"
            onClick={toggleVideo}
            disabled={isOnHold}
            // Not gated on the call's initial `type` — the underlying Daily
            // room/token draws no distinction between "audio" and "video"
            // calls (see daily.ts), so switching video on/off is always
            // available regardless of how the call started, letting either
            // side turn a voice call into a video call and back mid-call.
            title={localVideoOn ? "Turn off camera" : "Turn on camera"}
            aria-label={localVideoOn ? "Turn off camera" : "Turn on camera"}
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
            title={isOnHold ? "Resume call" : "Hold call"}
            aria-label={isOnHold ? "Resume call" : "Put call on hold"}
            className={`flex h-10 w-10 items-center justify-center rounded-full text-white transition-transform active:scale-90 ${isOnHold ? "bg-accent text-accent-ink" : "bg-white/20"}`}
          >
            {isOnHold ? <Play size={16} /> : <Pause size={16} />}
          </button>
          <button
            type="button"
            onClick={toggleScreenShare}
            disabled={isOnHold}
            title={localScreenSharing ? "Stop sharing" : "Share screen"}
            aria-label={localScreenSharing ? "Stop sharing screen" : "Share screen"}
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
              title="Switch between front and back camera"
              aria-label="Switch camera"
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
              title="Switch audio output (speaker, earpiece, headset...)"
              aria-label="Switch audio output"
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

/** Remote participant's video only (camera, or their screen share if they're sharing) — sized by whichever slot renders it. */
function RemoteVideo({ participant, className }: { participant: DailyParticipant; className: string }) {
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

  const hasVideo = displayTrack.state === "playable";

  return (
    <>
      <video ref={videoRef} autoPlay playsInline className={`${className} ${hasVideo ? "" : "hidden"}`} />
      {!hasVideo && (
        <span className="absolute text-sm text-white/60">{participant.user_name || "Connecting…"}</span>
      )}
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
