"use client";

import { useRef, useState, type MouseEvent, type TouchEvent, type Touch, type WheelEvent } from "react";

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const DOUBLE_TAP_MAX_DELAY_MS = 300;
const DOUBLE_TAP_MAX_MOVE_PX = 12;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function touchDistance(a: Touch, b: Touch) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function touchMidpoint(a: Touch, b: Touch) {
  return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
}

/**
 * Pinch-to-zoom, drag-to-pan-when-zoomed, and double-tap/double-click to
 * toggle zoom, for a single image inside the Lightbox. Hand-rolled with
 * touch/mouse events rather than a library — same approach as the
 * single-axis drag gesture in chat-thread.tsx's swipe-to-reply and the
 * touchstart/touchend edge-swipe in nav.tsx, just extended to track two
 * touch points for pinch. `touch-action: none` on the container disables
 * the browser's own native pinch/pan on this element so our own gesture
 * math is the only thing driving it (avoids the well-known React synthetic
 * touchmove + preventDefault interaction, since passive-listener defaults
 * often make that a no-op on mobile).
 */
export function ZoomableImage({ src, alt = "" }: { src: string; alt?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isGesturing, setIsGesturing] = useState(false);

  // Mutable gesture bookkeeping — doesn't need to trigger re-renders, and
  // must stay current mid-gesture without waiting on React's state batching.
  const gesture = useRef({
    mode: "none" as "none" | "pinch" | "pan",
    startDistance: 0,
    startScale: 1,
    startTranslate: { x: 0, y: 0 },
    startPoint: { x: 0, y: 0 },
    lastTapAt: 0,
    lastTapPoint: { x: 0, y: 0 },
  });

  function clampTranslate(nextScale: number, x: number, y: number) {
    const container = containerRef.current;
    const img = imgRef.current;
    if (!container || !img) return { x, y };
    // How far the scaled image can shift before its edge would pull inward
    // past the container's edge — img.clientWidth/Height are the image's
    // unscaled rendered size, so this stays accurate across differently
    // sized/oriented images without any hardcoded assumptions.
    const maxX = Math.max(0, (img.clientWidth * nextScale - container.clientWidth) / 2);
    const maxY = Math.max(0, (img.clientHeight * nextScale - container.clientHeight) / 2);
    return { x: clamp(x, -maxX, maxX), y: clamp(y, -maxY, maxY) };
  }

  function zoomAround(clientX: number, clientY: number, nextScale: number) {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const originX = clientX - rect.left - rect.width / 2;
    const originY = clientY - rect.top - rect.height / 2;
    const ratio = nextScale / scale;
    const next = clampTranslate(nextScale, originX - (originX - translate.x) * ratio, originY - (originY - translate.y) * ratio);
    setScale(nextScale);
    setTranslate(next);
  }

  function toggleZoom(clientX: number, clientY: number) {
    if (scale > MIN_SCALE) {
      setScale(MIN_SCALE);
      setTranslate({ x: 0, y: 0 });
    } else {
      zoomAround(clientX, clientY, DOUBLE_TAP_SCALE);
    }
  }

  function handleTouchStart(e: TouchEvent<HTMLDivElement>) {
    setIsGesturing(true);
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      gesture.current.mode = "pinch";
      gesture.current.startDistance = touchDistance(a, b);
      gesture.current.startScale = scale;
      gesture.current.startTranslate = translate;
      gesture.current.startPoint = touchMidpoint(a, b);
    } else if (e.touches.length === 1) {
      const t = e.touches[0];
      const now = Date.now();
      const sinceLastTap = now - gesture.current.lastTapAt;
      const movedSinceLastTap = Math.hypot(t.clientX - gesture.current.lastTapPoint.x, t.clientY - gesture.current.lastTapPoint.y);
      if (sinceLastTap < DOUBLE_TAP_MAX_DELAY_MS && movedSinceLastTap < DOUBLE_TAP_MAX_MOVE_PX) {
        toggleZoom(t.clientX, t.clientY);
        gesture.current.mode = "none";
        gesture.current.lastTapAt = 0;
        return;
      }
      gesture.current.lastTapAt = now;
      gesture.current.lastTapPoint = { x: t.clientX, y: t.clientY };
      gesture.current.mode = scale > MIN_SCALE ? "pan" : "none";
      gesture.current.startTranslate = translate;
      gesture.current.startPoint = { x: t.clientX, y: t.clientY };
    }
  }

  function handleTouchMove(e: TouchEvent<HTMLDivElement>) {
    if (gesture.current.mode === "pinch" && e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const nextScale = clamp(
        gesture.current.startScale * (touchDistance(a, b) / gesture.current.startDistance),
        MIN_SCALE,
        MAX_SCALE,
      );
      const mid = touchMidpoint(a, b);
      const dx = mid.x - gesture.current.startPoint.x;
      const dy = mid.y - gesture.current.startPoint.y;
      setScale(nextScale);
      setTranslate(clampTranslate(nextScale, gesture.current.startTranslate.x + dx, gesture.current.startTranslate.y + dy));
    } else if (gesture.current.mode === "pan" && e.touches.length === 1) {
      const t = e.touches[0];
      const dx = t.clientX - gesture.current.startPoint.x;
      const dy = t.clientY - gesture.current.startPoint.y;
      setTranslate(clampTranslate(scale, gesture.current.startTranslate.x + dx, gesture.current.startTranslate.y + dy));
    }
  }

  function handleTouchEnd(e: TouchEvent<HTMLDivElement>) {
    if (e.touches.length === 0) {
      gesture.current.mode = "none";
      setIsGesturing(false);
      // A pinch that ends below the minimum should snap back rather than
      // leaving the image stuck at some in-between sub-1 scale.
      if (scale < MIN_SCALE) {
        setScale(MIN_SCALE);
        setTranslate({ x: 0, y: 0 });
      }
    }
  }

  function handleWheel(e: WheelEvent<HTMLDivElement>) {
    // Desktop parity for the same gesture — trackpad pinch and mouse wheel
    // both surface as wheel deltaY.
    e.preventDefault();
    const nextScale = clamp(scale - e.deltaY * 0.01, MIN_SCALE, MAX_SCALE);
    zoomAround(e.clientX, e.clientY, nextScale);
  }

  function handleMouseDown(e: MouseEvent<HTMLDivElement>) {
    if (scale <= MIN_SCALE) return;
    gesture.current.mode = "pan";
    gesture.current.startTranslate = translate;
    gesture.current.startPoint = { x: e.clientX, y: e.clientY };
  }

  function handleMouseMove(e: MouseEvent<HTMLDivElement>) {
    if (gesture.current.mode !== "pan") return;
    const dx = e.clientX - gesture.current.startPoint.x;
    const dy = e.clientY - gesture.current.startPoint.y;
    setTranslate(clampTranslate(scale, gesture.current.startTranslate.x + dx, gesture.current.startTranslate.y + dy));
  }

  function handleMouseUp() {
    gesture.current.mode = "none";
  }

  return (
    <div
      ref={containerRef}
      className="flex h-full max-h-[90vh] w-full max-w-full items-center justify-center overflow-hidden"
      style={{ touchAction: "none" }}
      onClick={(e) => e.stopPropagation()}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onWheel={handleWheel}
      onDoubleClick={(e) => toggleZoom(e.clientX, e.clientY)}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
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
          cursor: scale > MIN_SCALE ? "grab" : "default",
        }}
      />
    </div>
  );
}
