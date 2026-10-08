"use client";

import { useEffect, useRef } from "react";

// Open dialogs, innermost last. Only the top one answers Escape — otherwise
// a sheet opened from inside another overlay (the story viewer's own
// "Share to" sheet, a report form opened from a post's menu inside a
// lightbox, ...) would close every layer underneath it on a single press.
const openDialogs: symbol[] = [];

/**
 * Focus handling every modal overlay needs for VoiceOver/Voice Control/
 * keyboard users, in one place: moves focus into the dialog when it opens
 * (so a screen reader's cursor lands inside it and announces its name,
 * instead of staying on the now-covered page behind), hands focus back to
 * whatever opened it on close, and optionally closes on Escape.
 *
 * Attach the returned ref to the element carrying role="dialog" and give
 * that element tabIndex={-1} — it's the fallback focus target. Anything
 * inside that already took focus itself (an autoFocus input) is left alone.
 */
export function useDialogFocus<T extends HTMLElement>(active: boolean, onEscape?: () => void) {
  const ref = useRef<T>(null);
  // Latest-callback ref so a caller passing an inline arrow doesn't tear
  // down and re-run the focus effect (and so re-steal focus) every render.
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  });

  useEffect(() => {
    if (!active) return;
    const id = Symbol("dialog");
    openDialogs.push(id);
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = ref.current;
    if (node && !node.contains(document.activeElement)) node.focus({ preventScroll: true });

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape" || !onEscapeRef.current) return;
      if (openDialogs[openDialogs.length - 1] !== id) return;
      onEscapeRef.current();
    }
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const i = openDialogs.indexOf(id);
      if (i !== -1) openDialogs.splice(i, 1);
      // Only when focus is still ours to give back: left inside the dialog
      // (a Sheet stays mounted through its exit animation) or dropped to
      // <body> (the dialog's DOM is already gone). If whatever closed the
      // dialog deliberately focused something else — a composer's text
      // field after picking from a sheet — that choice wins.
      const active = document.activeElement;
      const focusIsOurs = !active || active === document.body || Boolean(node?.contains(active));
      // isConnected: the trigger may be gone by now (a menu item that
      // unmounted with its menu) — focusing a detached node is a no-op that
      // would just drop focus to <body> anyway.
      if (focusIsOurs && previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, [active]);

  return ref;
}
