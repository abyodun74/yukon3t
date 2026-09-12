"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mic, X } from "lucide-react";
import { createComment } from "@/app/actions/comments";
import { GifPickerButton } from "@/components/gif-picker-button";
import { AudioRecorderModal } from "@/components/audio-recorder-modal";
import { DictationRecorder } from "@/components/dictation-recorder";
import { uploadFileDirect } from "@/lib/upload-client";

// Kept in sync with storage.ts's MAX_AUDIO_NOTE_SECONDS — duplicated locally
// since storage.ts pulls in the server-only @aws-sdk/client-s3 SDK and can't
// be bundled into a "use client" component (same pattern chat-thread.tsx
// already uses for its own voice-note recorder).
const MAX_VOICE_COMMENT_SECONDS = 60;

function errorMessage(code: string) {
  switch (code) {
    case "rate_limited":
      return "You're commenting too fast — slow down a little.";
    case "too_large":
      return "That voice clip is too large — try recording a shorter one.";
    case "network":
      return "Couldn't reach the server — check your connection and try again.";
    case "upload_failed":
      return "Couldn't upload that voice clip — try again.";
    case "invalid":
      return "Couldn't post that comment — try again.";
    case "unavailable":
      return "Couldn't transcribe that clip — try again.";
    case "not_configured":
      return "Dictation isn't set up yet.";
    default:
      return "Couldn't post — try again.";
  }
}

export function CommentComposer({
  postId,
  parentId,
  onDone,
}: {
  postId: string;
  parentId?: string;
  onDone?: () => void;
}) {
  const [content, setContent] = useState("");
  const [pendingGif, setPendingGif] = useState<string | null>(null);
  const [pendingAudio, setPendingAudio] = useState<File | null>(null);
  const [showRecorder, setShowRecorder] = useState(false);
  const [showDictation, setShowDictation] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function appendDictatedText(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setContent((c) => (c ? `${c} ${trimmed}` : trimmed));
  }

  return (
    <form
      className="mt-2"
      action={() => {
        const trimmed = content.trim();
        if (!trimmed && !pendingGif && !pendingAudio) return;
        const audio = pendingAudio;
        startTransition(async () => {
          let audioUrl: string | undefined;
          // Uploaded at submit time, not the moment recording finishes —
          // same reasoning as chat-thread.tsx's own pending-media slots:
          // no upload happens at all until the user actually posts, so
          // discarding a recorded-but-unsent clip (Cancel, or just typing
          // more first) never wastes an upload.
          if (audio) {
            const uploaded = await uploadFileDirect(audio, "comment-audio");
            if (!uploaded.ok) {
              setErrorText(errorMessage(uploaded.error));
              return;
            }
            audioUrl = uploaded.publicUrl;
          }
          const fd = new FormData();
          fd.set("postId", postId);
          if (parentId) fd.set("parentId", parentId);
          fd.set("content", trimmed);
          if (pendingGif) fd.set("gifUrl", pendingGif);
          if (audioUrl) fd.set("audioUrl", audioUrl);
          const result = await createComment(fd);
          if (result.error) {
            setErrorText(errorMessage(result.error));
            return;
          }
          setContent("");
          setPendingGif(null);
          setPendingAudio(null);
          setErrorText(null);
          router.refresh();
          onDone?.();
        });
      }}
    >
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        maxLength={1000}
        rows={2}
        placeholder={parentId ? "Write a reply..." : "Write a comment..."}
        className="w-full rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent"
      />
      {pendingGif && (
        <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs">
          {/* eslint-disable-next-line @next/next/no-img-element -- Giphy-hosted preview, not a local/optimizable asset */}
          <img src={pendingGif} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
          <span className="flex-1 truncate">GIF attached</span>
          <button type="button" onClick={() => setPendingGif(null)} className="text-danger">
            <X size={14} />
          </button>
        </div>
      )}
      {pendingAudio && (
        <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs">
          <Mic size={14} className="shrink-0 text-foreground-soft" />
          <span className="flex-1 truncate">Voice clip attached</span>
          <button type="button" onClick={() => setPendingAudio(null)} aria-label="Remove voice clip" className="text-danger">
            <X size={14} />
          </button>
        </div>
      )}
      <div className="mt-1.5 flex items-center gap-2">
        <GifPickerButton onSelect={setPendingGif} />
        <button
          type="button"
          onClick={() => setShowDictation(true)}
          disabled={showDictation}
          title="Dictate text"
          aria-label="Dictate text"
          className="rounded-lg p-2.5 -m-1 text-foreground-soft hover:bg-line disabled:opacity-40"
        >
          <Mic size={16} />
        </button>
        <button
          type="button"
          onClick={() => setShowRecorder(true)}
          disabled={Boolean(pendingAudio)}
          title="Record a voice comment"
          aria-label="Record a voice comment"
          className="rounded-lg p-2.5 -m-1 text-foreground-soft hover:bg-line disabled:opacity-40"
        >
          <Mic size={18} />
        </button>
        <button
          type="submit"
          disabled={isPending || (content.trim().length === 0 && !pendingGif && !pendingAudio)}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink disabled:opacity-50"
        >
          {isPending ? "Posting..." : parentId ? "Reply" : "Comment"}
        </button>
        {onDone && (
          <button
            type="button"
            onClick={onDone}
            className="text-xs text-foreground-soft"
          >
            Cancel
          </button>
        )}
      </div>
      {errorText && <p className="mt-1 text-xs text-danger">{errorText}</p>}
      {showDictation && (
        <DictationRecorder
          onTranscribed={appendDictatedText}
          onError={(code) => setErrorText(errorMessage(code))}
          onDone={() => setShowDictation(false)}
        />
      )}
      {showRecorder && (
        <AudioRecorderModal
          maxSeconds={MAX_VOICE_COMMENT_SECONDS}
          onClose={() => setShowRecorder(false)}
          onRecorded={(file) => {
            setPendingAudio(file);
            setShowRecorder(false);
          }}
        />
      )}
    </form>
  );
}
