"use client";

import { useEffect, useRef } from "react";
import type { DailyCall } from "@daily-co/daily-js";

/**
 * Embeds Daily's own prebuilt call UI (mute/camera/hang-up controls already
 * built in) rather than hand-rolling a WebRTC UI — this is the whole reason
 * calling shipped as a Daily.co integration instead of raw WebRTC.
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
      });
      callRef.current = call;

      call.on("left-meeting", onLeave);
      handleRecordingStarted = () => onRecordingChange?.(true);
      handleRecordingStopped = () => onRecordingChange?.(false);
      call.on("recording-started", handleRecordingStarted);
      call.on("recording-stopped", handleRecordingStopped);
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
        onCallObject?.(null);
        call.destroy();
        callRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomUrl, token]);

  return (
    <div className="fixed inset-0 z-[60] bg-black">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
