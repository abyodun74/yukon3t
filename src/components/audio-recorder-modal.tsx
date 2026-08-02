"use client";

import { useEffect, useRef, useState } from "react";
import { Circle, Mic, Square, X } from "lucide-react";

/** In-browser microphone recording for a chat voice note — same lifecycle/shape as VideoRecorderModal, just audio-only (no camera preview). */
export function AudioRecorderModal({
  onRecorded,
  onClose,
  maxSeconds,
}: {
  onRecorded: (file: File) => void;
  onClose: () => void;
  maxSeconds: number;
}) {
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
      .getUserMedia({ audio: true })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
      })
      .catch((err: unknown) => {
        console.error("getUserMedia failed:", err);
        const name = err instanceof DOMException ? err.name : "Unknown";
        const message =
          {
            NotAllowedError: "Microphone access was denied. Check your browser's site permissions (and your OS privacy settings) and try again.",
            NotFoundError: "No microphone was found on this device.",
            NotReadableError: "Your microphone is already in use by another app.",
            SecurityError: "This page isn't running in a secure context (mic access needs HTTPS, or localhost for dev).",
          }[name] ?? `Couldn't access your microphone (${name}).`;
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
    const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      // Force the plain "audio/webm" type (no codecs= parameter) so it
      // matches storage.ts's exact content-type allowlist for message-audio.
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      onRecorded(new File([blob], `voice-note-${Date.now()}.webm`, { type: "audio/webm" }));
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm rounded-xl bg-surface p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Record a voice note</h2>
          <button type="button" onClick={onClose} className="text-foreground-soft hover:text-danger">
            <X size={18} />
          </button>
        </div>

        {error ? (
          <p className="mt-3 text-sm text-danger">{error}</p>
        ) : (
          <>
            <div className="mt-4 flex flex-col items-center justify-center rounded-lg bg-background py-8">
              <Mic size={32} className={recording ? "text-danger" : "text-foreground-soft"} />
              <span className="mt-2 text-xs text-foreground-soft">
                {recording ? `${seconds}s / ${maxSeconds}s` : `Up to ${maxSeconds}s`}
              </span>
            </div>
            <div className="mt-3 flex items-center justify-center">
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
