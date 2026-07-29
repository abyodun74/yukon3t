"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ImagePlus, Video, X } from "lucide-react";
import { createPost } from "@/app/actions/circles";
import { uploadFileDirect, captureVideoFrame } from "@/lib/upload-client";

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 30 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 60;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const VIDEO_TYPES = ["video/mp4", "video/webm"];

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
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

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
      const videoResult = await uploadFileDirect(video, "post-video");
      if (!videoResult.ok) return { error: videoResult.error };

      let videoThumbnailUrl: string | undefined;
      const probe = document.createElement("video");
      probe.src = URL.createObjectURL(video);
      probe.muted = true;
      await new Promise<void>((resolve) => {
        probe.onloadeddata = () => {
          probe.currentTime = Math.min(1, probe.duration / 2);
        };
        probe.onseeked = () => resolve();
        probe.onerror = () => resolve();
      });
      const frame = await captureVideoFrame(probe);
      URL.revokeObjectURL(probe.src);
      if (frame) {
        const thumbResult = await uploadFileDirect(frame, "video-thumb");
        if (thumbResult.ok) videoThumbnailUrl = thumbResult.publicUrl;
      }

      return { mediaType: "VIDEO", mediaUrls: [], videoUrl: videoResult.publicUrl, videoThumbnailUrl };
    }

    return { mediaType: "NONE", mediaUrls: [] };
  }

  return (
    <form
      ref={formRef}
      className="rounded-xl border border-line p-4"
      action={(fd) => {
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
            formRef.current?.reset();
            location.reload();
          }
        });
      }}
    >
      <textarea
        name="content"
        required
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

      <div className="mt-2 flex items-center justify-between">
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
            onClick={() => videoInputRef.current?.click()}
            disabled={images.length > 0 || Boolean(video)}
            className="rounded-lg p-1.5 text-foreground-soft hover:bg-line disabled:opacity-40"
            title="Add a short video"
          >
            <Video size={16} />
          </button>
          <p className="ml-1 text-xs text-foreground-soft">
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
    </form>
  );
}
