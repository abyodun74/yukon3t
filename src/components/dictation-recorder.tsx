"use client";

import { useState } from "react";
import { Mic, Square, X } from "lucide-react";
import { transcribeAudio } from "@/app/actions/transcription";
import { uploadFileDirect } from "@/lib/upload-client";
import { useAudioRecorder } from "@/lib/use-audio-recorder";
import { useUiText } from "@/components/ui-text";
import type { uiEn } from "@/lib/i18n/en/ui";
import { format } from "@/lib/i18n/locales";

// Kept in sync with storage.ts's MAX_DICTATION_SECONDS — duplicated locally
// since storage.ts pulls in the server-only @aws-sdk/client-s3 SDK and can't
// be bundled into a "use client" component (same pattern post-composer.tsx/
// chat-thread.tsx already use for their own MAX_*_SECONDS constants).
const MAX_DICTATION_SECONDS = 120;

function formatDictationClock(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * What a dictation failure says, in every composer that offers dictation: transcribeAudio's own codes and the ones
 * the upload before it can end with. Always in the reader's language, even where the composer around it is English.
 */
export function dictationErrorMessage(errors: typeof uiEn.dictation.errors, code: string): string {
  switch (code) {
    case "not_configured":
    case "too_large":
    case "rate_limited":
    case "network":
    case "upload_failed":
    case "stale_deployment":
      return errors[code];
    default:
      return errors.unavailable;
  }
}

/**
 * Records a short clip, uploads it as a "voice-dictation" object, sends it to
 * transcribeAudio, then hands the resulting text back up to the caller for
 * the user to review/edit — never auto-submits. Shared by post-composer.tsx
 * and chat-thread.tsx's dictation button (distinct from the separate "record
 * and send as a voice note/message" flows, which use AudioRecorderModal).
 *
 * Mounted only while the caller has this open (mirrors AudioRecorderModal's
 * own mount-triggers-getUserMedia timing), and unlike that modal, starts
 * recording immediately rather than waiting for a separate "Record" tap.
 */
export function DictationRecorder({
  onTranscribed,
  onError,
  onDone,
}: {
  onTranscribed: (text: string) => void;
  onError: (code: string) => void;
  onDone: () => void;
}) {
  const [transcribing, setTranscribing] = useState(false);
  const { locale, dir, t } = useUiText();
  const { stop, seconds, recording, error } = useAudioRecorder({
    maxSeconds: MAX_DICTATION_SECONDS,
    autoStart: true,
    fileNamePrefix: "dictation",
    onRecorded: (file) => {
      setTranscribing(true);
      (async () => {
        const uploadResult = await uploadFileDirect(file, "voice-dictation");
        if (!uploadResult.ok) {
          onError(uploadResult.error);
          onDone();
          return;
        }
        const fd = new FormData();
        fd.set("key", uploadResult.key);
        let result;
        try {
          result = await transcribeAudio(fd);
        } catch {
          onError("network");
          onDone();
          return;
        }
        if (result.error) {
          onError(result.error);
        } else {
          onTranscribed(result.text);
        }
        onDone();
      })();
    },
  });

  if (error) {
    return (
      <div
        lang={locale}
        dir={dir}
        className="mt-2 flex items-center justify-between rounded-lg border border-line px-3 py-2 text-xs"
      >
        <span role="alert" className="text-danger">{error}</span>
        <button type="button" onClick={onDone} aria-label={t.dictation.dismiss} className="text-foreground-soft">
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div
      lang={locale}
      dir={dir}
      className="mt-2 flex items-center justify-between rounded-lg border border-line px-3 py-2 text-xs"
    >
      <span className="flex items-center gap-1.5 text-foreground-soft">
        <Mic size={14} className={recording ? "text-danger" : ""} />
        {transcribing
          ? t.dictation.transcribing
          : recording
            ? format(t.dictation.recording, { clock: formatDictationClock(seconds) })
            : t.dictation.starting}
      </span>
      {recording && !transcribing && (
        <button
          type="button"
          onClick={stop}
          className="flex items-center gap-1 rounded-full border border-line px-2 py-1 font-medium"
        >
          <Square size={12} fill="currentColor" /> {t.recorder.stop}
        </button>
      )}
    </div>
  );
}
