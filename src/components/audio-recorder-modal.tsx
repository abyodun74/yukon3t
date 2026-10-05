"use client";

import { Circle, Mic, Square } from "lucide-react";
import { useAudioRecorder } from "@/lib/use-audio-recorder";
import { Sheet } from "@/components/sheet";

/**
 * In-browser microphone recording for a chat voice note — same lifecycle/
 * shape as VideoRecorderModal, just audio-only (no camera preview).
 * Migrated onto the shared Sheet component (see that file); `open` is
 * passed straight through as useAudioRecorder's own `active` — see that
 * hook's doc comment for why mount timing alone no longer means "the mic
 * should be on" once this stays mounted across its own close animation.
 */
export function AudioRecorderModal({
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
  const { start, stop, seconds, recording, error } = useAudioRecorder({
    maxSeconds,
    onRecorded,
    fileNamePrefix: "voice-note",
    active: open,
  });

  return (
    <Sheet open={open} onClose={onClose} title="Record a voice note">
      {error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : (
        <>
          <div className="flex flex-col items-center justify-center rounded-lg bg-background py-8">
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
    </Sheet>
  );
}
