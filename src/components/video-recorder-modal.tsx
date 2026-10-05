"use client";

import { useEffect, useRef, useState } from "react";
import { Circle, RefreshCw, Square } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Sheet } from "@/components/sheet";

/**
 * In-browser camera recording (desktop webcam or mobile camera via
 * getUserMedia) — no native app hand-off required. Migrated onto the
 * shared Sheet component (see that file), which needs this mounted
 * continuously rather than torn down on every close — unlike every other
 * migrated modal, that actually matters here: the mount-time effect below
 * acquires a real camera/mic stream, so it's now explicitly keyed on
 * `open` (acquire when it opens, release when it closes) instead of only
 * ever running once on mount/unmount, so a reopen genuinely re-acquires
 * the camera rather than silently reusing a closed stream.
 */
export function VideoRecorderModal({
  open,
  onRecorded,
  onClose,
  maxSeconds,
}: {
  open: boolean;
  onRecorded: (file: File) => void;
  onClose: () => void;
  maxSeconds: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("environment");
  const [switchingCamera, setSwitchingCamera] = useState(false);
  // Best-effort fallback for a plain browser tab, same reasoning as
  // call-frame.tsx's cycleCamera() gating: device-count/facingMode-capability
  // signals are unreliable on Android (some camera HALs collapse front+back
  // into a single videoinput entry), so the button is shown unconditionally
  // inside the Capacitor app, where a front+back pair is a given.
  const [canSwitchCamera, setCanSwitchCamera] = useState(
    () => typeof window !== "undefined" && Capacitor.isNativePlatform(),
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // Matches the initial `facingMode` state's default ("environment") —
    // read as a literal rather than the state variable since this effect
    // only runs again when `open` itself changes; switchCamera() (below)
    // handles every change after that by mutating the stream in place,
    // not by re-running this effect.
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: true })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        navigator.mediaDevices
          .enumerateDevices()
          .then((devices) => {
            if (devices.filter((d) => d.kind === "videoinput").length > 1) setCanSwitchCamera(true);
          })
          .catch(() => {});
      })
      .catch((err: unknown) => {
        // getUserMedia's DOMException name distinguishes "you said no" from
        // "there's no camera" from "something else has it open" — surfacing
        // that instead of one generic message is the difference between a
        // user knowing what to actually do next and just retrying blindly.
        console.error("getUserMedia failed:", err);
        const name = err instanceof DOMException ? err.name : "Unknown";
        const message =
          {
            NotAllowedError: "Camera/microphone access was denied. Check your browser's site permissions (and your OS privacy settings) and try again.",
            NotFoundError: "No camera or microphone was found on this device.",
            NotReadableError: "Your camera or microphone is already in use by another app.",
            SecurityError: "This page isn't running in a secure context (camera access needs HTTPS, or localhost for dev).",
          }[name] ?? `Couldn't access your camera/microphone (${name}).`;
        setError(message);
      });
    // Captured now (not read as videoRef.current inside the cleanup below)
    // since the ref's own target can already be a different/unmounted node
    // by the time cleanup runs (e.g. the error branch below swaps the
    // <video> out of the tree) — the element this effect actually bound
    // srcObject on is the one that needs it cleared, not whatever the ref
    // happens to point at later.
    const videoEl = videoRef.current;
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (videoEl) videoEl.srcObject = null;
      if (tickRef.current) clearInterval(tickRef.current);
      // Reset for the next open — a fresh acquisition shouldn't inherit a
      // stale error/recording/facing-mode state from the previous session.
      setError(null);
      setRecording(false);
      setSeconds(0);
      setFacingMode("environment");
    };
  }, [open]);

  async function switchCamera() {
    const stream = streamRef.current;
    if (!stream || switchingCamera) return;
    const previousFacingMode = facingMode;
    const nextFacingMode = previousFacingMode === "environment" ? "user" : "environment";
    setSwitchingCamera(true);
    // Stop and remove the current camera track BEFORE requesting the other
    // one, rather than acquire-then-release — confirmed on a real Samsung
    // device that opening a second camera stream while the first is still
    // active silently fails outright (most Android Camera2 HALs only allow
    // one open camera session per app at a time), which is why the
    // acquire-then-release ordering never actually switched anything.
    const oldTrack = stream.getVideoTracks()[0];
    if (oldTrack) {
      stream.removeTrack(oldTrack);
      oldTrack.stop();
    }
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: nextFacingMode },
        audio: false,
      });
      const newTrack = newStream.getVideoTracks()[0];
      if (!newTrack) throw new Error("No video track returned");
      // Add the new track to the SAME MediaStream object (rather than
      // replacing streamRef/srcObject wholesale) instead of tearing down
      // and recreating everything — that's what lets an in-progress
      // MediaRecorder keep recording straight through the switch. Chromium
      // (both the Android WebView this app actually ships in, and desktop
      // Chrome — see call-frame.tsx's own note on this app's real mobile
      // audience) observes addTrack on a live stream and picks up the
      // addition without a restart; calling MediaRecorder.start() a second
      // time instead would produce two separately-headered webm blobs that
      // can't just be concatenated into one playable file.
      stream.addTrack(newTrack);
      setFacingMode(nextFacingMode);
    } catch (err) {
      console.error("Camera switch failed:", err);
      // Best-effort recovery — try to get the original camera back rather
      // than leaving the recording with no video track at all.
      try {
        const restored = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: previousFacingMode },
          audio: false,
        });
        const restoredTrack = restored.getVideoTracks()[0];
        if (restoredTrack) stream.addTrack(restoredTrack);
      } catch {
        // Nothing more to do here — closing and reopening the recorder is
        // the only way back if even the original camera won't reacquire.
      }
    } finally {
      // Some WebView/Chromium builds don't repaint a <video> already bound
      // to a live MediaStream after its tracks change in place —
      // reassigning the same stream object (not a copy) forces a refresh.
      if (videoRef.current) {
        videoRef.current.srcObject = null;
        videoRef.current.srcObject = stream;
      }
      setSwitchingCamera(false);
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    if (tickRef.current) clearInterval(tickRef.current);
    setRecording(false);
  }

  function startRecording() {
    const stream = streamRef.current;
    if (!stream) return;
    chunksRef.current = [];
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      // Force the plain "video/webm" type (no codecs= parameter) so it
      // matches storage.ts's exact content-type allowlist for post-video.
      const blob = new Blob(chunksRef.current, { type: "video/webm" });
      onRecorded(new File([blob], `recording-${Date.now()}.webm`, { type: "video/webm" }));
    };
    recorder.start();
    recorderRef.current = recorder;
    setSeconds(0);
    setRecording(true);
    tickRef.current = setInterval(() => {
      setSeconds((s) => {
        const next = s + 1;
        if (next >= maxSeconds) stopRecording();
        return next;
      });
    }, 1000);
  }

  return (
    <Sheet open={open} onClose={onClose} title="Record a video" panelClassName="max-w-md">
        {error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : (
          <>
            <div className="relative">
              <video ref={videoRef} autoPlay muted playsInline className="w-full rounded-lg bg-black" />
              {canSwitchCamera && (
                <button
                  type="button"
                  onClick={switchCamera}
                  disabled={switchingCamera}
                  title="Switch camera"
                  aria-label="Switch camera"
                  className="absolute right-2 top-2 rounded-full bg-black/50 p-1.5 text-white/90 hover:text-white disabled:opacity-50"
                >
                  <RefreshCw size={16} className={switchingCamera ? "animate-spin" : undefined} />
                </button>
              )}
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-foreground-soft">
                {recording ? `${seconds}s / ${maxSeconds}s` : `Up to ${maxSeconds}s`}
              </span>
              {!recording ? (
                <button
                  type="button"
                  onClick={startRecording}
                  className="flex items-center gap-1.5 rounded-full bg-danger px-4 py-2 text-sm font-medium text-white"
                >
                  <Circle size={14} fill="currentColor" /> Record
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopRecording}
                  className="flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-sm font-medium"
                >
                  <Square size={14} fill="currentColor" /> Stop
                </button>
              )}
            </div>
          </>
        )}
    </Sheet>
  );
}
