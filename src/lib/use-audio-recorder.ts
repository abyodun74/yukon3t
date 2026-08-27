"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Shared getUserMedia/MediaRecorder lifecycle — extracted from
 * audio-recorder-modal.tsx so the "record and attach as audio message" flow
 * and the post/message dictation flow (transcription.ts) can both record a
 * short audio/webm clip without duplicating this logic a third time.
 *
 * Requests mic permission as soon as the hook mounts (same timing as the
 * modal previously did in its own effect) — callers should only mount this
 * hook (or the component using it) once the user has actually opened a
 * recording UI, not unconditionally on every render.
 */
export function useAudioRecorder({
  maxSeconds,
  onRecorded,
  fileNamePrefix = "recording",
  // When true, recording starts the instant mic permission is granted
  // instead of waiting for an explicit start() call — used by the
  // dictation UI, which (unlike AudioRecorderModal's separate "Record"
  // button) starts recording as soon as it's opened.
  autoStart = false,
}: {
  maxSeconds: number;
  onRecorded: (file: File) => void;
  fileNamePrefix?: string;
  autoStart?: boolean;
}) {
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onRecordedRef = useRef(onRecorded);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onRecordedRef.current = onRecorded;
  }, [onRecorded]);

  function stop() {
    recorderRef.current?.stop();
    if (tickRef.current) clearInterval(tickRef.current);
    setRecording(false);
  }

  function beginRecording(stream: MediaStream) {
    chunksRef.current = [];
    const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      // Force the plain "audio/webm" type (no codecs= parameter) so it
      // matches storage.ts's exact content-type allowlist.
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      onRecordedRef.current(new File([blob], `${fileNamePrefix}-${Date.now()}.webm`, { type: "audio/webm" }));
    };
    recorder.start();
    recorderRef.current = recorder;
    setSeconds(0);
    setRecording(true);
    tickRef.current = setInterval(() => {
      setSeconds((s) => {
        const next = s + 1;
        if (next >= maxSeconds) stop();
        return next;
      });
    }, 1000);
  }

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
        if (autoStart) beginRecording(stream);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function start() {
    const stream = streamRef.current;
    if (!stream) return;
    beginRecording(stream);
  }

  return { start, stop, seconds, recording, error };
}
