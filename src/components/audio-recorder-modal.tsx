"use client";

import { Circle, Mic, Square, X } from "lucide-react";
import { useAudioRecorder } from "@/lib/use-audio-recorder";

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
  const { start, stop, seconds, recording, error } = useAudioRecorder({
    maxSeconds,
    onRecorded,
    fileNamePrefix: "voice-note",
  });

  return (
    <div className="animate-modal-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="animate-modal-panel-in w-full max-w-sm rounded-xl bg-surface p-4">
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
                  onClick={start}
                  className="flex items-center gap-1.5 rounded-full bg-danger px-4 py-2 text-sm font-medium text-white"
                >
                  <Circle size={14} fill="currentColor" /> Record
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stop}
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
