"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Camera, Upload, Video, X } from "lucide-react";
import { createAnnouncement } from "@/app/actions/announcements";
import { uploadFileDirect, captureVideoFrameFromFile, resizeImageFile, withRetry } from "@/lib/upload-client";
import { MediaPickerButton } from "@/components/media-picker-button";
import { markNativePickerActive, markNativePickerInactive, isNativePickerActive } from "@/lib/native-picker-activity";

// Not imported from storage.ts — that module pulls in node:crypto/the AWS
// SDK (server-only), which a "use client" component importing it drags into
// the browser bundle outright (confirmed live: Netlify's webpack build fails
// with "node:crypto ... Unhandled scheme" the moment a client file imports
// any value, even just a constant, from storage.ts). Duplicated locally
// instead, same reasoning/pattern as ad-booking-form.tsx's own
// MAX_IMAGE_BYTES/MAX_VIDEO_BYTES — kept in sync with storage.ts's
// MEDIA_LIMITS["announcement-image"/"announcement-video"] and
// MAX_ANNOUNCEMENT_VIDEO_SECONDS.
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_BYTES = 2048 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 120;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
const VIDEO_EXTENSION_TYPES: Record<string, string> = { mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" };

// Same content:// URI MIME-type gap as ad-booking-form.tsx's own
// normalizeVideoFile — a mobile document picker often hands back an empty/
// wrong File.type even for a normal .mp4.
function normalizeVideoFile(f: File): File | null {
  if (VIDEO_TYPES.includes(f.type)) return f;
  const ext = f.name.split(".").pop()?.toLowerCase();
  const detectedType = ext ? VIDEO_EXTENSION_TYPES[ext] : undefined;
  if (!detectedType) return null;
  return new File([f], f.name, { type: detectedType });
}

function errorMessage(code: string) {
  switch (code) {
    case "too_large":
      return "That file is too large.";
    case "invalid":
      return "Please fill in a title (3+ chars) and body (10+ chars).";
    default:
      return "Couldn't post that — try again.";
  }
}

export function CreateAnnouncementForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mediaType, setMediaType] = useState<"IMAGE" | "VIDEO" | null>(null);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  function clearMedia() {
    setFile(null);
    setMediaType(null);
  }

  async function pickImage(f: File | undefined) {
    if (!f) return;
    if (!IMAGE_TYPES.includes(f.type)) {
      setError("Use a JPEG, PNG, or WebP image.");
      return;
    }
    const resized = await resizeImageFile(f);
    if (resized.size > MAX_IMAGE_BYTES) {
      setError("Images must be 25MB or smaller.");
      return;
    }
    setError(null);
    setMediaType("IMAGE");
    setFile(resized);
  }

  function pickVideo(rawFile: File | undefined) {
    if (!rawFile) return;
    const f = normalizeVideoFile(rawFile);
    if (!f) {
      setError("Use an MP4, MOV or WebM video.");
      return;
    }
    if (f.size > MAX_VIDEO_BYTES) {
      setError("Video must be 2GB or smaller.");
      return;
    }

    const url = URL.createObjectURL(f);
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.src = url;

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      URL.revokeObjectURL(url);
    };
    const timeout = setTimeout(() => {
      if (settled) return;
      finish();
      setError(null);
      setMediaType("VIDEO");
      setFile(f);
    }, 4000);

    probe.onloadedmetadata = () => {
      if (settled) return;
      finish();
      if (Number.isFinite(probe.duration) && probe.duration > MAX_VIDEO_SECONDS) {
        setError(`Videos must be ${MAX_VIDEO_SECONDS} seconds or shorter.`);
        return;
      }
      setError(null);
      setMediaType("VIDEO");
      setFile(f);
    };
    probe.onerror = () => {
      if (settled) return;
      finish();
      setError(null);
      setMediaType("VIDEO");
      setFile(f);
    };
  }

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      if (file && mediaType) {
        let media: { mediaUrl: string; mediaThumbnailUrl?: string };
        if (mediaType === "IMAGE") {
          const result = await uploadFileDirect(file, "announcement-image");
          if (!result.ok) {
            setError(errorMessage(result.error));
            return;
          }
          media = { mediaUrl: result.publicUrl };
        } else {
          const [videoResult, thumb] = await Promise.all([
            uploadFileDirect(file, "announcement-video"),
            captureVideoFrameFromFile(file).then((frame) =>
              frame ? withRetry(() => uploadFileDirect(frame, "video-thumb")) : null,
            ),
          ]);
          if (!videoResult.ok) {
            setError(errorMessage(videoResult.error));
            return;
          }
          media = { mediaUrl: videoResult.publicUrl, mediaThumbnailUrl: thumb?.ok ? thumb.publicUrl : undefined };
        }
        formData.set("mediaType", mediaType);
        formData.set("mediaUrl", media.mediaUrl);
        if (media.mediaThumbnailUrl) formData.set("mediaThumbnailUrl", media.mediaThumbnailUrl);
      }

      const result = await createAnnouncement(formData);
      if (result.error) {
        setError(errorMessage(result.error));
        return;
      }
      formRef.current?.reset();
      clearMedia();
    });
  }

  return (
    <form ref={formRef} action={handleSubmit} className="space-y-3 rounded-xl border border-line p-4">
      <div>
        <label htmlFor="title" className="text-xs font-medium text-foreground-soft">
          Title
        </label>
        <input
          id="title"
          name="title"
          type="text"
          maxLength={120}
          required
          className="mt-1 w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>
      <div>
        <label htmlFor="body" className="text-xs font-medium text-foreground-soft">
          What&apos;s new
        </label>
        <textarea
          id="body"
          name="body"
          rows={4}
          maxLength={4000}
          required
          className="mt-1 w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>

      <div>
        <label className="text-xs font-medium text-foreground-soft">Media (optional)</label>
        <input
          ref={imageInputRef}
          type="file"
          accept={IMAGE_TYPES.join(",")}
          className="hidden"
          onChange={(e) => {
            markNativePickerInactive();
            pickImage(e.target.files?.[0]);
          }}
        />
        {/* accept must include the literal "image/*" — Capacitor's own
            WebView file-chooser handler only routes a capture-enabled input
            to the native camera intent when acceptTypes.contains("image/*")
            is true; see avatar-upload.tsx's camera input for the full
            explanation. A screenshot is just another file from "Upload from
            device" below — no separate handling needed for it. */}
        <input
          ref={cameraInputRef}
          type="file"
          accept={`${IMAGE_TYPES.join(",")},image/*`}
          capture="environment"
          className="hidden"
          onChange={(e) => {
            markNativePickerInactive();
            pickImage(e.target.files?.[0]);
          }}
        />
        {/* accept must include the literal "video/*" — see ad-booking-form.tsx's
            equivalent input for the full writeup (confirmed live via adb
            logcat: the WebView's file-chooser otherwise collapses this
            multi-type accept list to a single MIME type). */}
        <input
          ref={videoInputRef}
          type="file"
          accept={`${VIDEO_TYPES.join(",")},video/*`}
          className="hidden"
          onChange={(e) => {
            markNativePickerInactive();
            pickVideo(e.target.files?.[0]);
          }}
        />

        {file && previewUrl ? (
          <div className="relative mt-2 aspect-video w-full max-w-sm overflow-hidden rounded-lg bg-black">
            {mediaType === "IMAGE" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="" className="h-full w-full object-contain" />
            ) : (
              <video src={previewUrl} controls className="h-full w-full object-contain" />
            )}
            <button
              type="button"
              onClick={clearMedia}
              aria-label="Remove media"
              className="absolute right-1 top-1 rounded-full bg-black/60 p-2 text-white"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <div className="mt-2 flex items-center gap-4 rounded-lg border border-dashed border-line py-6 pl-4">
            <MediaPickerButton
              icon={<Upload size={18} />}
              title="Add a photo or screenshot"
              menuPlacement="bottom"
              options={[
                {
                  label: "Upload from device",
                  icon: <Upload size={14} />,
                  onSelect: () => {
                    if (isNativePickerActive()) return;
                    markNativePickerActive();
                    imageInputRef.current?.click();
                  },
                },
                {
                  label: "Take a photo",
                  icon: <Camera size={14} />,
                  onSelect: () => {
                    if (isNativePickerActive()) return;
                    markNativePickerActive();
                    cameraInputRef.current?.click();
                  },
                },
              ]}
            />
            <MediaPickerButton
              icon={<Video size={18} />}
              title="Add a video"
              menuPlacement="bottom"
              options={[
                {
                  label: "Upload from device",
                  icon: <Upload size={14} />,
                  onSelect: () => {
                    if (isNativePickerActive()) return;
                    markNativePickerActive();
                    videoInputRef.current?.click();
                  },
                },
              ]}
            />
          </div>
        )}
      </div>

      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      <button
        type="submit"
        disabled={isPending}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-50"
      >
        {isPending ? "Posting..." : "Post announcement"}
      </button>
    </form>
  );
}
