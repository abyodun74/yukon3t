"use client";

import { useEffect, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import { ZoomableImage } from "@/components/zoomable-image";
import { saveMediaToGallery } from "@/lib/save-to-gallery";
import { pauseAllPlayingVideos, resumePausedVideos } from "@/lib/video-playback-guard";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { cn } from "@/lib/utils";

function SaveButton({ url, kind }: { url: string; kind: "photo" | "video" }) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function handleSave() {
    if (state === "saving") return;
    setState("saving");
    const ok = await saveMediaToGallery(url, kind);
    setState(ok ? "saved" : "error");
    if (ok) setTimeout(() => setState("idle"), 2000);
  }

  return (
    <>
    {/* The button's own label changing isn't reliably re-announced by a
        screen reader that's already sitting on it — this is. */}
    <span role="status" className="sr-only">
      {state === "saving" && "Saving…"}
      {state === "saved" && "Saved to device"}
      {state === "error" && "Couldn't save"}
    </span>
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        handleSave();
      }}
      disabled={state === "saving"}
      // Only while idle — in every other state the visible text ("Saving…",
      // "Saved", "Couldn't save") is the name, so the label never hides it.
      aria-label={state === "idle" ? "Save to device" : undefined}
      title="Save to device"
      className={cn(
        "absolute left-4 top-4 z-10 flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1.5 text-xs font-medium text-white/80 hover:text-white disabled:opacity-60",
        state === "error" && "text-danger",
      )}
    >
      {state === "saved" ? <Check size={16} aria-hidden /> : <Download size={16} aria-hidden />}
      {state === "saving" && "Saving…"}
      {state === "saved" && "Saved"}
      {state === "error" && "Couldn't save"}
      {state === "idle" && "Save"}
    </button>
    </>
  );
}

/** Full-screen media viewer for a post's images or video — Escape/click-outside/arrow-key navigable. */
export function Lightbox({
  images,
  index,
  video,
  onIndexChange,
  onClose,
  alt,
}: {
  images?: string[];
  index?: number;
  video?: string;
  onIndexChange?: (index: number) => void;
  onClose: () => void;
  alt?: string;
}) {
  const isGallery = Boolean(images && images.length > 0 && index !== undefined && onIndexChange);
  const currentMediaUrl = isGallery && images && index !== undefined ? images[index] : video;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isGallery && images && onIndexChange && index !== undefined) {
        if (e.key === "ArrowLeft") onIndexChange((index - 1 + images.length) % images.length);
        if (e.key === "ArrowRight") onIndexChange((index + 1) % images.length);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isGallery, images, index, onIndexChange, onClose]);

  // Pauses whatever else was playing behind this overlay (a feed video, a
  // story) and resumes it on close — same reference-counted guard the call
  // frames use, so a lightbox opened while something else was mid-call is
  // also handled correctly (activeCount just goes to 2, then back to 1).
  useEffect(() => {
    pauseAllPlayingVideos();
    return () => resumePausedVideos();
  }, []);

  // Escape goes through the hook rather than the arrow-key listener above:
  // the hook only lets the topmost open dialog answer it, so a sheet opened
  // over this lightbox closes alone instead of taking the lightbox with it.
  const dialogRef = useDialogFocus<HTMLDivElement>(true, onClose);

  return (
    <div
      ref={dialogRef}
      className="animate-modal-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 outline-none"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={
        video
          ? "Video viewer"
          : isGallery && images && index !== undefined && images.length > 1
            ? `Photo ${index + 1} of ${images.length}`
            : "Photo viewer"
      }
      tabIndex={-1}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 z-10 text-white/80 hover:text-white"
      >
        <X size={24} aria-hidden />
      </button>

      {/* Keyed on the URL so a stale "Saved"/error state from a previous
          image/video doesn't carry over when navigating to the next one —
          simpler than resetting state in an effect for the same reason
          ZoomableImage below is keyed on index. */}
      {currentMediaUrl && <SaveButton key={currentMediaUrl} url={currentMediaUrl} kind={video ? "video" : "photo"} />}

      {isGallery && images && index !== undefined && onIndexChange && (
        <>
          {images.length > 1 && (
            <button
              type="button"
              aria-label="Previous"
              onClick={(e) => {
                e.stopPropagation();
                onIndexChange((index - 1 + images.length) % images.length);
              }}
              className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white/80 hover:text-white sm:left-4"
            >
              <ChevronLeft size={28} aria-hidden />
            </button>
          )}
          {/* Keyed on index so pinch/pan/zoom state resets on every
              prev/next navigation instead of carrying over onto the next
              image. */}
          <ZoomableImage key={index} src={images[index]} alt={alt} />

          {images.length > 1 && (
            <button
              type="button"
              aria-label="Next"
              onClick={(e) => {
                e.stopPropagation();
                onIndexChange((index + 1) % images.length);
              }}
              className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white/80 hover:text-white sm:right-4"
            >
              <ChevronRight size={28} aria-hidden />
            </button>
          )}
        </>
      )}

      {video && (
        <video
          src={video}
          controls
          autoPlay
          onClick={(e) => e.stopPropagation()}
          aria-label={alt || "Video"}
          className="max-h-[90vh] max-w-full rounded-lg bg-black"
        />
      )}
    </div>
  );
}
