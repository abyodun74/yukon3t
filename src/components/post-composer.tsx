"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Calendar, Camera, Circle, ImageDown, ImagePlus, Link as LinkIcon, Upload, Video, X } from "lucide-react";
import { createPost } from "@/app/actions/circles";
import { addImageFromUrl } from "@/app/actions/media";
import { uploadFileDirect, captureVideoFrameFromFile, resizeImageFile } from "@/lib/upload-client";
import { parseVideoEmbedUrl } from "@/lib/video-embed";
import { EmojiPickerButton } from "@/components/emoji-picker-button";
import { VideoRecorderModal } from "@/components/video-recorder-modal";
import { MediaPickerButton } from "@/components/media-picker-button";
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
    case "invalid":
      return "That video link isn't a YouTube or Vimeo link we recognize.";
    case "network":
      return "Couldn't reach the server — check your connection and try again.";
    default:
      return "Couldn't post — try again.";
  }
}

function imageUrlErrorMessage(code: string) {
  switch (code) {
    case "blocked_host":
      return "That URL isn't allowed — link directly to a public image.";
    case "invalid_content_type":
      return "That link isn't a JPEG, PNG, or WebP image.";
    case "too_large":
      return "That image is too large (max 8MB).";
    case "fetch_failed":
      return "Couldn't fetch that image — check the link and try again.";
    case "not_configured":
      return "Media uploads aren't set up yet.";
    case "rate_limited":
      return "You're adding images too fast — slow down a little.";
    default:
      return "Couldn't add that image — check the link and try again.";
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
  const [urlImages, setUrlImages] = useState<string[]>([]);
  const [video, setVideo] = useState<File | null>(null);
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "error" | "uploading">("idle");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [showRecorder, setShowRecorder] = useState(false);
  const [isEvent, setIsEvent] = useState(false);
  const [eventAt, setEventAt] = useState("");
  const [eventLocation, setEventLocation] = useState("");
  const [showImageUrlInput, setShowImageUrlInput] = useState(false);
  const [imageUrlValue, setImageUrlValue] = useState("");
  const [imageUrlPending, setImageUrlPending] = useState(false);
  const [imageUrlError, setImageUrlError] = useState<string | null>(null);
  const [showEmbedInput, setShowEmbedInput] = useState(false);
  const [embedUrlValue, setEmbedUrlValue] = useState("");
  const [embedError, setEmbedError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const imageCount = images.length + urlImages.length;
  const hasOtherMedia = Boolean(video) || Boolean(embedUrl);
  const parsedEmbed = useMemo(() => (embedUrl ? parseVideoEmbedUrl(embedUrl) : null), [embedUrl]);

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

  async function pickImages(files: FileList | null) {
    if (!files) return;
    const picked = Array.from(files).filter((f) => IMAGE_TYPES.includes(f.type));
    // Resize before the size check — a raw phone photo routinely exceeds
    // 8MB, but the resized version essentially never does, so this check
    // is really just a backstop against a resize failure (rare, fails
    // open to the original file) rather than the normal path.
    const next = await Promise.all(picked.map(resizeImageFile));
    const tooBig = next.find((f) => f.size > MAX_IMAGE_BYTES);
    if (tooBig) {
      setStatus("error");
      setErrorText("Images must be 8MB or smaller each.");
      return;
    }
    setVideo(null);
    setEmbedUrl(null);
    const remaining = Math.max(0, MAX_IMAGES - urlImages.length);
    setImages((prev) => [...prev, ...next].slice(0, remaining));
  }

  async function addImageUrl() {
    const url = imageUrlValue.trim();
    if (!url || imageCount >= MAX_IMAGES) return;
    setImageUrlPending(true);
    setImageUrlError(null);
    const fd = new FormData();
    fd.set("url", url);
    const result = await addImageFromUrl(fd);
    setImageUrlPending(false);
    if (result.error || !result.publicUrl) {
      setImageUrlError(imageUrlErrorMessage(result.error ?? "invalid"));
      return;
    }
    setVideo(null);
    setEmbedUrl(null);
    setUrlImages((prev) => [...prev, result.publicUrl].slice(0, MAX_IMAGES));
    setImageUrlValue("");
    setShowImageUrlInput(false);
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
      setUrlImages([]);
      setEmbedUrl(null);
      setVideo(file);
      setStatus("idle");
      setErrorText(null);
    };
  }

  function addEmbed() {
    const url = embedUrlValue.trim();
    if (!parseVideoEmbedUrl(url)) {
      setEmbedError("That doesn't look like a YouTube or Vimeo video link.");
      return;
    }
    setImages([]);
    setUrlImages([]);
    setVideo(null);
    setEmbedUrl(url);
    setEmbedError(null);
    setEmbedUrlValue("");
    setShowEmbedInput(false);
  }

  async function uploadAll(): Promise<
    | { error: string }
    | {
        mediaType: "NONE" | "IMAGE" | "VIDEO" | "EMBED";
        mediaUrls: string[];
        videoUrl?: string;
        videoThumbnailUrl?: string;
        embedUrl?: string;
      }
  > {
    if (imageCount > 0) {
      // Each local image is an independent presigned-URL request + direct
      // PUT to R2 — uploading them one at a time in sequence was the main
      // cause of multi-image posts feeling slow. URL-sourced images are
      // already uploaded (that happened when they were added), so they just
      // pass straight through.
      const results = images.length > 0
        ? await Promise.all(images.map((file) => uploadFileDirect(file, "post-image")))
        : [];
      const failed = results.find((r) => !r.ok);
      if (failed && !failed.ok) return { error: failed.error };
      return {
        mediaType: "IMAGE",
        mediaUrls: [...results.map((r) => (r.ok ? r.publicUrl : "")), ...urlImages],
      };
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

    if (embedUrl) {
      // Nothing to upload — createPost re-parses and validates this link
      // itself; the client-side parse above is only for instant feedback.
      return { mediaType: "EMBED", mediaUrls: [], embedUrl };
    }

    return { mediaType: "NONE", mediaUrls: [] };
  }

  return (
    <form
      ref={formRef}
      className="rounded-xl border border-line p-4"
      action={(fd) => {
        const content = String(fd.get("content") ?? "").trim();
        if (!content && imageCount === 0 && !video && !embedUrl && !isEvent) {
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
          if (media.embedUrl) fd.set("embedUrl", media.embedUrl);

          let result;
          try {
            result = await createPost(fd);
          } catch {
            // A rejected server-action call (e.g. no connectivity) would
            // otherwise be an uncaught exception that crashes the whole
            // page instead of showing a normal composer error.
            setStatus("error");
            setErrorText(errorMessage("network"));
            return;
          }
          if (result.error) {
            setStatus("error");
            setErrorText(errorMessage(result.error));
          } else {
            setStatus("idle");
            setImages([]);
            setUrlImages([]);
            setVideo(null);
            setEmbedUrl(null);
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

      {(images.length > 0 || urlImages.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {images.map((file, i) => (
            <div key={`local-${i}`} className="relative h-16 w-16 overflow-hidden rounded-lg border border-line">
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
          {urlImages.map((url, i) => (
            <div key={`url-${url}`} className="relative h-16 w-16 overflow-hidden rounded-lg border border-line">
              {/* Already a public URL of our own bucket (fetched server-side) — no object URL needed. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => setUrlImages((prev) => prev.filter((_, idx) => idx !== i))}
                className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {showImageUrlInput && (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="url"
            value={imageUrlValue}
            onChange={(e) => setImageUrlValue(e.target.value)}
            placeholder="https://example.com/image.jpg"
            className="flex-1 rounded-lg border border-line bg-background px-3 py-1.5 text-sm outline-none focus:border-accent"
          />
          <button
            type="button"
            disabled={imageUrlPending || !imageUrlValue.trim()}
            onClick={addImageUrl}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink disabled:opacity-50"
          >
            {imageUrlPending ? "Adding..." : "Add"}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowImageUrlInput(false);
              setImageUrlError(null);
            }}
            className="text-foreground-soft"
          >
            <X size={16} />
          </button>
        </div>
      )}
      {imageUrlError && <p className="mt-1 text-xs text-danger">{imageUrlError}</p>}

      {video && (
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs">
          <span className="flex-1 truncate">{video.name}</span>
          <button type="button" onClick={() => setVideo(null)} className="text-danger">
            <X size={14} />
          </button>
        </div>
      )}

      {embedUrl && (
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs">
          <span className="flex-1 truncate">
            {parsedEmbed?.provider === "VIMEO" ? "Vimeo video linked" : "YouTube video linked"}
          </span>
          <button type="button" onClick={() => setEmbedUrl(null)} className="text-danger">
            <X size={14} />
          </button>
        </div>
      )}

      {showEmbedInput && (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="url"
            value={embedUrlValue}
            onChange={(e) => setEmbedUrlValue(e.target.value)}
            placeholder="https://youtube.com/watch?v=... or https://vimeo.com/..."
            className="flex-1 rounded-lg border border-line bg-background px-3 py-1.5 text-sm outline-none focus:border-accent"
          />
          <button
            type="button"
            disabled={!embedUrlValue.trim()}
            onClick={addEmbed}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink disabled:opacity-50"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => {
              setShowEmbedInput(false);
              setEmbedError(null);
            }}
            className="text-foreground-soft"
          >
            <X size={16} />
          </button>
        </div>
      )}
      {embedError && <p className="mt-1 text-xs text-danger">{embedError}</p>}

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
          <MediaPickerButton
            icon={<ImagePlus size={16} />}
            title="Add a photo"
            disabled={hasOtherMedia || imageCount >= MAX_IMAGES}
            options={[
              {
                label: "Upload from device",
                icon: <Upload size={14} />,
                onSelect: () => imageInputRef.current?.click(),
              },
              {
                label: "Take a photo",
                icon: <Camera size={14} />,
                onSelect: () => cameraInputRef.current?.click(),
              },
              {
                label: "Add from a URL",
                icon: <ImageDown size={14} />,
                onSelect: () => setShowImageUrlInput(true),
              },
            ]}
          />
          <MediaPickerButton
            icon={<Video size={16} />}
            title="Add a video"
            disabled={imageCount > 0 || Boolean(video) || Boolean(embedUrl)}
            options={[
              {
                label: "Upload from device",
                icon: <Upload size={14} />,
                onSelect: () => videoInputRef.current?.click(),
              },
              {
                label: "Record live",
                icon: <Circle size={14} className="text-danger" fill="currentColor" />,
                onSelect: () => setShowRecorder(true),
              },
            ]}
          />
          <button
            type="button"
            onClick={() => setShowEmbedInput((v) => !v)}
            disabled={imageCount > 0 || Boolean(video)}
            className={cn(
              "rounded-lg p-1.5 hover:bg-line disabled:opacity-40",
              showEmbedInput ? "text-accent" : "text-foreground-soft",
            )}
            title="Link a YouTube or Vimeo video"
          >
            <LinkIcon size={16} />
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
