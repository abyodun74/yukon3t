"use client";

import { Circle, Mic, Send, Square } from "lucide-react";
import { useAudioRecorder, type RecordingInfo } from "@/lib/use-audio-recorder";
import { Sheet } from "@/components/sheet";
import { useUiText } from "@/components/ui-text";
import { format } from "@/lib/i18n/locales";

/**
 * In-browser microphone recording for a chat voice note — same lifecycle/
 * shape as VideoRecorderModal, just audio-only (no camera preview).
 * Migrated onto the shared Sheet component (see that file); `open` is
 * passed straight through as useAudioRecorder's own `active` — see that
 * hook's doc comment for why mount timing alone no longer means "the mic
 * should be on" once this stays mounted across its own close animation.
 *
 * Cancel (shown while recording) and closing the sheet mid-recording both throw the recording away: onRecorded is
 * only ever called for a recording stopped with Stop (or by reaching `maxSeconds`). `sendsOnStop` is for a caller that
 * sends the recording the moment it stops (the chat): the Stop button reads "Send" and a line says so.
 */
export function AudioRecorderModal({
  open,
  onRecorded,
  onClose,
  maxSeconds,
  sendsOnStop = false,
}: {
  open: boolean;
  onRecorded: (file: File, info: RecordingInfo) => void;
  onClose: () => void;
  maxSeconds: number;
  sendsOnStop?: boolean;
}) {
  const { start, stop, cancel, seconds, recording, error } = useAudioRecorder({
    maxSeconds,
    onRecorded,
    fileNamePrefix: "voice-note",
    active: open,
  });
  const { locale, dir, t } = useUiText();

  return (
    <Sheet open={open} onClose={onClose} title={t.recorder.voiceTitle} lang={locale} dir={dir}>
      {error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : (
        <>
          <div className="flex flex-col items-center justify-center rounded-lg bg-background py-8">
            <Mic size={32} className={recording ? "text-danger" : "text-foreground-soft"} />
            <span className="mt-2 text-xs text-foreground-soft">
              {recording
                ? format(t.recorder.progress, { seconds, max: maxSeconds })
                : format(t.recorder.limit, { max: maxSeconds })}
            </span>
            {sendsOnStop && <span className="mt-1 px-4 text-center text-xs text-foreground-soft">{t.recorder.sendsOnStop}</span>}
          </div>
          <div className="mt-3 flex items-center justify-center gap-2">
            {!recording ? (
              <button
                type="button"
                onClick={start}
                className="flex items-center gap-1.5 rounded-full bg-danger px-4 py-2 text-sm font-medium text-white"
              >
                <Circle size={14} fill="currentColor" /> {t.recorder.record}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={cancel}
                  className="rounded-full border border-line px-4 py-2 text-sm font-medium text-danger"
                >
                  {t.cancel}
                </button>
                <button
                  type="button"
                  onClick={stop}
                  className={
                    sendsOnStop
                      ? "flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-ink"
                      : "flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-sm font-medium"
                  }
                >
                  {sendsOnStop ? (
                    <>
                      <Send size={14} className="rtl:-scale-x-100" /> {t.recorder.stopAndSend}
                    </>
                  ) : (
                    <>
                      <Square size={14} fill="currentColor" /> {t.recorder.stop}
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </Sheet>
  );
}
