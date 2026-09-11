"use client";

import { useLayoutEffect, useRef, useState } from "react";

// Hand-rolled rather than a library (react-easy-crop, cropperjs, etc.) —
// deliberate: this app avoids pulling in native/JS deps it doesn't need
// (see the @capacitor/camera removal), and drag-to-pan + pinch/slider-zoom
// onto a <canvas> covers everything a fixed-aspect avatar/cover crop needs.
//
// Remount this on a new `file` (e.g. `key={file.name + file.size}` from the
// caller) rather than relying on an internal reset effect — all crop state
// below is derived fresh from a freshly-mounted instance.

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function ImageCropModal({
  file,
  aspect = 1,
  outputSize = 1024,
  title = "Crop photo",
  confirmLabel = "Use photo",
  onCancel,
  onCropped,
}: {
  file: File;
  aspect?: number;
  outputSize?: number;
  title?: string;
  confirmLabel?: string;
  onCancel: () => void;
  onCropped: (file: File) => void;
}) {
  const [imgUrl] = useState(() => URL.createObjectURL(file));
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [minScale, setMinScale] = useState(1);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isBusy, setIsBusy] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const maxScale = minScale * 4;

  // Pan/pinch state lives in a ref, not React state — it changes on every
  // pointermove and never needs to trigger a render on its own (offset/scale
  // state already does that).
  const gesture = useRef<{
    pointers: Map<number, { x: number; y: number }>;
    mode: "pan" | "pinch" | null;
    panStart: { x: number; y: number };
    panStartOffset: { x: number; y: number };
    pinchStartDist: number;
    pinchStartScale: number;
  }>({
    pointers: new Map(),
    mode: null,
    panStart: { x: 0, y: 0 },
    panStartOffset: { x: 0, y: 0 },
    pinchStartDist: 0,
    pinchStartScale: 1,
  });

  useLayoutEffect(() => {
    return () => URL.revokeObjectURL(imgUrl);
  }, [imgUrl]);

  function maxOffsetFor(currentScale: number, naturalW: number, naturalH: number) {
    const container = containerRef.current;
    if (!container) return { x: 0, y: 0 };
    const rect = container.getBoundingClientRect();
    const dispW = naturalW * currentScale;
    const dispH = naturalH * currentScale;
    return {
      x: Math.max(0, (dispW - rect.width) / 2),
      y: Math.max(0, (dispH - rect.height) / 2),
    };
  }

  function handleImageLoad() {
    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container) return;
    const rect = container.getBoundingClientRect();
    const naturalW = img.naturalWidth;
    const naturalH = img.naturalHeight;
    // "Cover" fit — the smaller of the two axis ratios would letterbox
    // (object-fit: contain); the larger always fills the container.
    const cover = Math.max(rect.width / naturalW, rect.height / naturalH);
    setNaturalSize({ w: naturalW, h: naturalH });
    setMinScale(cover);
    setScale(cover);
    setOffset({ x: 0, y: 0 });
  }

  function applyScale(nextScale: number) {
    if (!naturalSize) return;
    const clamped = clamp(nextScale, minScale, maxScale);
    setScale(clamped);
    setOffset((prev) => {
      const bound = maxOffsetFor(clamped, naturalSize.w, naturalSize.h);
      return {
        x: clamp(prev.x, -bound.x, bound.x),
        y: clamp(prev.y, -bound.y, bound.y),
      };
    });
  }

  function onPointerDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (gesture.current.pointers.size === 1) {
      gesture.current.mode = "pan";
      gesture.current.panStart = { x: e.clientX, y: e.clientY };
      gesture.current.panStartOffset = offset;
    } else if (gesture.current.pointers.size === 2) {
      const [a, b] = [...gesture.current.pointers.values()];
      gesture.current.mode = "pinch";
      gesture.current.pinchStartDist = distance(a, b) || 1;
      gesture.current.pinchStartScale = scale;
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!gesture.current.pointers.has(e.pointerId) || !naturalSize) return;
    gesture.current.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (gesture.current.mode === "pan" && gesture.current.pointers.size === 1) {
      const dx = e.clientX - gesture.current.panStart.x;
      const dy = e.clientY - gesture.current.panStart.y;
      const bound = maxOffsetFor(scale, naturalSize.w, naturalSize.h);
      setOffset({
        x: clamp(gesture.current.panStartOffset.x + dx, -bound.x, bound.x),
        y: clamp(gesture.current.panStartOffset.y + dy, -bound.y, bound.y),
      });
    } else if (gesture.current.mode === "pinch" && gesture.current.pointers.size === 2) {
      const [a, b] = [...gesture.current.pointers.values()];
      const ratio = distance(a, b) / gesture.current.pinchStartDist;
      applyScale(gesture.current.pinchStartScale * ratio);
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    gesture.current.pointers.delete(e.pointerId);
    if (gesture.current.pointers.size === 1) {
      // Dropped from pinch back to a single finger — rebaseline pan so it
      // doesn't jump using a stale two-finger-era start point.
      const [remaining] = [...gesture.current.pointers.entries()];
      gesture.current.mode = "pan";
      gesture.current.panStart = { x: remaining[1].x, y: remaining[1].y };
      gesture.current.panStartOffset = offset;
    } else if (gesture.current.pointers.size === 0) {
      gesture.current.mode = null;
    }
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    applyScale(scale - e.deltaY * 0.001 * scale);
  }

  async function handleConfirm() {
    const container = containerRef.current;
    const img = imgRef.current;
    if (!container || !img || !naturalSize) return;

    setIsBusy(true);
    try {
      const rect = container.getBoundingClientRect();
      const imgLeft = (rect.width - naturalSize.w * scale) / 2 + offset.x;
      const imgTop = (rect.height - naturalSize.h * scale) / 2 + offset.y;
      const srcX = clamp(-imgLeft / scale, 0, naturalSize.w);
      const srcY = clamp(-imgTop / scale, 0, naturalSize.h);
      const srcW = Math.min(rect.width / scale, naturalSize.w - srcX);
      const srcH = Math.min(rect.height / scale, naturalSize.h - srcY);

      const outW = outputSize;
      const outH = Math.round(outputSize / aspect);
      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, outW, outH);

      const outputType = file.type === "image/png" ? "image/png" : "image/jpeg";
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, outputType, 0.85),
      );
      if (!blob) return;

      // Rebuilt from raw bytes rather than the canvas.toBlob() Blob directly
      // — see resizeImageFile in upload-client.ts, same Android WebView
      // stale-temp-file issue applies to any canvas-derived Blob here.
      const buf = await blob.arrayBuffer();
      const ext = outputType === "image/png" ? "png" : "jpg";
      const cropped = new File([buf], file.name.replace(/\.\w+$/, `.${ext}`), {
        type: outputType,
      });
      onCropped(cropped);
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm rounded-xl bg-surface p-4 shadow-xl">
        <p className="mb-3 text-sm font-medium">{title}</p>
        <div
          ref={containerRef}
          className="relative mx-auto touch-none select-none overflow-hidden rounded-lg bg-black"
          style={{ width: "100%", maxWidth: 320, aspectRatio: String(aspect) }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={imgUrl}
            alt=""
            draggable={false}
            onLoad={handleImageLoad}
            className="absolute left-1/2 top-1/2 max-w-none"
            style={
              naturalSize
                ? {
                    width: naturalSize.w * scale,
                    height: naturalSize.h * scale,
                    transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
                  }
                : { opacity: 0 }
            }
          />
        </div>

        <input
          type="range"
          aria-label="Zoom"
          min={minScale}
          max={maxScale}
          step={(maxScale - minScale) / 100 || 0.01}
          value={scale}
          disabled={!naturalSize}
          onChange={(e) => applyScale(Number(e.target.value))}
          className="mt-4 w-full"
        />

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isBusy}
            className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!naturalSize || isBusy}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink disabled:opacity-50"
          >
            {isBusy ? "Cropping..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
