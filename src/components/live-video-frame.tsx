"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, ScreenShare, ScreenShareOff, Video, VideoOff } from "lucide-react";
import type { DailyCall, DailyParticipant } from "@daily-co/daily-js";

/**
 * Renders live streams' video with an in-app CSS grid instead of Daily's
 * Prebuilt iframe (see CallFrame, still used for regular calls). Two things
 * Prebuilt does internally turned out to be the root cause of the
 * split-screen bug and the "guest's camera never turns on" bug documented
 * throughout live-stream-room.tsx:
 *  1. activeSpeakerMode only exists in Prebuilt — on a plain call-object
 *     instance (createCallObject(), used here instead of createFrame())
 *     Daily's own docs say it always reports false. There's nothing to
 *     toggle or lose on reconnect because there's no such setting on this
 *     kind of instance at all — every broadcasting participant just gets an
 *     equally-sized tile below, always.
 *  2. Prebuilt's "you're joining as a viewer, camera/mic off" welcome
 *     screen (the whole reason live-stream-room.tsx reconnects with a fresh
 *     is_owner token when a stage request is approved) is Prebuilt UI
 *     chrome too — it doesn't exist here, so an approved guest's tile just
 *     shows their camera the moment Daily actually lets them send.
 * The reconnect-on-approval effect and the "TEMPORARY diagnostic" blocks in
 * live-stream-room.tsx are left in place deliberately — they still work
 * unchanged (dailyCall's event/participant API is identical whether the
 * instance came from createFrame() or createCallObject()) and are the
 * fastest way to confirm live that this fix actually holds, before anyone
 * strips them out.
 */
export function LiveVideoFrame({
  roomUrl,
  token,
  onLeave,
  onCallObject,
  onRecordingChange,
}: {
  roomUrl: string;
  token: string;
  onLeave: () => void;
  onCallObject?: (call: DailyCall | null) => void;
  onRecordingChange?: (recording: boolean) => void;
}) {
  const callRef = useRef<DailyCall | null>(null);
  const [participants, setParticipants] = useState<DailyParticipant[]>([]);

  useEffect(() => {
    let cancelled = false;
    let call: DailyCall | null = null;
    let handleRecordingStarted: (() => void) | null = null;
    let handleRecordingStopped: (() => void) | null = null;

    function refreshParticipants() {
      if (!call) return;
      setParticipants(Object.values(call.participants()));
    }

    // Dynamic import, not a static one — same reasoning as CallFrame: this
    // package touches browser globals at module load, so it must never be
    // evaluated during SSR of this "use client" component's initial
    // server-rendered pass.
    import("@daily-co/daily-js").then(({ default: DailyIframe }) => {
      if (cancelled) return;

      // No container/iframe — createCallObject() (not createFrame()) is
      // Daily's "custom UI" mode: it drives the same underlying call but
      // renders nothing of its own, which is the whole point here.
      call = DailyIframe.createCallObject();
      callRef.current = call;

      call.on("participant-joined", refreshParticipants);
      call.on("participant-updated", refreshParticipants);
      call.on("participant-left", refreshParticipants);
      call.on("left-meeting", onLeave);

      handleRecordingStarted = () => onRecordingChange?.(true);
      handleRecordingStopped = () => onRecordingChange?.(false);
      call.on("recording-started", handleRecordingStarted);
      call.on("recording-stopped", handleRecordingStopped);

      call.join({ url: roomUrl, token }).then(() => {
        if (cancelled) return;
        refreshParticipants();
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
        if (handleRecordingStarted) c.off("recording-started", handleRecordingStarted);
        if (handleRecordingStopped) c.off("recording-stopped", handleRecordingStopped);
        onCallObject?.(null);
        c.destroy();
        callRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomUrl, token]);

  const local = participants.find((p) => p.local);
  // Derived from the actual track state on every participant-updated event,
  // not tracked in separate useState — live-stream-room.tsx's own reconnect
  // effect and its "tap to turn on camera" fallback both call
  // dailyCall.setLocalVideo/setLocalAudio directly (bypassing these toggle
  // handlers entirely), so a separately-tracked boolean here would drift
  // out of sync with reality the moment either of those fired. This can't.
  function trackIsOn(state: DailyParticipant["tracks"]["audio"]["state"]) {
    return state !== "off" && state !== "blocked";
  }
  const localAudioOn = Boolean(local && trackIsOn(local.tracks.audio.state));
  const localVideoOn = Boolean(local && trackIsOn(local.tracks.video.state));
  const localScreenSharing = Boolean(local && trackIsOn(local.tracks.screenVideo.state));

  const toggleAudio = useCallback(() => {
    callRef.current?.setLocalAudio(!localAudioOn);
  }, [localAudioOn]);

  const toggleVideo = useCallback(() => {
    callRef.current?.setLocalVideo(!localVideoOn);
  }, [localVideoOn]);

  const toggleScreenShare = useCallback(() => {
    if (localScreenSharing) {
      callRef.current?.stopScreenShare();
    } else {
      callRef.current?.startScreenShare();
    }
  }, [localScreenSharing]);

  // owner_only_broadcast blocks a plain viewer from sending at all — this
  // is the same "who's actually a broadcaster" test as the room's own
  // permission model (see daily.ts's createLiveStreamRoom), just read back
  // off the participant object instead of inferred from a token. Handles
  // both shapes daily-js's own types allow for canSend (see
  // DailyParticipantPermissions in @daily-co/daily-js) — the existing
  // debugCanSend helper in live-stream-room.tsx exists for the same reason.
  function canBroadcast(p: DailyParticipant) {
    if (p.owner) return true;
    const canSend = p.permissions.canSend;
    return canSend === true || (canSend instanceof Set && canSend.size > 0);
  }
  const broadcasters = participants
    .filter(canBroadcast)
    .sort((a, b) => Number(b.local) - Number(a.local) || Number(b.owner) - Number(a.owner));
  const localCanBroadcast = Boolean(local && canBroadcast(local));

  return (
    <div className="relative flex h-full w-full flex-col bg-black">
      {broadcasters.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-white/60">Connecting…</div>
      ) : (
        <div
          className="grid flex-1 gap-1 p-1"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}
        >
          {broadcasters.map((p) => (
            <ParticipantTile key={p.session_id} participant={p} />
          ))}
        </div>
      )}

      {localCanBroadcast && (
        // Fills the same footprint Daily's own Prebuilt tray used to —
        // live-stream-room.tsx's chat/reaction overlays already reserve
        // this bottom strip (see their "7rem" bottom offset comments) for
        // exactly this reason, so nothing there needs to change.
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
              className={`flex h-10 w-10 items-center justify-center rounded-full text-white ${
                localAudioOn ? "bg-white/20" : "bg-danger"
              }`}
            >
              {localAudioOn ? <Mic size={16} /> : <MicOff size={16} />}
            </button>
            <button
              type="button"
              onClick={toggleVideo}
              title={localVideoOn ? "Turn off camera" : "Turn on camera"}
              aria-label={localVideoOn ? "Turn off camera" : "Turn on camera"}
              className={`flex h-10 w-10 items-center justify-center rounded-full text-white ${
                localVideoOn ? "bg-white/20" : "bg-danger"
              }`}
            >
              {localVideoOn ? <Video size={16} /> : <VideoOff size={16} />}
            </button>
            <button
              type="button"
              onClick={toggleScreenShare}
              title={localScreenSharing ? "Stop sharing" : "Share screen"}
              aria-label={localScreenSharing ? "Stop sharing screen" : "Share screen"}
              className={`flex h-10 w-10 items-center justify-center rounded-full text-white ${
                localScreenSharing ? "bg-accent text-accent-ink" : "bg-white/20"
              }`}
            >
              {localScreenSharing ? <ScreenShareOff size={16} /> : <ScreenShare size={16} />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Attaches one participant's video (and, for everyone but ourselves, audio)
 * track onto real <video>/<audio> elements. createCallObject() mode has no
 * rendering of its own — this is the manual MediaStreamTrack-attachment
 * Daily's own custom-UI guides describe, the same shape as Prebuilt would
 * do internally, just written out by hand.
 */
function ParticipantTile({ participant }: { participant: DailyParticipant }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoTrack = participant.tracks.video;
  const audioTrack = participant.tracks.audio;
  const screenTrack = participant.tracks.screenVideo;
  // Screen share takes over this tile's video element when present —
  // simplification deliberate: live streams currently have no product
  // surface that shows more than one video source per participant at once
  // (unlike calls, which never had a screen-share consumer here either).
  const displayTrack = screenTrack.state === "playable" ? screenTrack : videoTrack;

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject =
      displayTrack.state === "playable" && displayTrack.persistentTrack
        ? new MediaStream([displayTrack.persistentTrack])
        : null;
  }, [displayTrack.state, displayTrack.persistentTrack]);

  useEffect(() => {
    if (participant.local) return; // never play our own mic back to ourselves
    const el = audioRef.current;
    if (!el) return;
    el.srcObject =
      audioTrack.state === "playable" && audioTrack.persistentTrack
        ? new MediaStream([audioTrack.persistentTrack])
        : null;
  }, [participant.local, audioTrack.state, audioTrack.persistentTrack]);

  const hasVideo = displayTrack.state === "playable";
  const name = participant.local ? "You" : participant.user_name || "Guest";

  return (
    <div className="relative flex min-h-[140px] items-center justify-center overflow-hidden rounded-lg bg-white/5">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={participant.local}
        className={`h-full w-full object-cover ${hasVideo ? "" : "hidden"}`}
      />
      {!participant.local && <audio ref={audioRef} autoPlay playsInline />}
      {!hasVideo && <span className="text-xs text-white/50">{name}</span>}
      <span className="absolute bottom-1.5 left-1.5 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white">
        {name}
      </span>
    </div>
  );
}
