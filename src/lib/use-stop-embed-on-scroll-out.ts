"use client";

import { useEffect, useRef } from "react";

// Same feed convention as use-autoplay-on-view.ts's own threshold.
const VISIBILITY_THRESHOLD = 0.6;

/**
 * Ref to attach to an embedded YouTube/Vimeo/TikTok/Instagram/Facebook/
 * Dailymotion <iframe> in the feed so it actually stops once scrolled past —
 * confirmed live that it otherwise just kept playing (and making noise)
 * indefinitely after being scrolled out of view, unlike a direct-upload
 * <video> (see use-autoplay-on-view.ts), which already pauses correctly.
 * None of these providers have a postMessage control API wired up here
 * (see video-playback-guard.ts's own comment on the same limitation for the
 * call-pause feature), so clearing the iframe's own src is the one
 * mechanism that reliably stops it for every provider uniformly — the
 * trade-off is that scrolling back into view restarts the embed from the
 * beginning rather than truly resuming, same trade-off video-playback-guard
 * already accepts.
 */
export function useStopEmbedOnScrollOut<T extends HTMLIFrameElement>(src: string) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Track visibility purely as a side flag rather than reading el.src
    // back — some providers (Instagram in particular) rewrite the iframe's
    // effective src via their own embed.js after load, so el.src is no
    // longer a reliable "was this scrolled out" signal by the time a later
    // intersection fires.
    let visible = true;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.isIntersecting) {
          if (!visible) el.src = src;
          visible = true;
        } else {
          if (visible) el.src = "about:blank";
          visible = false;
        }
      },
      { threshold: VISIBILITY_THRESHOLD },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [src]);

  return ref;
}
