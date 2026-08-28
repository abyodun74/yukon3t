"use client";

import { useEffect, useRef, useState } from "react";
import { Circle, Square, X } from "lucide-react";

/** In-browser camera recording (desktop webcam or mobile camera via getUserMedia) — no native app hand-off required. */
export function VideoRecorderModal({
  onRecorded,
  onClose,
  maxSeconds,
}: {
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

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
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
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

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
    <div className="animate-modal-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="animate-modal-panel-in w-full max-w-md rounded-xl bg-surface p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Record a video</h2>
          <button type="button" onClick={onClose} className="text-foreground-soft hover:text-danger">
            <X size={18} />
          </button>
        </div>

        {error ? (
          <p className="mt-3 text-sm text-danger">{error}</p>
        ) : (
          <>
            <video ref={videoRef} autoPlay muted playsInline className="mt-3 w-full rounded-lg bg-black" />
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
      </div>
    </div>
  );
}
