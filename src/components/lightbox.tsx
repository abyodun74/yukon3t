"use client";

import { useEffect } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

/** Full-screen media viewer for a post's images or video — Escape/click-outside/arrow-key navigable. */
export function Lightbox({
  images,
  index,
  video,
  onIndexChange,
  onClose,
}: {
  images?: string[];
  index?: number;
  video?: string;
  onIndexChange?: (index: number) => void;
  onClose: () => void;
}) {
  const isGallery = Boolean(images && images.length > 0 && index !== undefined && onIndexChange);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (isGallery && images && onIndexChange && index !== undefined) {
        if (e.key === "ArrowLeft") onIndexChange((index - 1 + images.length) % images.length);
        if (e.key === "ArrowRight") onIndexChange((index + 1) % images.length);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isGallery, images, index, onIndexChange, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 z-10 text-white/80 hover:text-white"
      >
        <X size={24} />
      </button>

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
              <ChevronLeft size={28} />
            </button>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={images[index]}
            alt=""
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] max-w-full rounded-lg object-contain"
          />
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
              <ChevronRight size={28} />
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
          className="max-h-[90vh] max-w-full rounded-lg bg-black"
        />
      )}
    </div>
  );
}
