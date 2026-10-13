"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Circle, Mic, Upload, Video, X } from "lucide-react";
import { createComment } from "@/app/actions/comments";
import { GifPickerButton } from "@/components/gif-picker-button";
import { AudioRecorderModal } from "@/components/audio-recorder-modal";
import { VideoRecorderModal } from "@/components/video-recorder-modal";
import { DictationRecorder, dictationErrorMessage } from "@/components/dictation-recorder";
import { MediaPickerButton } from "@/components/media-picker-button";
import { EmojiPickerButton } from "@/components/emoji-picker-button";
import { EmojiTypeSuggestions } from "@/components/emoji-type-suggestions";
import { uploadFileDirect, captureVideoFrameFromFile } from "@/lib/upload-client";
import { markNativePickerActive, markNativePickerInactive, isNativePickerActive } from "@/lib/native-picker-activity";
import { announce } from "@/lib/announce";
import { useUiText } from "@/components/ui-text";
import type { uiEn } from "@/lib/i18n/en/ui";
import { plural } from "@/lib/i18n/locales";

// Kept in sync with storage.ts's MAX_AUDIO_NOTE_SECONDS — duplicated locally
// since storage.ts pulls in the server-only @aws-sdk/client-s3 SDK and can't
// be bundled into a "use client" component (same pattern chat-thread.tsx
// already uses for its own voice-note recorder).
const MAX_VOICE_COMMENT_SECONDS = 60;
// Full parity with post-composer.tsx's own video limits — a video comment
// is held to the same bar as a video post, not a lighter-weight variant
// (see storage.ts's "comment-video" upload kind).
const MAX_RECORD_VIDEO_SECONDS = 60;
const MAX_UPLOAD_VIDEO_SECONDS = 3600;
const MAX_VIDEO_BYTES = 2048 * 1024 * 1024;
const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];

function errorMessage(errors: typeof uiEn.comments.composer.errors, code: string) {
  switch (code) {
    case "rate_limited":
    case "too_large":
    case "moderation":
    case "network":
    case "upload_failed":
    case "invalid":
      return errors[code];
    default:
      return errors.other;
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
  const [pendingVideo, setPendingVideo] = useState<File | null>(null);
  const [videoDurationSeconds, setVideoDurationSeconds] = useState<number | null>(null);
  const [showRecorder, setShowRecorder] = useState(false);
  const [showVideoRecorder, setShowVideoRecorder] = useState(false);
  const [showDictation, setShowDictation] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const videoInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { locale, dir, t: ui } = useUiText();
  const t = ui.comments.composer;

  const hasOtherMedia = Boolean(pendingGif) || Boolean(pendingAudio) || Boolean(pendingVideo);

  function appendDictatedText(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setContent((c) => (c ? `${c} ${trimmed}` : trimmed));
  }

  function insertEmoji(emoji: string) {
    setContent((c) => c + emoji);
    textareaRef.current?.focus();
  }

  function pickVideo(file: File | undefined) {
    if (!file) return;
    if (!VIDEO_TYPES.includes(file.type)) {
      setErrorText(ui.media.videoType);
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      setErrorText(ui.media.videoTooLarge);
      return;
    }

    // Attach synchronously rather than waiting on <video>'s loadedmetadata
    // event — same reasoning as post-composer.tsx's own pickVideo (that
    // event can be slow or never fire at all on some Android devices).
    // Duration is only used server-side to route long videos to manual
    // review, so a submit before it resolves just publishes immediately
    // like a short video would.
    setPendingVideo(file);
    setVideoDurationSeconds(null);
    setErrorText(null);

    const url = URL.createObjectURL(file);
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.src = url;
    probe.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      if (!Number.isFinite(probe.duration)) return;
      if (probe.duration > MAX_UPLOAD_VIDEO_SECONDS) {
        setPendingVideo((current) => (current === file ? null : current));
        setErrorText(plural(locale, t.videoTooLong, MAX_UPLOAD_VIDEO_SECONDS / 60));
        return;
      }
      setVideoDurationSeconds(Math.round(probe.duration));
    };
    probe.onerror = () => {
      URL.revokeObjectURL(url);
    };
  }

  return (
    <form
      lang={locale}
      dir={dir}
      className="mt-2"
      action={() => {
        const trimmed = content.trim();
        if (!trimmed && !pendingGif && !pendingAudio && !pendingVideo) return;
        const audio = pendingAudio;
        const video = pendingVideo;
        startTransition(async () => {
          let audioUrl: string | undefined;
          let videoUrl: string | undefined;
          let videoThumbnailUrl: string | undefined;
          // Uploaded at submit time, not the moment recording/picking
          // finishes — same reasoning as chat-thread.tsx's own
          // pending-media slots: no upload happens at all until the user
          // actually posts, so discarding a recorded-but-unsent clip
          // (Cancel, or just typing more first) never wastes an upload.
          if (audio) {
            const uploaded = await uploadFileDirect(audio, "comment-audio");
            if (!uploaded.ok) {
              setErrorText(errorMessage(t.errors, uploaded.error));
              return;
            }
            audioUrl = uploaded.publicUrl;
          }
          if (video) {
            // Frame capture reads the local file directly — runs
            // concurrently with the upload rather than waiting on it, same
            // as post-composer.tsx's own uploadAll.
            const [videoResult, thumbnailResult] = await Promise.all([
              uploadFileDirect(video, "comment-video"),
              captureVideoFrameFromFile(video).then((frame) => (frame ? uploadFileDirect(frame, "video-thumb") : null)),
            ]);
            if (!videoResult.ok) {
              setErrorText(errorMessage(t.errors, videoResult.error));
              return;
            }
            videoUrl = videoResult.publicUrl;
            videoThumbnailUrl = thumbnailResult?.ok ? thumbnailResult.publicUrl : undefined;
          }
          const fd = new FormData();
          fd.set("postId", postId);
          if (parentId) fd.set("parentId", parentId);
          fd.set("content", trimmed);
          if (pendingGif) fd.set("gifUrl", pendingGif);
          if (audioUrl) fd.set("audioUrl", audioUrl);
          if (videoUrl) fd.set("videoUrl", videoUrl);
          if (videoThumbnailUrl) fd.set("videoThumbnailUrl", videoThumbnailUrl);
          if (videoDurationSeconds !== null) fd.set("videoDurationSeconds", String(videoDurationSeconds));
          const result = await createComment(fd);
          if (result.error) {
            setErrorText(errorMessage(t.errors, result.error));
            return;
          }
          setContent("");
          setPendingGif(null);
          setPendingAudio(null);
          setPendingVideo(null);
          setVideoDurationSeconds(null);
          setErrorText(null);
          announce(parentId ? t.replyPosted : t.posted);
          router.refresh();
          onDone?.();
        });
      }}
    >
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        maxLength={1000}
        rows={2}
        placeholder={parentId ? t.reply : t.comment}
        aria-label={parentId ? t.replyLabel : t.commentLabel}
        dir="auto"
        className="w-full rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent"
      />
      <EmojiTypeSuggestions text={content} onSelect={insertEmoji} />
      {pendingGif && (
        <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs">
          {/* eslint-disable-next-line @next/next/no-img-element -- Giphy-hosted preview, not a local/optimizable asset */}
          <img src={pendingGif} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
          <span className="flex-1 truncate">{t.gifAttached}</span>
          <button type="button" onClick={() => setPendingGif(null)} aria-label={t.removeGif} className="text-danger">
            <X size={14} />
          </button>
        </div>
      )}
      {pendingAudio && (
        <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs">
          <Mic size={14} className="shrink-0 text-foreground-soft" />
          <span className="flex-1 truncate">{t.voiceAttached}</span>
          <button type="button" onClick={() => setPendingAudio(null)} aria-label={t.removeVoice} className="text-danger">
            <X size={14} />
          </button>
        </div>
      )}
      {pendingVideo && (
        <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs">
          <Video size={14} className="shrink-0 text-foreground-soft" />
          <span className="flex-1 truncate">{t.videoAttached}</span>
          <button
            type="button"
            onClick={() => {
              setPendingVideo(null);
              setVideoDurationSeconds(null);
            }}
            aria-label={t.removeVideo}
            className="text-danger"
          >
            <X size={14} />
          </button>
        </div>
      )}
      <div className="mt-1.5 flex items-center gap-2">
        <input
          ref={videoInputRef}
          type="file"
          accept={VIDEO_TYPES.join(",")}
          className="hidden"
          onChange={(e) => {
            markNativePickerInactive();
            pickVideo(e.target.files?.[0]);
          }}
        />
        <GifPickerButton onSelect={setPendingGif} disabled={hasOtherMedia} />
        <EmojiPickerButton onSelect={insertEmoji} />
        <button
          type="button"
          onClick={() => setShowDictation(true)}
          disabled={showDictation}
          title={ui.dictation.button}
          aria-label={ui.dictation.button}
          className="rounded-lg p-2.5 -m-1 text-foreground-soft hover:bg-line disabled:opacity-40"
        >
          <Mic size={16} />
        </button>
        <button
          type="button"
          onClick={() => setShowRecorder(true)}
          disabled={hasOtherMedia}
          title={t.recordVoice}
          aria-label={t.recordVoice}
          className="rounded-lg p-2.5 -m-1 text-foreground-soft hover:bg-line disabled:opacity-40"
        >
          <Mic size={18} />
        </button>
        <MediaPickerButton
          icon={<Video size={16} />}
          title={ui.media.addVideo}
          disabled={hasOtherMedia}
          options={[
            {
              label: ui.media.uploadFromDevice,
              icon: <Upload size={14} />,
              onSelect: () => {
                if (isNativePickerActive()) return;
                markNativePickerActive();
                videoInputRef.current?.click();
              },
            },
            {
              label: ui.media.recordLive,
              icon: <Circle size={14} className="text-danger" fill="currentColor" />,
              onSelect: () => setShowVideoRecorder(true),
            },
          ]}
        />
        <button
          type="submit"
          disabled={isPending || (content.trim().length === 0 && !pendingGif && !pendingAudio && !pendingVideo)}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink disabled:opacity-50"
        >
          {isPending ? t.posting : parentId ? t.submitReply : t.submit}
        </button>
        {onDone && (
          <button
            type="button"
            onClick={onDone}
            className="text-xs text-foreground-soft"
          >
            {ui.cancel}
          </button>
        )}
      </div>
      {errorText && <p role="alert" className="mt-1 text-xs text-danger">{errorText}</p>}
      {showDictation && (
        <DictationRecorder
          onTranscribed={appendDictatedText}
          onError={(code) => setErrorText(dictationErrorMessage(ui.dictation.errors, code))}
          onDone={() => setShowDictation(false)}
        />
      )}
      <AudioRecorderModal
        open={showRecorder}
        maxSeconds={MAX_VOICE_COMMENT_SECONDS}
        onClose={() => setShowRecorder(false)}
        onRecorded={(file) => {
          setPendingAudio(file);
          setShowRecorder(false);
        }}
      />
      <VideoRecorderModal
        open={showVideoRecorder}
        maxSeconds={MAX_RECORD_VIDEO_SECONDS}
        onClose={() => setShowVideoRecorder(false)}
        onRecorded={(file) => {
          pickVideo(file);
          setShowVideoRecorder(false);
        }}
      />
    </form>
  );
}
