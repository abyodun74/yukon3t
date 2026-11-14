"use client";

import { useCallback, useEffect, useRef } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  TouchEvent as ReactTouchEvent,
} from "react";
import { hapticSelection } from "@/lib/haptics";
import {
  CARD_LONG_PRESS_MS,
  CONTEXT_MENU_FROM_TOUCH_MS,
  LONG_PRESS_CLICK_SUPPRESS_MS,
  LONG_PRESS_IDLE,
  cardLongPressStep,
  isContextMenuShortcut,
  isDuplicateContextMenu,
  isIgnoredCardPressTarget,
  type LongPressEvent,
  type LongPressState,
} from "@/lib/long-press";

export type LongPressOpenSource = "touch" | "mouse" | "keyboard";

/**
 * Long press (touch), right-click / Android's long-press `contextmenu` (mouse) and the ContextMenu key / Shift+F10
 * (keyboard) on one element, all opening the same menu through `onOpen`. Spread the returned handlers on the element.
 *
 * - Touch: `CARD_LONG_PRESS_MS` held within the slop opens it; moving, a second finger, any scroll, lifting or a
 *   touchcancel first ends the press. A press that fired swallows the release's click (no navigation) and clears any
 *   word selection. Touch handlers are passive except touchend, so vertical scrolling is never held up.
 * - A press starting on a control inside the element (`isIgnoredCardPressTarget`) is left alone.
 * - The native callout / context menu on the element is always blocked (`onContextMenu` preventDefault); the element
 *   should also carry `-webkit-touch-callout: none` and `user-select: none` (see circle-long-press.tsx).
 */
export function useLongPress(onOpen: (source: LongPressOpenSource) => void) {
  const stateRef = useRef<LongPressState>(LONG_PRESS_IDLE);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressIdRef = useRef(0);
  const suppressClickUntilRef = useRef(0);
  const lastTouchAtRef = useRef(0);
  const scrollListenerRef = useRef<(() => void) | null>(null);
  const onOpenRef = useRef(onOpen);
  useEffect(() => {
    onOpenRef.current = onOpen;
  });

  const stopWatchingScroll = useCallback(() => {
    if (scrollListenerRef.current) {
      document.removeEventListener("scroll", scrollListenerRef.current, true);
      scrollListenerRef.current = null;
    }
  }, []);

  const dispatch = useCallback(
    (event: LongPressEvent) => {
      const result = cardLongPressStep(stateRef.current, event);
      stateRef.current = result.state;
      if (result.state.phase !== "pressing") {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = null;
        stopWatchingScroll();
      }
      if (result.fire) {
        suppressClickUntilRef.current = Date.now() + LONG_PRESS_CLICK_SUPPRESS_MS;
        window.getSelection()?.removeAllRanges();
        void hapticSelection();
        onOpenRef.current("touch");
      }
    },
    [stopWatchingScroll],
  );

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      stopWatchingScroll();
    },
    [stopWatchingScroll],
  );

  const onTouchStart = useCallback(
    (e: ReactTouchEvent) => {
      lastTouchAtRef.current = Date.now();
      if (isIgnoredCardPressTarget(e.target as Element | null)) {
        dispatch({ type: "cancel" });
        return;
      }
      const touch = e.touches[0];
      if (!touch) return;
      pressIdRef.current += 1;
      const id = pressIdRef.current;
      dispatch({ type: "down", id, x: touch.clientX, y: touch.clientY, at: Date.now(), touches: e.touches.length });
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      if (stateRef.current.phase === "pressing") {
        // Any scroll (the page, or a list this card sits in) ends the press.
        if (!scrollListenerRef.current) {
          const onScroll = () => dispatch({ type: "scroll" });
          scrollListenerRef.current = onScroll;
          document.addEventListener("scroll", onScroll, { capture: true, passive: true });
        }
        timerRef.current = setTimeout(() => dispatch({ type: "timeout", id, at: Date.now() }), CARD_LONG_PRESS_MS);
      }
    },
    [dispatch],
  );

  const onTouchMove = useCallback(
    (e: ReactTouchEvent) => {
      if (stateRef.current.phase !== "pressing") return;
      if (e.touches.length !== 1) {
        dispatch({ type: "cancel" });
        return;
      }
      dispatch({ type: "move", x: e.touches[0].clientX, y: e.touches[0].clientY });
    },
    [dispatch],
  );

  const onTouchEnd = useCallback(
    (e: ReactTouchEvent) => {
      const fired = stateRef.current.phase === "fired";
      dispatch({ type: "up" });
      if (fired) {
        // No synthesized click / navigation after a long press, and no stray word selection left behind.
        if (e.cancelable) e.preventDefault();
        window.getSelection()?.removeAllRanges();
      }
    },
    [dispatch],
  );

  const onTouchCancel = useCallback(() => dispatch({ type: "cancel" }), [dispatch]);

  const onContextMenu = useCallback(
    (e: ReactMouseEvent) => {
      if (isIgnoredCardPressTarget(e.target as Element | null)) return;
      // Never the browser's / WebView's own menu (open in new tab, copy link address, link preview) on the card.
      e.preventDefault();
      const now = Date.now();
      if (isDuplicateContextMenu(now, suppressClickUntilRef.current)) return;
      const fromTouch = now - lastTouchAtRef.current < CONTEXT_MENU_FROM_TOUCH_MS;
      const fromKeyboard = e.clientX === 0 && e.clientY === 0 && !fromTouch;
      if (fromTouch) {
        // Android's own long press got there before our timer: the release must not navigate either.
        dispatch({ type: "cancel" });
        suppressClickUntilRef.current = now + LONG_PRESS_CLICK_SUPPRESS_MS;
        window.getSelection()?.removeAllRanges();
      }
      onOpenRef.current(fromTouch ? "touch" : fromKeyboard ? "keyboard" : "mouse");
    },
    [dispatch],
  );

  const onKeyDown = useCallback((e: ReactKeyboardEvent) => {
    if (!isContextMenuShortcut(e)) return;
    if (isIgnoredCardPressTarget(e.target as Element | null)) return;
    e.preventDefault();
    onOpenRef.current("keyboard");
  }, []);

  const onClickCapture = useCallback((e: ReactMouseEvent) => {
    if (Date.now() < suppressClickUntilRef.current) {
      e.preventDefault();
      e.stopPropagation();
      suppressClickUntilRef.current = 0;
    }
  }, []);

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, onContextMenu, onKeyDown, onClickCapture };
}
