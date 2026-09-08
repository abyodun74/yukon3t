"use client";

import { useRef, useState, type RefObject } from "react";

export type DragPosition = { left: number; top: number } | null;

const EDGE_MARGIN = 8;

function clampToViewport(left: number, top: number, width: number, height: number) {
  const maxLeft = Math.max(EDGE_MARGIN, window.innerWidth - width - EDGE_MARGIN);
  const maxTop = Math.max(EDGE_MARGIN, window.innerHeight - height - EDGE_MARGIN);
  return {
    left: Math.min(Math.max(EDGE_MARGIN, left), maxLeft),
    top: Math.min(Math.max(EDGE_MARGIN, top), maxTop),
  };
}

/**
 * Free-drags a `position: fixed` element around the viewport via pointer
 * events, clamped so it can never end up fully off-screen. Shared by the
 * minimized call widget and the in-call draggable self-view (see
 * global-call-frame.tsx) — both float over a cross-origin Daily iframe,
 * which would otherwise capture the pointer events this depends on before
 * they ever reached React, so both need their handlers on a drag *handle*
 * layered above the iframe rather than on the element that visibly moves.
 *
 * `null` position means "still at whatever default corner the caller's own
 * CSS puts it" — once dragged, an explicit left/top takes over completely.
 */
export function useViewportDrag(targetRef: RefObject<HTMLElement | null>) {
  const [position, setPosition] = useState<DragPosition>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startLeft: number;
    startTop: number;
  } | null>(null);

  function onPointerDown(e: React.PointerEvent<HTMLElement>) {
    const el = targetRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const startLeft = position?.left ?? rect.left;
    const startTop = position?.top ?? rect.top;
    dragStateRef.current = { pointerId: e.pointerId, startClientX: e.clientX, startClientY: e.clientY, startLeft, startTop };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLElement>) {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const el = targetRef.current;
    const width = el?.offsetWidth ?? 0;
    const height = el?.offsetHeight ?? 0;
    const dx = e.clientX - drag.startClientX;
    const dy = e.clientY - drag.startClientY;
    setPosition(clampToViewport(drag.startLeft + dx, drag.startTop + dy, width, height));
  }

  function onPointerUp(e: React.PointerEvent<HTMLElement>) {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragStateRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }

  return {
    position,
    reset: () => setPosition(null),
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
  };
}
