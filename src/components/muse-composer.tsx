"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Video, Music, Upload } from "lucide-react";
import { createMuse } from "@/app/actions/muse";
import { uploadFileDirect, captureVideoFrameFromFile, withRetry } from "@/lib/upload-client";
import { isStaleDeploymentError, STALE_DEPLOYMENT_MESSAGE } from "@/lib/stale-deployment";
import { EmojiPickerButton } from "@/components/emoji-picker-button";
import { EmojiTypeSuggestions } from "@/components/emoji-type-suggestions";
import { cn } from "@/lib/utils";

// Duplicated from storage.ts's MAX_MUSE_VIDEO_DURATION_SECONDS rather than
// imported — that file pulls in @aws-sdk/client-s3, which is server-only and
// isn't safe in a client bundle. Same reasoning/pattern as post-composer.tsx's
// own MAX_UPLOAD_VIDEO_SECONDS duplicate.
const MAX_MUSE_SECONDS = 180;

// Covers both uploadFileDirect's error codes and createMuse's own — same
// "one switch, both sources" shape post-composer.tsx uses for its own
// errorMessage helper.
function errorMessage(code: string) {
  switch (code) {
    case "too_large":
      return "That video is too large.";
    case "moderation":
      return "This couldn't be posted — it may violate our content guidelines.";
    case "rate_limited":
      return "You're posting too fast — try again in a bit.";
    case "invalid":
      return "That couldn't be posted — try picking the file(s) again.";
    case "network":
      return "Couldn't reach the server — check your connection and try again.";
    case "stale_deployment":
      return STALE_DEPLOYMENT_MESSAGE;
    default:
      return "Something went wrong — try again.";
  }
}

// "original" = the video's own sound plays, untouched. "custom" = an
// entirely separate uploaded audio file replaces it (the video always
// plays muted in that case) — never both at once, matching Muse.audioUrl's
// own schema comment. Chosen once here at post time, not per-viewer.
type SoundMode = "original" | "custom";

export function MuseComposer({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [video, setVideo] = useState<File | null>(null);
  const [videoDurationSeconds, setVideoDurationSeconds] = useState<number | null>(null);
  const [soundMode, setSoundMode] = useState<SoundMode>("original");
  const [audio, setAudio] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [status, setStatus] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [errorText, setErrorText] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  function pickVideo(file: File) {
    setVideo(file);
    setVideoDurationSeconds(null);
    setStatus("idle");
    setErrorText(null);

    const url = URL.createObjectURL(file);
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.src = url;
    probe.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      if (!Number.isFinite(probe.duration)) return;
      if (probe.duration > MAX_MUSE_SECONDS) {
        setVideo((current) => (current === file ? null : current));
        setStatus("error");
        setErrorText(`A Muse can be at most ${MAX_MUSE_SECONDS / 60} minutes — pick a shorter clip.`);
        return;
      }
      setVideoDurationSeconds(Math.round(probe.duration));
    };
    probe.onerror = () => {
      // Fails open, same reasoning as post-composer's own probe — the
      // server re-validates duration itself regardless.
      URL.revokeObjectURL(url);
    };
  }

  async function submit() {
    if (!video) return;
    const customAudioFile = soundMode === "custom" ? audio : null;
    setStatus("busy");
    setErrorText(null);

    // All three uploads run concurrently rather than chained — same
    // "don't make the user wait on sequential round-trips" reasoning as
    // post-composer.tsx's own video+thumbnail upload.
    const [videoResult, thumbnailResult, audioResult] = await Promise.all([
      uploadFileDirect(video, "muse-video"),
      captureVideoFrameFromFile(video).then((frame) =>
        frame ? uploadFileDirect(frame, "video-thumb") : null,
      ),
      customAudioFile ? uploadFileDirect(customAudioFile, "muse-audio") : Promise.resolve(null),
    ]);
    if (!videoResult.ok) {
      setStatus("error");
      setErrorText(errorMessage(videoResult.error));
      return;
    }
    if (audioResult && !audioResult.ok) {
      setStatus("error");
      setErrorText(errorMessage(audioResult.error));
      return;
    }

    const fd = new FormData();
    fd.set("videoUrl", videoResult.publicUrl);
    if (thumbnailResult?.ok) fd.set("videoThumbnailUrl", thumbnailResult.publicUrl);
    fd.set("videoDurationSeconds", String(videoDurationSeconds ?? 0));
    if (caption.trim()) fd.set("caption", caption.trim());
    if (audioResult?.ok) fd.set("audioUrl", audioResult.publicUrl);

    let result;
    try {
      result = await withRetry(
        () => createMuse(fd),
        3,
        1000,
        false,
        (err) => !isStaleDeploymentError(err),
      );
    } catch (err) {
      setStatus("error");
      setErrorText(isStaleDeploymentError(err) ? STALE_DEPLOYMENT_MESSAGE : errorMessage("network"));
      return;
    }

    if (result.error) {
      setStatus("error");
      setErrorText(errorMessage(result.error));
      return;
    }

    setStatus("done");
    router.push("/muse");
    router.refresh();
    onClose();
  }

  const busy = status === "busy";

  return (
    <div
      className="animate-modal-backdrop-in fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
      onClick={() => !busy && onClose()}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="animate-modal-panel-in w-full max-w-sm rounded-t-2xl bg-surface p-4 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Post a Muse</h2>
          <button
            type="button"
            onClick={() => !busy && onClose()}
            aria-label="Close"
            disabled={busy}
            className="text-foreground-soft hover:text-foreground disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        <p className="mt-1 text-xs text-foreground-soft">
          Short, funny, creative — up to {MAX_MUSE_SECONDS / 60} minutes. Visible to everyone on YuKon3t.
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept="video/mp4,video/webm"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) pickVideo(file);
            e.target.value = "";
          }}
        />

        {!video ? (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="mt-3 flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-line py-8 text-foreground-soft hover:border-accent hover:text-accent"
          >
            <Video size={28} />
            <span className="text-sm font-medium">Choose a video</span>
          </button>
        ) : (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-line px-3 py-2">
            <Video size={16} className="shrink-0 text-foreground-soft" />
            <span className="min-w-0 flex-1 truncate text-sm">{video.name}</span>
            {videoDurationSeconds !== null && (
              <span className="shrink-0 text-xs text-foreground-soft">{videoDurationSeconds}s</span>
            )}
            <button
              type="button"
              onClick={() => {
                setVideo(null);
                setVideoDurationSeconds(null);
              }}
              disabled={busy}
              aria-label="Remove video"
              className="shrink-0 text-foreground-soft hover:text-danger disabled:opacity-40"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {video && (
          <div className="mt-3">
            <div className="flex gap-1.5 rounded-lg bg-background p-1">
              <button
                type="button"
                onClick={() => setSoundMode("original")}
                disabled={busy}
                className={cn(
                  "flex-1 rounded-md px-2 py-1.5 text-xs font-medium disabled:opacity-60",
                  soundMode === "original" ? "bg-accent text-accent-ink" : "text-foreground-soft hover:text-foreground",
                )}
              >
                Original sound
              </button>
              <button
                type="button"
                onClick={() => setSoundMode("custom")}
                disabled={busy}
                className={cn(
                  "flex-1 rounded-md px-2 py-1.5 text-xs font-medium disabled:opacity-60",
                  soundMode === "custom" ? "bg-accent text-accent-ink" : "text-foreground-soft hover:text-foreground",
                )}
              >
                Custom audio
              </button>
            </div>

            {soundMode === "custom" && (
              <>
                <input
                  ref={audioInputRef}
                  type="file"
                  accept="audio/mpeg,audio/mp4,audio/webm"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) setAudio(file);
                    e.target.value = "";
                  }}
                />
                {!audio ? (
                  <button
                    type="button"
                    onClick={() => audioInputRef.current?.click()}
                    disabled={busy}
                    className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-line py-3 text-foreground-soft hover:border-accent hover:text-accent disabled:opacity-60"
                  >
                    <Music size={16} />
                    <span className="text-sm font-medium">Choose audio to replace the video&apos;s sound</span>
                  </button>
                ) : (
                  <div className="mt-2 flex items-center gap-2 rounded-lg border border-line px-3 py-2">
                    <Music size={16} className="shrink-0 text-foreground-soft" />
                    <span className="min-w-0 flex-1 truncate text-sm">{audio.name}</span>
                    <button
                      type="button"
                      onClick={() => setAudio(null)}
                      disabled={busy}
                      aria-label="Remove audio"
                      className="shrink-0 text-foreground-soft hover:text-danger disabled:opacity-40"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <div className="mt-3">
          <div className="flex items-center gap-1 rounded-lg border border-line px-2">
            <input
              value={caption}
              onChange={(e) => setCaption(e.target.value.slice(0, 200))}
              placeholder="Add a caption (optional)"
              disabled={busy}
              className="w-full bg-transparent py-2 text-sm outline-none disabled:opacity-60"
            />
            <EmojiPickerButton onSelect={(emoji) => setCaption((c) => (c + emoji).slice(0, 200))} />
          </div>
          <EmojiTypeSuggestions text={caption} onSelect={(emoji) => setCaption((c) => (c + emoji).slice(0, 200))} />
        </div>

        {errorText && <p className="mt-2 text-xs text-danger">{errorText}</p>}
        {status === "done" && <p className="mt-2 text-xs text-accent">Posted!</p>}

        <button
          type="button"
          onClick={submit}
          disabled={!video || busy || videoDurationSeconds === null}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink disabled:opacity-50"
        >
          <Upload size={15} />
          {busy ? "Posting…" : "Post Muse"}
        </button>
      </div>
    </div>
  );
}
