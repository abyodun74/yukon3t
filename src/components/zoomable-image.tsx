"use client";

import { usePinchZoom } from "@/lib/use-pinch-zoom";

const MAX_SCALE = 8;
const DOUBLE_TAP_SCALE = 3;

/**
 * Pinch-to-zoom, drag-to-pan-when-zoomed, and double-tap/double-click to
 * toggle zoom, for a single image inside the Lightbox. Gesture math lives in
 * usePinchZoom (shared with the album-carousel's own in-place zoom, see
 * post-card.tsx's ZoomableAlbumPhoto) — this component just supplies the
 * Lightbox-specific bits: full `touch-action: none` (nothing else on this
 * surface needs native touch), and resetting on tap via the backdrop's own
 * onClick being stopped below.
 */
export function ZoomableImage({ src, alt = "" }: { src: string; alt?: string }) {
  const { containerRef, imgRef, scale, translate, isGesturing, resetIfZoomed, movedPastTapThreshold, bind } = usePinchZoom({
    maxScale: MAX_SCALE,
    doubleTapScale: DOUBLE_TAP_SCALE,
  });

  return (
    <div
      ref={containerRef}
      className="flex h-full max-h-[90vh] w-full max-w-full items-center justify-center overflow-hidden"
      style={{ touchAction: "none" }}
      onClick={(e) => {
        e.stopPropagation();
        // A click still fires after a mouse-drag pan — only treat it as a
        // tap-to-reset if the pointer barely moved since mousedown.
        if (!movedPastTapThreshold(e.clientX, e.clientY)) resetIfZoomed();
      }}
      {...bind}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        draggable={false}
        className="max-h-[90vh] max-w-full select-none rounded-lg object-contain"
        style={{
          transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
          transition: isGesturing ? "none" : "transform 150ms ease-out",
          cursor: scale > 1 ? "grab" : "default",
        }}
      />
    </div>
  );
}
