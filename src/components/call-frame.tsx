"use client";

import { useEffect, useRef } from "react";
import type { DailyCall, DailyEventObjectCustomButtonClick } from "@daily-co/daily-js";

const SCREEN_SHARE_BUTTON_ID = "screenshare";

// Inline data URI, not a hosted asset — daily-js's customTrayButtons API
// wants a real iconPath URL, and this is a static monitor glyph with no
// reason to round-trip through R2/next/image for it. Plain white; Daily
// gives the button its own dark tray background regardless of app theme.
const SCREEN_SHARE_ICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
  );

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

    // Dynamic import, not a static one: this package touches browser globals
    // at module load, so it must never be evaluated during SSR of this
    // "use client" component's initial server-rendered pass.
    import("@daily-co/daily-js").then(({ default: DailyIframe }) => {
      if (cancelled || !containerRef.current) return;

      const call = DailyIframe.createFrame(containerRef.current, {
        showLeaveButton: true,
        showFullscreenButton: true,
        iframeStyle: { width: "100%", height: "100%", border: "0" },
        ...(activeSpeakerMode === undefined ? {} : { activeSpeakerMode }),
        customTrayButtons: {
          [SCREEN_SHARE_BUTTON_ID]: {
            iconPath: SCREEN_SHARE_ICON,
            label: "Share screen",
            tooltip: "Share your screen",
          },
        },
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
        call.updateCustomTrayButtons({
          [SCREEN_SHARE_BUTTON_ID]: {
            iconPath: SCREEN_SHARE_ICON,
            label: sharing ? "Stop sharing" : "Share screen",
            tooltip: sharing ? "Stop sharing your screen" : "Share your screen",
            visualState: sharing ? "active" : "default",
          },
        });
      };
      handleCustomButtonClick = (ev) => {
        if (ev.button_id !== SCREEN_SHARE_BUTTON_ID) return;
        if (call.participants().local?.screen) {
          call.stopScreenShare();
        } else {
          call.startScreenShare();
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
