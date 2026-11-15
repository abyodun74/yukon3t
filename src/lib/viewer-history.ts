"use client";

import { useCallback, useEffect, useId, useRef, type MouseEvent } from "react";

// History handling shared by the full-screen viewers that open over a page without changing its URL: the Story viewer
// (StoryTrayViewer) and the Muse viewer over Home (MuseViewerOverlay), plus the /muse page's comments sheet when a link
// inside it is tapped. Each owns one same-URL history entry while open; layers inside it (comments, Share, a picker
// panel, a confirmation) push their own entries on top through useBackDismiss. Every way out goes back through those
// entries, so none is left behind, and a link inside the viewer navigates only once history is back on the page's own
// entry: Back from the destination then returns to the page that was open before the viewer, never to an orphan copy.

/**
 * What a viewer does on a popstate, given whether the history entry now current still carries its own marker
 * (`onOwnEntry`) and whether it is on its way out (`closing`).
 *
 * - Not on its own entry any more: back left the viewer, it closes ("close").
 * - On its own entry while closing: the pop only took a layer above it away (comments, Share), so it goes back once
 *   more ("back") until it is past its own entry. That is what lets Close, Escape and a drag down leave history
 *   exactly as it was before the viewer opened, however many layers were open.
 * - On its own entry otherwise: back closed a layer above it (that layer's useBackDismiss handles it); the viewer
 *   stays ("ignore").
 */
export function viewerHistoryPopAction({ onOwnEntry, closing }: { onOwnEntry: boolean; closing: boolean }): "close" | "back" | "ignore" {
  if (!onOwnEntry) return "close";
  return closing ? "back" : "ignore";
}

/** If a requested history.back() never produces a popstate (no entry to go back to), close anyway after this long. */
export const VIEWER_HISTORY_CLOSE_FALLBACK_MS = 800;

/**
 * While closing, the next back is asked for only after this pause, and only if the viewer is still on its own entry.
 * A layer above it that closed at the same moment (the emoji picker closing on the same tap as the X) may have asked
 * for its own back already; waiting lets that one land first, so the walk never goes one entry too far.
 */
export const VIEWER_HISTORY_WALK_STEP_MS = 50;

/**
 * The in-app path a click on a link inside the viewer navigates to, or null when the click should be left alone:
 * not a plain primary click (a modifier key or another button opens a new tab/window), a new-window or download
 * link, another origin (the app's own link handling deals with those), or the page that is already open.
 */
export function internalNavigationHref({
  href,
  origin,
  currentPath,
  target,
  download,
  button,
  modifier,
}: {
  href: string;
  origin: string;
  /** location.pathname + location.search of the page under the viewer. */
  currentPath: string;
  target: string;
  download: boolean;
  button: number;
  modifier: boolean;
}): string | null {
  if (button !== 0 || modifier || download) return null;
  if (target && target !== "_self") return null;
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  const path = `${url.pathname}${url.search}`;
  if (path === currentPath) return null;
  return `${path}${url.hash}`;
}

/**
 * For a viewer's onClickCapture: the in-app path of the link this click is on (internalNavigationHref), or null.
 * Links in sheets portaled from the viewer count too (React bubbles their clicks through the component tree). A
 * non-null answer means the caller takes the navigation over, so it must preventDefault/stopPropagation.
 */
export function internalNavigationFromClick(e: MouseEvent<HTMLElement>): string | null {
  if (e.defaultPrevented) return null;
  const anchor = (e.target as Element | null)?.closest?.("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  return internalNavigationHref({
    href: anchor.href,
    origin: window.location.origin,
    currentPath: `${window.location.pathname}${window.location.search}`,
    target: anchor.target,
    download: anchor.hasAttribute("download"),
    button: e.button,
    modifier: e.metaKey || e.ctrlKey || e.shiftKey || e.altKey,
  });
}

function hasMarker(key: string): boolean {
  const state = window.history.state as Record<string, unknown> | null;
  return Boolean(state && state[key]);
}

/**
 * Goes back through history while `onLayer()` says the current entry is still one of a layer's own same-URL entries,
 * then runs `after` from the first entry that isn't (the page's). For a layer without a viewer hook of its own: the
 * /muse page's comments sheet (with its picker panel on top) when a link inside it is tapped. Runs `after` at once
 * when not on such an entry, and anyway after VIEWER_HISTORY_CLOSE_FALLBACK_MS if a back produces no popstate.
 */
export function backOutOfLayerThen(onLayer: () => boolean, after: () => void) {
  if (!onLayer()) {
    after();
    return;
  }
  let done = false;
  let fallback: ReturnType<typeof setTimeout> | undefined;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(fallback);
    window.removeEventListener("popstate", onPopState);
    // After Next.js's own popstate handling for the entry just landed on, so its navigation is the last word.
    setTimeout(after, 0);
  };
  const armFallback = () => {
    clearTimeout(fallback);
    fallback = setTimeout(finish, VIEWER_HISTORY_CLOSE_FALLBACK_MS);
  };
  function onPopState() {
    if (done) return;
    if (!onLayer()) {
      finish();
      return;
    }
    armFallback();
    setTimeout(() => {
      if (!done && onLayer()) window.history.back();
    }, VIEWER_HISTORY_WALK_STEP_MS);
  }
  window.addEventListener("popstate", onPopState);
  armFallback();
  window.history.back();
}

/**
 * A viewer's own history entry, owned by the component that stays mounted for the viewer's whole life (StoryTrayViewer,
 * since StoryViewer remounts per person; MuseViewerOverlay).
 *
 * Opening pushes one same-URL entry that keeps the state under it (Next.js's own fields included, so nothing
 * navigates) plus a marker. The browser's / Android's back button and the iOS back gesture pop it and the viewer
 * closes; layers inside the viewer push their own entries on top through useBackDismiss (copying this marker), so back
 * closes those first. `close()` (the X, Escape, a drag down, the end of the last story) goes back through the entries
 * instead of closing directly, so none is left behind and the next back reaches the page. `closeThen(after)` does the
 * same and runs `after` once history is back on the page's own entry: a link inside the viewer navigates from there
 * (router.push), so the viewer's entries are replaced by the destination and Back from it returns to the page.
 */
export function useViewerHistory(onClosed: () => void): {
  close: () => void;
  closeThen: (after: () => void) => void;
} {
  const key = `ykViewer${useId()}`;
  const onClosedRef = useRef(onClosed);
  useEffect(() => {
    onClosedRef.current = onClosed;
  });
  const closingRef = useRef(false);
  const doneRef = useRef(false);
  const activeRef = useRef(false);
  const fallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const poppedRef = useRef(false);
  const afterRef = useRef<(() => void) | null>(null);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (fallbackRef.current) clearTimeout(fallbackRef.current);
    onClosedRef.current();
    const after = afterRef.current;
    afterRef.current = null;
    // After Next.js's own popstate handling for the entry we just landed on, so its navigation is the last word.
    if (after) setTimeout(after, 0);
  }, []);

  useEffect(() => {
    activeRef.current = true;
    // React's development double-run of effects: the marker is already there on the second run, so no second push.
    if (!hasMarker(key)) {
      window.history.pushState({ ...((window.history.state as object | null) ?? {}), [key]: true }, "");
    }
    const onPopState = () => {
      poppedRef.current = true;
      if (doneRef.current) return;
      const action = viewerHistoryPopAction({ onOwnEntry: hasMarker(key), closing: closingRef.current });
      if (action === "close") finish();
      else if (action === "back") {
        setTimeout(() => {
          if (!doneRef.current && hasMarker(key)) window.history.back();
        }, VIEWER_HISTORY_WALK_STEP_MS);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      activeRef.current = false;
      if (fallbackRef.current) clearTimeout(fallbackRef.current);
      // Unmounted some other way (the whole page went away under it): drop the entry if it is still on top. Not after
      // close(), which already asked for every back it needs.
      setTimeout(() => {
        if (!activeRef.current && !closingRef.current && hasMarker(key)) window.history.back();
      }, 0);
    };
  }, [key, finish]);

  const start = useCallback(
    (after: (() => void) | null) => {
      if (closingRef.current || doneRef.current) return;
      closingRef.current = true;
      poppedRef.current = false;
      afterRef.current = after;
      if (!hasMarker(key)) {
        finish();
        return;
      }
      window.history.back();
      // Only when that back produced no popstate at all; a walk back through layers above is already under way otherwise.
      fallbackRef.current = setTimeout(() => {
        if (!poppedRef.current) finish();
      }, VIEWER_HISTORY_CLOSE_FALLBACK_MS);
    },
    [key, finish],
  );

  const close = useCallback(() => start(null), [start]);
  const closeThen = useCallback((after: () => void) => start(after), [start]);
  return { close, closeThen };
}
