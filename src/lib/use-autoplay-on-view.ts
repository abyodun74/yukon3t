"use client";

import { useEffect, useRef } from "react";

// Below this fraction of the video actually visible, treat it as "scrolled
// past" and pause — matches the Instagram/TikTok-style feed convention this
// is modeled on (autoplay once mostly in view, not the instant one pixel
// peeks onscreen).
const VISIBILITY_THRESHOLD = 0.6;

/**
 * Ref to attach to a feed `<video>` so it autoplays once scrolled mostly
 * into view and pauses once scrolled back out — the browser only allows
 * autoplay at all when the element is also `muted` (and `playsInline` on
 * iOS/mobile WebViews), so callers must set both on the element itself;
 * this hook only drives play()/pause(), not those attributes.
 *
 * `autoplay: false` (a slow connection or Data saver, see
 * useNetworkQuality) keeps the scroll-out pause but never starts playback
 * on its own: the viewer taps play, and only then is the video downloaded.
 */
export function useAutoplayOnView<T extends HTMLVideoElement>({ autoplay = true }: { autoplay?: boolean } = {}) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.isIntersecting) {
          if (!autoplay) return;
          // Autoplay can still legitimately reject (e.g. a user's browser
          // setting overriding the muted-autoplay allowance) — never let
          // that surface as an unhandled rejection.
          el.play().catch(() => {});
        } else {
          el.pause();
        }
      },
      { threshold: VISIBILITY_THRESHOLD },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [autoplay]);

  return ref;
}
