"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Circle, Mic, Upload, Video, X } from "lucide-react";
import { createComment } from "@/app/actions/comments";
import { GifPickerButton } from "@/components/gif-picker-button";
import { AudioRecorderModal } from "@/components/audio-recorder-modal";
import { VideoRecorderModal } from "@/components/video-recorder-modal";
import { DictationRecorder } from "@/components/dictation-recorder";
import { MediaPickerButton } from "@/components/media-picker-button";
import { uploadFileDirect, captureVideoFrameFromFile } from "@/lib/upload-client";

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
const VIDEO_TYPES = ["video/mp4", "video/webm"];

function formatSecondsLabel(seconds: number) {
  if (seconds % 60 === 0 && seconds >= 60) {
    const minutes = seconds / 60;
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

function errorMessage(code: string) {
  switch (code) {
    case "rate_limited":
      return "You're commenting too fast — slow down a little.";
    case "too_large":
      return "That file is too large.";
    case "moderation":
      return "That video didn't pass our content guidelines and wasn't posted.";
    case "network":
      return "Couldn't reach the server — check your connection and try again.";
    case "upload_failed":
      return "Couldn't upload that file — try again.";
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
  const [pendingVideo, setPendingVideo] = useState<File | null>(null);
  const [videoDurationSeconds, setVideoDurationSeconds] = useState<number | null>(null);
  const [showRecorder, setShowRecorder] = useState(false);
  const [showVideoRecorder, setShowVideoRecorder] = useState(false);
  const [showDictation, setShowDictation] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const videoInputRef = useRef<HTMLInputElement>(null);

  const hasOtherMedia = Boolean(pendingGif) || Boolean(pendingAudio) || Boolean(pendingVideo);

  function appendDictatedText(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setContent((c) => (c ? `${c} ${trimmed}` : trimmed));
  }

  function pickVideo(file: File | undefined) {
    if (!file) return;
    if (!VIDEO_TYPES.includes(file.type)) {
      setErrorText("Use an MP4 or WebM video.");
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      setErrorText("Video must be 2GB or smaller.");
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
        setErrorText(`Videos must be ${formatSecondsLabel(MAX_UPLOAD_VIDEO_SECONDS)} or shorter.`);
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
              setErrorText(errorMessage(uploaded.error));
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
              setErrorText(errorMessage(videoResult.error));
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
            setErrorText(errorMessage(result.error));
            return;
          }
          setContent("");
          setPendingGif(null);
          setPendingAudio(null);
          setPendingVideo(null);
          setVideoDurationSeconds(null);
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
      {pendingVideo && (
        <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs">
          <Video size={14} className="shrink-0 text-foreground-soft" />
          <span className="flex-1 truncate">Video attached</span>
          <button
            type="button"
            onClick={() => {
              setPendingVideo(null);
              setVideoDurationSeconds(null);
            }}
            aria-label="Remove video"
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
          onChange={(e) => pickVideo(e.target.files?.[0])}
        />
        <GifPickerButton onSelect={setPendingGif} disabled={hasOtherMedia} />
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
          disabled={hasOtherMedia}
          title="Record a voice comment"
          aria-label="Record a voice comment"
          className="rounded-lg p-2.5 -m-1 text-foreground-soft hover:bg-line disabled:opacity-40"
        >
          <Mic size={18} />
        </button>
        <MediaPickerButton
          icon={<Video size={16} />}
          title="Add a video"
          disabled={hasOtherMedia}
          options={[
            {
              label: "Upload from device",
              icon: <Upload size={14} />,
              onSelect: () => videoInputRef.current?.click(),
            },
            {
              label: "Record live",
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
      {showVideoRecorder && (
        <VideoRecorderModal
          maxSeconds={MAX_RECORD_VIDEO_SECONDS}
          onClose={() => setShowVideoRecorder(false)}
          onRecorded={(file) => {
            pickVideo(file);
            setShowVideoRecorder(false);
          }}
        />
      )}
    </form>
  );
}
