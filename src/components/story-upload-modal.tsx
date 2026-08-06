"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Upload, Video, X } from "lucide-react";
import { createStory } from "@/app/actions/stories";
import { uploadFileDirect, captureVideoFrameFromFile, resizeImageFile } from "@/lib/upload-client";
import { MediaPickerButton } from "@/components/media-picker-button";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
// Kept in sync with storage.ts's MEDIA_LIMITS["story-video"] — duplicated
// locally rather than imported, since storage.ts pulls in the server-only
// @aws-sdk/client-s3 SDK and can't be bundled into a "use client" component
// (same pattern chat-thread.tsx uses for its own MAX_*_BYTES constants).
const MAX_VIDEO_BYTES = 60 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 30;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const VIDEO_TYPES = ["video/mp4", "video/webm"];

function errorMessage(code: string) {
  switch (code) {
    case "too_large":
      return "That file is too large.";
    case "moderation":
      return "That didn't pass our content guidelines.";
    case "rate_limited":
      return "You're posting stories too fast — slow down a little.";
    case "not_configured":
      return "Story uploads aren't set up yet.";
    case "network":
      return "Couldn't reach the server — check your connection and try again.";
    default:
      return "Couldn't post that story — try again.";
  }
}

export function StoryUploadModal({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [mediaType, setMediaType] = useState<"IMAGE" | "VIDEO" | null>(null);
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  async function pickImage(f: File | undefined) {
    if (!f) return;
    if (!IMAGE_TYPES.includes(f.type)) {
      setError("Use a JPEG, PNG, or WebP image.");
      return;
    }
    const resized = await resizeImageFile(f);
    if (resized.size > MAX_IMAGE_BYTES) {
      setError("Images must be 8MB or smaller.");
      return;
    }
    setError(null);
    setMediaType("IMAGE");
    setFile(resized);
  }

  function pickVideo(f: File | undefined) {
    if (!f) return;
    if (!VIDEO_TYPES.includes(f.type)) {
      setError("Use an MP4 or WebM video.");
      return;
    }
    if (f.size > MAX_VIDEO_BYTES) {
      setError("Video must be 60MB or smaller.");
      return;
    }

    const url = URL.createObjectURL(f);
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.src = url;
    probe.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      if (probe.duration > MAX_VIDEO_SECONDS) {
        setError(`Videos must be ${MAX_VIDEO_SECONDS} seconds or shorter.`);
        return;
      }
      setError(null);
      setMediaType("VIDEO");
      setFile(f);
    };
  }

  function submit() {
    if (!file || !mediaType || isPending) return;
    setError(null);
    startTransition(async () => {
      let media: { mediaUrl: string; mediaThumbnailUrl?: string };
      if (mediaType === "IMAGE") {
        const result = await uploadFileDirect(file, "story-image");
        if (!result.ok) {
          setError(errorMessage(result.error));
          return;
        }
        media = { mediaUrl: result.publicUrl };
      } else {
        const [videoResult, thumb] = await Promise.all([
          uploadFileDirect(file, "story-video"),
          captureVideoFrameFromFile(file).then((frame) => (frame ? uploadFileDirect(frame, "video-thumb") : null)),
        ]);
        if (!videoResult.ok) {
          setError(errorMessage(videoResult.error));
          return;
        }
        media = { mediaUrl: videoResult.publicUrl, mediaThumbnailUrl: thumb?.ok ? thumb.publicUrl : undefined };
      }

      const fd = new FormData();
      fd.set("mediaType", mediaType);
      fd.set("mediaUrl", media.mediaUrl);
      if (media.mediaThumbnailUrl) fd.set("mediaThumbnailUrl", media.mediaThumbnailUrl);
      if (caption.trim()) fd.set("caption", caption.trim());

      let result;
      try {
        result = await createStory(fd);
      } catch {
        setError(errorMessage("network"));
        return;
      }
      if (result.error) {
        setError(errorMessage(result.error));
        return;
      }
      router.refresh();
      onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm rounded-xl bg-surface p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Add to your story</h2>
          <button type="button" onClick={onClose} className="text-foreground-soft hover:text-foreground">
            <X size={18} />
          </button>
        </div>

        <input
          ref={imageInputRef}
          type="file"
          accept={IMAGE_TYPES.join(",")}
          className="hidden"
          onChange={(e) => pickImage(e.target.files?.[0])}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept={IMAGE_TYPES.join(",")}
          capture="environment"
          className="hidden"
          onChange={(e) => pickImage(e.target.files?.[0])}
        />
        <input
          ref={videoInputRef}
          type="file"
          accept={VIDEO_TYPES.join(",")}
          className="hidden"
          onChange={(e) => pickVideo(e.target.files?.[0])}
        />

        {file && previewUrl ? (
          <div className="relative mt-3 aspect-[9/16] w-full overflow-hidden rounded-lg bg-black">
            {mediaType === "IMAGE" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="" className="h-full w-full object-contain" />
            ) : (
              <video src={previewUrl} controls className="h-full w-full object-contain" />
            )}
            <button
              type="button"
              onClick={() => {
                setFile(null);
                setMediaType(null);
              }}
              className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-white"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <div className="mt-3 flex items-center justify-center gap-4 rounded-lg border border-dashed border-line py-10">
            <MediaPickerButton
              icon={<Upload size={18} />}
              title="Add a photo"
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
              ]}
            />
            <MediaPickerButton
              icon={<Video size={18} />}
              title="Add a video"
              options={[
                {
                  label: "Upload from device",
                  icon: <Upload size={14} />,
                  onSelect: () => videoInputRef.current?.click(),
                },
              ]}
            />
          </div>
        )}

        {file && (
          <input
            type="text"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            maxLength={200}
            placeholder="Add a caption (optional)"
            className="mt-3 w-full rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent"
          />
        )}

        {error && <p className="mt-2 text-xs text-danger">{error}</p>}

        <button
          type="button"
          disabled={!file || isPending}
          onClick={submit}
          className="mt-3 w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-50"
        >
          {isPending ? "Posting..." : "Share to your story"}
        </button>
        <p className="mt-2 text-center text-[11px] text-foreground-soft">Disappears after 24 hours.</p>
      </div>
    </div>
  );
}
