"use client";

import { useEffect, useId, useRef } from "react";

function hasMarker(key: string): boolean {
  const state = window.history.state as Record<string, unknown> | null;
  return Boolean(state && state[key]);
}

/**
 * The back button (browser, Android) closes a small layer (a confirmation, a picker panel) before anything under it,
 * the same way MuseFeed's comments and MuseViewerOverlay do: while `active`, a same-URL history entry carrying this
 * layer's own marker sits on top, keeping whatever state the entry under it had (so their markers survive). Back pops
 * it and `onBack` runs. Closing the layer any other way pops that entry again, so it never lingers and the next back
 * press reaches whatever is underneath.
 *
 * The pop on close is deferred to the next task and skipped if the layer opened again meanwhile: React's development
 * double-run of effects (cleanup, then run again at once) must neither push twice nor go back.
 */
export function useBackDismiss(active: boolean, onBack: () => void) {
  const key = `ykLayer${useId()}`;
  const onBackRef = useRef(onBack);
  useEffect(() => {
    onBackRef.current = onBack;
  });
  const activeRef = useRef(false);

  useEffect(() => {
    if (!active) return;
    activeRef.current = true;
    if (!hasMarker(key)) {
      window.history.pushState({ ...((window.history.state as object | null) ?? {}), [key]: true }, "");
    }
    const onPopState = () => {
      if (hasMarker(key)) return;
      activeRef.current = false;
      onBackRef.current();
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      activeRef.current = false;
      setTimeout(() => {
        if (!activeRef.current && hasMarker(key)) window.history.back();
      }, 0);
    };
  }, [active, key]);
}
