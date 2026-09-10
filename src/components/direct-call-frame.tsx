"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, ScreenShare, ScreenShareOff, SwitchCamera, Video, VideoOff, Volume2 } from "lucide-react";
import type { DailyCall, DailyMediaDeviceInfo, DailyParticipant } from "@daily-co/daily-js";
import { useViewportDrag } from "@/lib/use-viewport-drag";

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
}: {
  roomUrl: string;
  token: string;
  type: "AUDIO" | "VIDEO";
  onLeave: () => void;
  onCallObject?: (call: DailyCall | null) => void;
}) {
  const callRef = useRef<DailyCall | null>(null);
  const [participants, setParticipants] = useState<DailyParticipant[]>([]);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [outputDevices, setOutputDevices] = useState<DailyMediaDeviceInfo[]>([]);
  const [outputIndex, setOutputIndex] = useState(0);
  const [cameraCount, setCameraCount] = useState(0);
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

      call.on("participant-joined", refreshParticipants);
      call.on("participant-updated", refreshParticipants);
      call.on("participant-left", refreshParticipants);
      call.on("left-meeting", onLeave);
      call.on("available-devices-updated", (ev) =>
        applyDevices(ev.availableDevices as DailyMediaDeviceInfo[]),
      );
      // Covers devices already available the moment the call starts — the
      // event above only fires on a later change.
      call.enumerateDevices().then(({ devices }) => applyDevices(devices as DailyMediaDeviceInfo[]));

      call
        .join({ url: roomUrl, token, startVideoOff: type === "AUDIO" })
        .then(() => {
          if (cancelled) return;
          refreshParticipants();
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setJoinError(err instanceof Error ? err.message : "Couldn't connect");
        });

      onCallObject?.(call);
    });

    return () => {
      cancelled = true;
      const c = callRef.current;
      if (c) {
        c.off("participant-joined", refreshParticipants);
        c.off("participant-updated", refreshParticipants);
        c.off("participant-left", refreshParticipants);
        c.off("left-meeting", onLeave);
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

  // Belt-and-suspenders alongside cameraCount: confirmed live that some
  // Android camera HALs (Samsung's included) expose front+back as a SINGLE
  // enumerateDevices() videoinput entry that switches facing mode via
  // constraints, rather than as two separate device entries — cameraCount
  // alone read 1 there and the button never showed, even though
  // cycleCamera() itself worked fine on that hardware. getCapabilities() on
  // the actual live track is the more direct signal: it reports every
  // facingMode the current camera can actually produce. Pure/synchronous
  // read off the current track (same as localAudioOn etc. below), so a
  // plain derived value each render, not state.
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

  const localAudioOn = Boolean(local && trackIsOn(local.tracks.audio.state));
  const localVideoOn = Boolean(local && trackIsOn(local.tracks.video.state));
  const localScreenSharing = Boolean(local && trackIsOn(local.tracks.screenVideo.state));

  function toggleAudio() {
    callRef.current?.setLocalAudio(!localAudioOn);
  }
  function toggleVideo() {
    callRef.current?.setLocalVideo(!localVideoOn);
  }
  function toggleScreenShare() {
    if (localScreenSharing) callRef.current?.stopScreenShare();
    else callRef.current?.startScreenShare();
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
  // hides the tile entirely rather than showing an empty box.
  const tileParticipant = selfViewIsMain ? remote : local && localVideoOn ? local : undefined;

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-black">
      {remote && <RemoteAudio participant={remote} />}

      {selfViewIsMain && local ? (
        <SelfVideo participant={local} />
      ) : remote ? (
        <RemoteVideo participant={remote} className="h-full w-full object-contain" />
      ) : (
        <div className="flex flex-col items-center gap-1 px-4 text-center text-sm text-white/60">
          {joinError ? <span className="text-danger">{joinError}</span> : "Connecting…"}
        </div>
      )}

      {type === "VIDEO" && tileParticipant && (
        <div
          ref={selfViewRef}
          {...selfViewHandlers}
          onClick={() => setSelfViewIsMain((v) => !v)}
          title="Drag to move, tap to swap with the main view"
          className="fixed z-10 h-32 w-24 cursor-grab touch-none select-none overflow-hidden rounded-xl border border-white/20 bg-black shadow-lg active:cursor-grabbing sm:h-40 sm:w-28"
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
          — GlobalCallFrame's own Leave/Minimize bar (bottom-4 right-4,
          z-[80]) sits above this, same as it does over CallFrame's iframe. */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center pb-3"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-black/60 px-3 py-2">
          <button
            type="button"
            onClick={toggleAudio}
            title={localAudioOn ? "Mute" : "Unmute"}
            aria-label={localAudioOn ? "Mute microphone" : "Unmute microphone"}
            className={`flex h-10 w-10 items-center justify-center rounded-full text-white ${localAudioOn ? "bg-white/20" : "bg-danger"}`}
          >
            {localAudioOn ? <Mic size={16} /> : <MicOff size={16} />}
          </button>
          {type === "VIDEO" && (
            <button
              type="button"
              onClick={toggleVideo}
              title={localVideoOn ? "Turn off camera" : "Turn on camera"}
              aria-label={localVideoOn ? "Turn off camera" : "Turn on camera"}
              className={`flex h-10 w-10 items-center justify-center rounded-full text-white ${localVideoOn ? "bg-white/20" : "bg-danger"}`}
            >
              {localVideoOn ? <Video size={16} /> : <VideoOff size={16} />}
            </button>
          )}
          <button
            type="button"
            onClick={toggleScreenShare}
            title={localScreenSharing ? "Stop sharing" : "Share screen"}
            aria-label={localScreenSharing ? "Stop sharing screen" : "Share screen"}
            className={`flex h-10 w-10 items-center justify-center rounded-full text-white ${localScreenSharing ? "bg-accent text-accent-ink" : "bg-white/20"}`}
          >
            {localScreenSharing ? <ScreenShareOff size={16} /> : <ScreenShare size={16} />}
          </button>
          {/* Shown once either signal says there's a second camera to flip
              to — device-count (most laptops report exactly one, phones
              report front + back) or the live track's own facingMode
              capabilities (covers HALs that collapse front+back into one
              enumerateDevices() entry — see canFlipFacingMode above). */}
          {type === "VIDEO" && (cameraCount > 1 || canFlipFacingMode) && (
            <button
              type="button"
              onClick={switchCamera}
              title="Switch between front and back camera"
              aria-label="Switch camera"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-white"
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
              className={`flex h-10 w-10 items-center justify-center rounded-full text-white ${onSpeaker ? "bg-accent text-accent-ink" : "bg-white/20"}`}
            >
              <Volume2 size={16} />
            </button>
          )}
        </div>
      </div>
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
function RemoteAudio({ participant }: { participant: DailyParticipant }) {
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
