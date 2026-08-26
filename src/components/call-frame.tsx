"use client";

import { useEffect, useRef } from "react";
import type {
  DailyCall,
  DailyCustomTrayButtons,
  DailyEventObjectAvailableDevicesUpdated,
  DailyEventObjectCustomButtonClick,
  DailyMediaDeviceInfo,
} from "@daily-co/daily-js";

const SCREEN_SHARE_BUTTON_ID = "screenshare";
const AUDIO_OUTPUT_BUTTON_ID = "audiooutput";

// Inline data URI, not a hosted asset — daily-js's customTrayButtons API
// wants a real iconPath URL, and this is a static monitor glyph with no
// reason to round-trip through R2/next/image for it. Plain white; Daily
// gives the button its own dark tray background regardless of app theme.
const SCREEN_SHARE_ICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
  );
const SPEAKER_ICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 9 8 9 13 4 13 20 8 15 3 15 3 9"/><path d="M17 7a6 6 0 0 1 0 10"/><path d="M20 4a10 10 0 0 1 0 16"/></svg>',
  );

/** Loud-speaker-ish label — the deviceId "default" is common across
 *  platforms, but the actual output name is the only reliable signal for
 *  which entry is the phone's own loudspeaker (vs. earpiece/Bluetooth/wired
 *  headset), since deviceIds and ordering otherwise vary by browser. */
function isSpeakerDevice(device: MediaDeviceInfo) {
  return /speaker/i.test(device.label);
}

/**
 * Embeds Daily's own prebuilt call UI (mute/camera/hang-up controls already
 * built in) rather than hand-rolling a WebRTC UI — this is the whole reason
 * calling shipped as a Daily.co integration instead of raw WebRTC. Every
 * room this app creates already has enable_screenshare on (see daily.ts),
 * but Daily's prebuilt UI doesn't surface a screen-share control of its own
 * — customTrayButtons adds one to the same tray Daily renders (including
 * folding it into its own "…" More overflow on a narrow/mobile viewport,
 * same as Daily's built-in buttons), rather than building a separate,
 * disconnected control outside the call UI.
 */
export function CallFrame({
  roomUrl,
  token,
  type,
  onLeave,
  onCallObject,
  onRecordingChange,
  activeSpeakerMode,
}: {
  roomUrl: string;
  token: string;
  type: "AUDIO" | "VIDEO";
  onLeave: () => void;
  /** Hands the parent the live DailyCall instance (and null on teardown) so it can drive things daily-js supports but the prebuilt UI doesn't expose a button for, e.g. call.startRecording()/stopRecording(). */
  onCallObject?: (call: DailyCall | null) => void;
  onRecordingChange?: (recording: boolean) => void;
  /** Daily defaults to fullscreening whoever's talking; pass false to default to a tiled grid (split screen) instead — used for Go Live so the host and any co-hosts/guests show side by side. */
  activeSpeakerMode?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const callRef = useRef<DailyCall | null>(null);

  useEffect(() => {
    let cancelled = false;
    let handleRecordingStarted: (() => void) | null = null;
    let handleRecordingStopped: (() => void) | null = null;
    let handleCustomButtonClick: ((ev: DailyEventObjectCustomButtonClick) => void) | null = null;
    let syncScreenShareButton: (() => void) | null = null;
    let handleAvailableDevicesUpdated: ((ev: DailyEventObjectAvailableDevicesUpdated) => void) | null = null;
    let handleJoinedMeeting: (() => void) | null = null;

    // Dynamic import, not a static one: this package touches browser globals
    // at module load, so it must never be evaluated during SSR of this
    // "use client" component's initial server-rendered pass.
    import("@daily-co/daily-js").then(({ default: DailyIframe }) => {
      if (cancelled || !containerRef.current) return;

      // Mutated in place and always pushed as a whole via
      // updateCustomTrayButtons — Daily removes any button whose key is
      // missing from a given update call, so the screen-share and audio
      // -output buttons must always be sent together or one wipes the other.
      const trayButtons: DailyCustomTrayButtons = {
        [SCREEN_SHARE_BUTTON_ID]: {
          iconPath: SCREEN_SHARE_ICON,
          label: "Share screen",
          tooltip: "Share your screen",
        },
      };

      const call = DailyIframe.createFrame(containerRef.current, {
        showLeaveButton: true,
        showFullscreenButton: true,
        iframeStyle: { width: "100%", height: "100%", border: "0" },
        ...(activeSpeakerMode === undefined ? {} : { activeSpeakerMode }),
        customTrayButtons: trayButtons,
      });
      callRef.current = call;

      call.on("left-meeting", onLeave);
      handleRecordingStarted = () => onRecordingChange?.(true);
      handleRecordingStopped = () => onRecordingChange?.(false);
      call.on("recording-started", handleRecordingStarted);
      call.on("recording-stopped", handleRecordingStopped);

      // Reflects whether *this* participant is currently sharing back onto
      // the button itself (active highlight + label), since Daily's own
      // customTrayButtons has no built-in toggle/pressed concept.
      syncScreenShareButton = () => {
        const sharing = Boolean(call.participants().local?.screen);
        trayButtons[SCREEN_SHARE_BUTTON_ID] = {
          iconPath: SCREEN_SHARE_ICON,
          label: sharing ? "Stop sharing" : "Share screen",
          tooltip: sharing ? "Stop sharing your screen" : "Share your screen",
          visualState: sharing ? "active" : "default",
        };
        call.updateCustomTrayButtons({ ...trayButtons });
      };

      // Audio output (speaker) selection. Only added to the tray once more
      // than one output device is known — most desktop browsers report
      // exactly one until a headset is plugged in, and a single-option
      // "switch" button would just be a dead click. Phones typically report
      // at least the earpiece/receiver plus "Speakerphone", so this is where
      // the button actually shows up in practice.
      let outputDevices: DailyMediaDeviceInfo[] = [];
      let outputIndex = 0;
      // updateCustomTrayButtons() throws ("only supported after join") if
      // called before the call has actually joined the meeting — and
      // enumerateDevices()/"available-devices-updated" can both resolve
      // while join() is still in flight, race-losing against it. That throw
      // was surfacing from inside a device-update callback running during
      // the join handshake, aborting the connection outright (rings fine,
      // then silently fails to connect on accept). Deferring the tray
      // update until "joined-meeting" — and re-applying it once devices are
      // already known by the time that fires — fixes this without losing
      // the feature.
      let joined = false;
      const syncOutputButton = () => {
        if (!joined) return;
        if (outputDevices.length > 1) {
          const current = outputDevices[outputIndex];
          const onSpeaker = Boolean(current && isSpeakerDevice(current));
          trayButtons[AUDIO_OUTPUT_BUTTON_ID] = {
            iconPath: SPEAKER_ICON,
            label: onSpeaker ? "Speaker" : (current?.label || "Audio output").slice(0, 24),
            tooltip: "Switch audio output (speaker, earpiece, headset...)",
            visualState: onSpeaker ? "active" : "default",
          };
        } else {
          delete trayButtons[AUDIO_OUTPUT_BUTTON_ID];
        }
        call.updateCustomTrayButtons({ ...trayButtons });
      };
      const applyOutputDevices = (devices: DailyMediaDeviceInfo[]) => {
        outputDevices = devices.filter((d) => d.kind === "audiooutput");
        if (outputIndex >= outputDevices.length) outputIndex = 0;
        syncOutputButton();
      };
      handleAvailableDevicesUpdated = (ev) => applyOutputDevices(ev.availableDevices as DailyMediaDeviceInfo[]);
      call.on("available-devices-updated", handleAvailableDevicesUpdated);
      handleJoinedMeeting = () => {
        joined = true;
        syncOutputButton();
      };
      call.on("joined-meeting", handleJoinedMeeting);
      // The event above only fires on a subsequent change — this covers the
      // devices already available the moment the call starts. Safe to call
      // before join (enumerateDevices() itself has no post-join guard) —
      // only applying its result to the tray does, which syncOutputButton
      // now accounts for.
      call.enumerateDevices().then(({ devices }) => applyOutputDevices(devices));

      handleCustomButtonClick = (ev) => {
        if (ev.button_id === SCREEN_SHARE_BUTTON_ID) {
          if (call.participants().local?.screen) {
            call.stopScreenShare();
          } else {
            call.startScreenShare();
          }
          return;
        }
        if (ev.button_id === AUDIO_OUTPUT_BUTTON_ID) {
          if (outputDevices.length === 0) return;
          outputIndex = (outputIndex + 1) % outputDevices.length;
          call.setOutputDeviceAsync({ outputDeviceId: outputDevices[outputIndex].deviceId }).then(syncOutputButton);
        }
      };
      call.on("custom-button-click", handleCustomButtonClick);
      call.on("local-screen-share-started", syncScreenShareButton);
      call.on("local-screen-share-stopped", syncScreenShareButton);

      call.join({ url: roomUrl, token, startVideoOff: type === "AUDIO" });
      onCallObject?.(call);
    });

    return () => {
      cancelled = true;
      const call = callRef.current;
      if (call) {
        call.off("left-meeting", onLeave);
        if (handleRecordingStarted) call.off("recording-started", handleRecordingStarted);
        if (handleRecordingStopped) call.off("recording-stopped", handleRecordingStopped);
        if (handleCustomButtonClick) call.off("custom-button-click", handleCustomButtonClick);
        if (syncScreenShareButton) {
          call.off("local-screen-share-started", syncScreenShareButton);
          call.off("local-screen-share-stopped", syncScreenShareButton);
        }
        if (handleAvailableDevicesUpdated) call.off("available-devices-updated", handleAvailableDevicesUpdated);
        if (handleJoinedMeeting) call.off("joined-meeting", handleJoinedMeeting);
        onCallObject?.(null);
        call.destroy();
        callRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomUrl, token]);

  // Positioning is the caller's job — src/components/global-call-frame.tsx
  // is the only place this is rendered, and it decides fullscreen vs
  // minimized sizing.
  return <div ref={containerRef} className="h-full w-full" />;
}
