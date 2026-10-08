"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, ScreenShare, ScreenShareOff, Video, VideoOff } from "lucide-react";
import type { DailyCall, DailyEventObjectRecordingStarted, DailyParticipant } from "@daily-co/daily-js";

// Module scope (not inside LiveVideoFrame) so both it and the separate
// ParticipantTile component below can call it — ParticipantTile needs its
// own read of a tile's current audio state to render the host's mute
// button correctly (on/off icon + aria-label), not just to compute the
// toggle direction (which LiveVideoFrame's own onToggleMute closure does).
function trackIsOn(state: DailyParticipant["tracks"]["audio"]["state"]) {
  return state !== "off" && state !== "blocked";
}

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
  isHost,
  onLeave,
  onCallObject,
  onRecordingChange,
}: {
  roomUrl: string;
  token: string;
  /** Only the actual stream host gets a mute/unmute control over each other broadcaster's tile (see ParticipantTile) — an approved guest/co-host also holds an owner-level Daily token (daily.ts's createMeetingToken) but isn't the host this is scoped to. */
  isHost?: boolean;
  onLeave: () => void;
  onCallObject?: (call: DailyCall | null) => void;
  /** `recordingId` is Daily's own id for the recording that just started (DailyEventObjectRecordingStarted.recordingId) — what the "Record & Post" flow needs to tell the server which recording to auto-post. Undefined on stop: that event carries no such field. */
  onRecordingChange?: (recording: boolean, recordingId?: string) => void;
}) {
  const callRef = useRef<DailyCall | null>(null);
  const [participants, setParticipants] = useState<DailyParticipant[]>([]);
  // join() rejecting (bad token, expired room, network drop) previously had
  // nowhere to go — CallFrame's own join() call has the same gap, but
  // there the Prebuilt iframe at least shows Daily's own error UI; here
  // there's no fallback UI at all, so an uncaught rejection would otherwise
  // leave the "Connecting…" placeholder up forever with no visible cause.
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let call: DailyCall | null = null;
    let handleRecordingStarted: ((ev?: DailyEventObjectRecordingStarted) => void) | null = null;
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
      // avoidEval: true loads the call-machine bundle via a <script> tag
      // from Daily's CDN instead of a Function()-based eval — this app's
      // CSP (src/proxy.ts) never allows 'unsafe-eval' in production, so
      // without this the call object would fail to initialize at all.
      call = DailyIframe.createCallObject({ dailyConfig: { avoidEval: true } });
      callRef.current = call;

      call.on("participant-joined", refreshParticipants);
      call.on("participant-updated", refreshParticipants);
      call.on("participant-left", refreshParticipants);
      call.on("left-meeting", onLeave);

      handleRecordingStarted = (ev) => onRecordingChange?.(true, ev?.recordingId);
      handleRecordingStopped = () => onRecordingChange?.(false);
      call.on("recording-started", handleRecordingStarted);
      call.on("recording-stopped", handleRecordingStopped);

      call
        .join({ url: roomUrl, token })
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

  // is_owner is the ONLY reliable "can this participant actually broadcast"
  // signal in this app's rooms — confirmed live (see the debug pill in
  // live-stream-room.tsx): a plain viewer reports permissions.canSend:true
  // too, since createMeetingToken (daily.ts) never sets permissions.canSend
  // on any token, viewer or approved guest — canSend is just Daily's
  // default value, not something this app's tokens ever restrict per
  // participant. The actual restriction is owner_only_broadcast at the
  // room level, which is only lifted by is_owner:true — the same thing
  // daily.ts's createMeetingToken comment already documents, and which
  // joinLiveStream grants to approved GUEST/COHOST members, not just the
  // host. Trusting canSend here (an earlier version of this file did) drew
  // a video tile for every connected viewer, not just actual broadcasters.
  function canBroadcast(p: DailyParticipant) {
    return p.owner;
  }
  const broadcasters = participants
    .filter(canBroadcast)
    .sort((a, b) => Number(b.local) - Number(a.local) || Number(b.owner) - Number(a.owner));
  const localCanBroadcast = Boolean(local && canBroadcast(local));

  return (
    <div className="relative flex h-full w-full flex-col bg-black">
      {broadcasters.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 px-4 text-center text-sm text-white/60">
          {joinError ? <span className="text-danger">{joinError}</span> : "Connecting…"}
        </div>
      ) : (
        <div
          className="grid flex-1 gap-1 p-1"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}
        >
          {broadcasters.map((p) => (
            <ParticipantTile
              key={p.session_id}
              participant={p}
              // Only this stream's actual host gets the control, and never
              // on your own tile — that's the bottom tray's toggleAudio
              // above, a normal self-mute, not this force-mute-someone-else
              // one. Daily's own updateParticipant is the mechanism (see
              // onToggleMute below) — confirmed against daily-js's own
              // docs before building this: a meeting owner can force-mute
              // (setAudio: false) another participant for everyone, not
              // just hide them locally.
              onToggleMute={isHost && !p.local ? () => callRef.current?.updateParticipant(p.session_id, { setAudio: !trackIsOn(p.tracks.audio.state) }) : undefined}
            />
          ))}
        </div>
      )}

      {localCanBroadcast && (
        // Fills the same footprint Daily's own Prebuilt tray used to —
        // live-stream-room.tsx's chat/reaction overlays already reserve
        // this bottom strip (see their "7rem" bottom offset comments) for
        // exactly this reason, so nothing there needs to change. Falls back
        // to var(--safe-area-inset-bottom) alongside env() — see nav.tsx's
        // comment on why the plain env() alone isn't reliable enough on
        // Android here.
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center pb-3"
          style={{ paddingBottom: "calc(0.75rem + max(env(safe-area-inset-bottom), var(--safe-area-inset-bottom, 0px)))" }}
        >
          {/* chrome-scale: an icon-only row that can't wrap — see globals.css. */}
          <div className="chrome-scale pointer-events-auto flex items-center gap-2 rounded-full hig-material-dark bg-black/60 backdrop-blur-md px-3 py-2">
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
function ParticipantTile({
  participant,
  onToggleMute,
}: {
  participant: DailyParticipant;
  /** Present only for the host, on every tile but their own — see the broadcasters.map call site. */
  onToggleMute?: () => void;
}) {
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
  const audioOn = trackIsOn(audioTrack.state);

  return (
    <div className="relative flex min-h-[140px] items-center justify-center overflow-hidden rounded-lg bg-white/5">
      {/* Mirrored for the local participant only — standard self-view
          convention, same as direct-call-frame.tsx's SelfVideo ("Local
          self-view: camera only, muted..., mirrored like any other
          self-view"). Every other tile (every other broadcaster, from this
          client's point of view) renders unmirrored, true-to-life, exactly
          as before — this is a pure CSS/rendering-only flip with zero effect
          on the actual transmitted video track, so every other viewer (and
          this file's own frame capture in live-stream-room.tsx, which reads
          the raw decoded video/MediaStreamTrack via drawImage, never
          anything CSS-transformed) continues to see the host true-to-life. */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={participant.local}
        className={`h-full w-full object-cover ${participant.local ? "[transform:scaleX(-1)]" : ""} ${hasVideo ? "" : "hidden"}`}
      />
      {!participant.local && <audio ref={audioRef} autoPlay playsInline />}
      {!hasVideo && <span className="text-xs text-white/50">{name}</span>}
      <span className="absolute bottom-1.5 left-1.5 rounded hig-material-dark bg-black/50 backdrop-blur-md px-1.5 py-0.5 text-[0.625rem] text-white">
        {name}
      </span>
      {onToggleMute && (
        // Host-only (see broadcasters.map above) — lets the stream host
        // force-mute/unmute this broadcaster's audio for everyone via
        // Daily's updateParticipant, not just hide it locally.
        <button
          type="button"
          onClick={onToggleMute}
          title={audioOn ? `Mute ${name}` : `Unmute ${name}`}
          aria-label={audioOn ? `Mute ${name}` : `Unmute ${name}`}
          className={`absolute bottom-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full text-white hig-material-dark backdrop-blur-md ${
            audioOn ? "bg-black/50" : "bg-danger"
          }`}
        >
          {audioOn ? <Mic size={12} /> : <MicOff size={12} />}
        </button>
      )}
    </div>
  );
}
