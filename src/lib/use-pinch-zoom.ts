"use client";

import { useRef, useState, type MouseEvent, type TouchEvent, type Touch, type WheelEvent } from "react";

/**
 * Shared pinch-to-zoom/pan/double-tap gesture math, extracted from
 * ZoomableImage (the post-photo Lightbox's own zoom) so a second surface —
 * an album carousel photo, which needs the same gesture but layered over a
 * *different* base behavior (native horizontal scroll-snap + a tap
 * navigates to that photo's own post) — doesn't duplicate ~150 lines of
 * touch/mouse gesture handling. Callers spread `bind` onto their gesture
 * container and read `scale`/`translate`/`isGesturing` for the transform,
 * same shape ZoomableImage always used inline.
 *
 * `wasZoomGesture()` is what a caller wrapping something clickable (a
 * carousel photo's own `<Link>`) needs: it reports whether the touch
 * sequence that just ended actually pinched or panned-while-zoomed, so a
 * click handler can suppress navigation for that tap instead of navigating
 * away right after the user was trying to zoom.
 */
export function usePinchZoom({
  minScale = 1,
  maxScale,
  doubleTapScale,
}: {
  minScale?: number;
  maxScale: number;
  doubleTapScale: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [scale, setScale] = useState(minScale);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isGesturing, setIsGesturing] = useState(false);

  const DOUBLE_TAP_MAX_DELAY_MS = 300;
  const DOUBLE_TAP_MAX_MOVE_PX = 12;

  // Mutable gesture bookkeeping — doesn't need to trigger re-renders, and
  // must stay current mid-gesture without waiting on React's state batching.
  const gesture = useRef({
    mode: "none" as "none" | "pinch" | "pan",
    startDistance: 0,
    startScale: minScale,
    startTranslate: { x: 0, y: 0 },
    startPoint: { x: 0, y: 0 },
    lastTapAt: 0,
    lastTapPoint: { x: 0, y: 0 },
    // Set whenever this gesture actually pinched or panned while zoomed —
    // read (and cleared) by wasZoomGesture() below.
    zoomedThisGesture: false,
  });

  function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
  }
  function touchDistance(a: Touch, b: Touch) {
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }
  function touchMidpoint(a: Touch, b: Touch) {
    return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
  }

  function clampTranslate(nextScale: number, x: number, y: number) {
    const container = containerRef.current;
    const img = imgRef.current;
    if (!container || !img) return { x, y };
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
    if (scale > minScale) {
      setScale(minScale);
      setTranslate({ x: 0, y: 0 });
    } else {
      zoomAround(clientX, clientY, doubleTapScale);
      gesture.current.zoomedThisGesture = true;
    }
  }

  function resetIfZoomed() {
    if (scale <= minScale) return;
    setScale(minScale);
    setTranslate({ x: 0, y: 0 });
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
      gesture.current.mode = scale > minScale ? "pan" : "none";
      gesture.current.startTranslate = translate;
      gesture.current.startPoint = { x: t.clientX, y: t.clientY };
    }
  }

  function handleTouchMove(e: TouchEvent<HTMLDivElement>) {
    if (gesture.current.mode === "pinch" && e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const nextScale = clamp(
        gesture.current.startScale * (touchDistance(a, b) / gesture.current.startDistance),
        minScale,
        maxScale,
      );
      const mid = touchMidpoint(a, b);
      const dx = mid.x - gesture.current.startPoint.x;
      const dy = mid.y - gesture.current.startPoint.y;
      setScale(nextScale);
      setTranslate(clampTranslate(nextScale, gesture.current.startTranslate.x + dx, gesture.current.startTranslate.y + dy));
      if (Math.abs(nextScale - minScale) > 0.01) gesture.current.zoomedThisGesture = true;
    } else if (gesture.current.mode === "pan" && e.touches.length === 1) {
      const t = e.touches[0];
      const dx = t.clientX - gesture.current.startPoint.x;
      const dy = t.clientY - gesture.current.startPoint.y;
      setTranslate(clampTranslate(scale, gesture.current.startTranslate.x + dx, gesture.current.startTranslate.y + dy));
      gesture.current.zoomedThisGesture = true;
    }
  }

  function handleTouchEnd(e: TouchEvent<HTMLDivElement>) {
    if (e.touches.length === 0) {
      const wasPan = gesture.current.mode === "pan";
      const last = e.changedTouches[0];
      if (last) {
        const moved = Math.hypot(last.clientX - gesture.current.startPoint.x, last.clientY - gesture.current.startPoint.y);
        if (!wasPan || moved < DOUBLE_TAP_MAX_MOVE_PX) resetIfZoomed();
      }
      gesture.current.mode = "none";
      setIsGesturing(false);
      if (scale < minScale) {
        setScale(minScale);
        setTranslate({ x: 0, y: 0 });
      }
    }
  }

  function handleWheel(e: WheelEvent<HTMLDivElement>) {
    e.preventDefault();
    const nextScale = clamp(scale - e.deltaY * 0.01, minScale, maxScale);
    zoomAround(e.clientX, e.clientY, nextScale);
    if (Math.abs(nextScale - minScale) > 0.01) gesture.current.zoomedThisGesture = true;
  }

  function handleMouseDown(e: MouseEvent<HTMLDivElement>) {
    if (scale <= minScale) return;
    gesture.current.mode = "pan";
    gesture.current.startTranslate = translate;
    gesture.current.startPoint = { x: e.clientX, y: e.clientY };
  }

  function handleMouseMove(e: MouseEvent<HTMLDivElement>) {
    if (gesture.current.mode !== "pan") return;
    const dx = e.clientX - gesture.current.startPoint.x;
    const dy = e.clientY - gesture.current.startPoint.y;
    setTranslate(clampTranslate(scale, gesture.current.startTranslate.x + dx, gesture.current.startTranslate.y + dy));
    gesture.current.zoomedThisGesture = true;
  }

  function handleMouseUp() {
    gesture.current.mode = "none";
  }

  /** Reads and clears whether the gesture that just ended actually zoomed/panned — for a caller to suppress a click/navigation on that same tap. */
  function wasZoomGesture() {
    const was = gesture.current.zoomedThisGesture || scale > minScale;
    gesture.current.zoomedThisGesture = false;
    return was;
  }

  /**
   * A click still fires after a mouse-drag pan ends — this tells a caller's
   * onClick whether the pointer barely moved since the gesture's own
   * mousedown/touchstart, i.e. whether to treat it as a stationary tap
   * (worth acting on: reset-if-zoomed, or navigate) rather than the
   * tail end of a drag.
   */
  function movedPastTapThreshold(clientX: number, clientY: number) {
    return Math.hypot(clientX - gesture.current.startPoint.x, clientY - gesture.current.startPoint.y) >= DOUBLE_TAP_MAX_MOVE_PX;
  }

  return {
    containerRef,
    imgRef,
    scale,
    translate,
    isGesturing,
    resetIfZoomed,
    toggleZoom,
    wasZoomGesture,
    movedPastTapThreshold,
    // Deliberately no `touchAction` in here — ZoomableImage always wants
    // "none" (nothing else on that surface needs native touch), but the
    // album carousel needs it to flip between "pan-x" (let native
    // horizontal scroll-snap swipe between photos while not zoomed) and
    // "none" (claim the gesture exclusively once zoomed, so panning around
    // a zoomed-in photo doesn't also scroll to the next one) — a static
    // value here couldn't serve both.
    bind: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
      onWheel: handleWheel,
      onDoubleClick: (e: MouseEvent<HTMLDivElement>) => toggleZoom(e.clientX, e.clientY),
      onMouseDown: handleMouseDown,
      onMouseMove: handleMouseMove,
      onMouseUp: handleMouseUp,
      onMouseLeave: handleMouseUp,
    },
  };
}
