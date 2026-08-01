"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Calendar, Camera, ImagePlus, Video, X } from "lucide-react";
import { createPost } from "@/app/actions/circles";
import { uploadFileDirect, captureVideoFrameFromFile } from "@/lib/upload-client";
import { EmojiPickerButton } from "@/components/emoji-picker-button";
import { VideoRecorderModal } from "@/components/video-recorder-modal";
import { cn } from "@/lib/utils";

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 30 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 60;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const VIDEO_TYPES = ["video/mp4", "video/webm"];

// datetime-local inputs want "YYYY-MM-DDTHH:mm" in the viewer's own local
// time — Date#toISOString() is UTC, so the offset has to be subtracted out
// by hand rather than just slicing the ISO string.
function nowForDateTimeLocal() {
  const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

function errorMessage(code: string) {
  switch (code) {
    case "not_configured":
      return "Media uploads aren't set up yet — you can still post text.";
    case "too_large":
      return "That file is too large.";
    case "moderation":
      return "That media didn't pass our content guidelines and wasn't posted.";
    case "not_a_member":
      return "Join this Circle first.";
    case "rate_limited":
      return "You're posting too fast — slow down a little.";
    default:
      return "Couldn't post — try again.";
  }
}

export function PostComposer({
  circleId,
  placeholder = circleId ? "Share something with this Circle..." : "Share a photo, a short video, or an update...",
}: {
  circleId?: string;
  placeholder?: string;
}) {
  const [images, setImages] = useState<File[]>([]);
  const [video, setVideo] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "error" | "uploading">("idle");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [showRecorder, setShowRecorder] = useState(false);
  const [isEvent, setIsEvent] = useState(false);
  const [eventAt, setEventAt] = useState("");
  const [eventLocation, setEventLocation] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  function insertEmoji(emoji: string) {
    const el = contentRef.current;
    if (!el) return;
    el.setRangeText(emoji, el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length, "end");
    el.focus();
  }

  // Object URLs are created once per image set (memoized on `images`), not
  // on every render — creating one inline in JSX would leak a new blob URL
  // on every re-render. The paired effect only handles revocation.
  const imagePreviewUrls = useMemo(
    () => images.map((file) => URL.createObjectURL(file)),
    [images],
  );
  useEffect(() => {
    return () => {
      imagePreviewUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [imagePreviewUrls]);

  function pickImages(files: FileList | null) {
    if (!files) return;
    const next = Array.from(files).filter((f) => IMAGE_TYPES.includes(f.type));
    const tooBig = next.find((f) => f.size > MAX_IMAGE_BYTES);
    if (tooBig) {
      setStatus("error");
      setErrorText("Images must be 8MB or smaller each.");
      return;
    }
    setVideo(null);
    setImages((prev) => [...prev, ...next].slice(0, MAX_IMAGES));
  }

  function pickVideo(file: File | undefined) {
    if (!file) return;
    if (!VIDEO_TYPES.includes(file.type)) {
      setStatus("error");
      setErrorText("Use an MP4 or WebM video.");
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      setStatus("error");
      setErrorText("Video must be 30MB or smaller.");
      return;
    }

    const url = URL.createObjectURL(file);
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.src = url;
    probe.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      if (probe.duration > MAX_VIDEO_SECONDS) {
        setStatus("error");
        setErrorText(`Videos must be ${MAX_VIDEO_SECONDS} seconds or shorter.`);
        return;
      }
      setImages([]);
      setVideo(file);
      setStatus("idle");
      setErrorText(null);
    };
  }

  async function uploadAll(): Promise<
    | { error: string }
    | {
        mediaType: "NONE" | "IMAGE" | "VIDEO";
        mediaUrls: string[];
        videoUrl?: string;
        videoThumbnailUrl?: string;
      }
  > {
    if (images.length > 0) {
      const uploaded: string[] = [];
      for (const file of images) {
        const result = await uploadFileDirect(file, "post-image");
        if (!result.ok) return { error: result.error };
        uploaded.push(result.publicUrl);
      }
      return { mediaType: "IMAGE", mediaUrls: uploaded };
    }

    if (video) {
      // Frame capture reads the local file directly — it never depended on
      // the video actually being uploaded yet, so run both uploads
      // concurrently instead of the video → capture → thumbnail chain this
      // used to be. That chain was the main cause of "video posting feels
      // slow": two full network round-trips in sequence when neither one
      // needed to wait for the other.
      const [videoResult, thumbnailUrl] = await Promise.all([
        uploadFileDirect(video, "post-video"),
        captureVideoFrameFromFile(video).then((frame) =>
          frame ? uploadFileDirect(frame, "video-thumb") : null,
        ),
      ]);
      if (!videoResult.ok) return { error: videoResult.error };

      return {
        mediaType: "VIDEO",
        mediaUrls: [],
        videoUrl: videoResult.publicUrl,
        videoThumbnailUrl: thumbnailUrl?.ok ? thumbnailUrl.publicUrl : undefined,
      };
    }

    return { mediaType: "NONE", mediaUrls: [] };
  }

  return (
    <form
      ref={formRef}
      className="rounded-xl border border-line p-4"
      action={(fd) => {
        const content = String(fd.get("content") ?? "").trim();
        if (!content && images.length === 0 && !video && !isEvent) {
          setStatus("error");
          setErrorText("Write something, attach a photo/video, or add event details first.");
          return;
        }
        if (isEvent) {
          if (!eventAt || new Date(eventAt) <= new Date()) {
            setStatus("error");
            setErrorText("Pick a future date and time for the event.");
            return;
          }
          if (!eventLocation.trim()) {
            setStatus("error");
            setErrorText("Add a location for the event.");
            return;
          }
        }
        if (circleId) fd.set("circleId", circleId);
        setStatus("uploading");
        setErrorText(null);
        startTransition(async () => {
          const media = await uploadAll();
          if ("error" in media) {
            setStatus("error");
            setErrorText(errorMessage(media.error));
            return;
          }
          fd.set("mediaType", media.mediaType);
          fd.set("mediaUrls", JSON.stringify(media.mediaUrls));
          if (media.videoUrl) fd.set("videoUrl", media.videoUrl);
          if (media.videoThumbnailUrl) fd.set("videoThumbnailUrl", media.videoThumbnailUrl);

          const result = await createPost(fd);
          if (result.error) {
            setStatus("error");
            setErrorText(errorMessage(result.error));
          } else {
            setStatus("idle");
            setImages([]);
            setVideo(null);
            setIsEvent(false);
            setEventAt("");
            setEventLocation("");
            formRef.current?.reset();
            router.refresh();
          }
        });
      }}
    >
      <textarea
        ref={contentRef}
        name="content"
        maxLength={2000}
        rows={3}
        placeholder={placeholder}
        className="w-full rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent"
      />

      {images.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {images.map((file, i) => (
            <div key={i} className="relative h-16 w-16 overflow-hidden rounded-lg border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imagePreviewUrls[i]}
                alt=""
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {video && (
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs">
          <span className="flex-1 truncate">{video.name}</span>
          <button type="button" onClick={() => setVideo(null)} className="text-danger">
            <X size={14} />
          </button>
        </div>
      )}

      {isEvent && (
        <div className="mt-2 space-y-2 rounded-lg border border-line p-3">
          <div>
            <label className="block text-xs font-medium text-foreground-soft">When</label>
            <input
              type="datetime-local"
              name="eventAt"
              value={eventAt}
              onChange={(e) => setEventAt(e.target.value)}
              min={nowForDateTimeLocal()}
              className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-1.5 text-sm outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground-soft">Where</label>
            <input
              type="text"
              name="eventLocation"
              value={eventLocation}
              onChange={(e) => setEventLocation(e.target.value)}
              maxLength={200}
              placeholder="Address, venue, or a video call link"
              className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-1.5 text-sm outline-none focus:border-accent"
            />
          </div>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <input
            ref={imageInputRef}
            type="file"
            accept={IMAGE_TYPES.join(",")}
            multiple
            className="hidden"
            onChange={(e) => pickImages(e.target.files)}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept={IMAGE_TYPES.join(",")}
            capture="environment"
            className="hidden"
            onChange={(e) => pickImages(e.target.files)}
          />
          <input
            ref={videoInputRef}
            type="file"
            accept={VIDEO_TYPES.join(",")}
            className="hidden"
            onChange={(e) => pickVideo(e.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            disabled={Boolean(video) || images.length >= MAX_IMAGES}
            className="rounded-lg p-1.5 text-foreground-soft hover:bg-line disabled:opacity-40"
            title="Add photos"
          >
            <ImagePlus size={16} />
          </button>
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            disabled={Boolean(video) || images.length >= MAX_IMAGES}
            className="rounded-lg p-1.5 text-foreground-soft hover:bg-line disabled:opacity-40"
            title="Take a photo"
          >
            <Camera size={16} />
          </button>
          <button
            type="button"
            onClick={() => videoInputRef.current?.click()}
            disabled={images.length > 0 || Boolean(video)}
            className="rounded-lg p-1.5 text-foreground-soft hover:bg-line disabled:opacity-40"
            title="Upload a video"
          >
            <Video size={16} />
          </button>
          <button
            type="button"
            onClick={() => setShowRecorder(true)}
            disabled={images.length > 0 || Boolean(video)}
            className="rounded-lg p-1.5 text-foreground-soft hover:bg-line disabled:opacity-40"
            title="Record a video"
          >
            <span className="relative inline-flex">
              <Video size={16} />
              <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-danger" />
            </span>
          </button>
          <button
            type="button"
            onClick={() => setIsEvent((v) => !v)}
            className={cn(
              "rounded-lg p-1.5 hover:bg-line",
              isEvent ? "text-accent" : "text-foreground-soft",
            )}
            title={isEvent ? "Remove event details" : "Add event details"}
          >
            <Calendar size={16} />
          </button>
          <EmojiPickerButton onSelect={insertEmoji} />
          <p className="ml-1 hidden text-xs text-foreground-soft sm:inline">
            Posts are prescreened for safety before they appear.
          </p>
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-accent-ink disabled:opacity-50"
        >
          {status === "uploading" && isPending ? "Posting..." : "Post"}
        </button>
      </div>
      {status === "error" && errorText && (
        <p className="mt-1 text-xs text-danger">{errorText}</p>
      )}

      {showRecorder && (
        <VideoRecorderModal
          maxSeconds={MAX_VIDEO_SECONDS}
          onClose={() => setShowRecorder(false)}
          onRecorded={(file) => {
            setShowRecorder(false);
            pickVideo(file);
          }}
        />
      )}
    </form>
  );
}
