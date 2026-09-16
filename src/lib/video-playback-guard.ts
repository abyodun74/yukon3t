"use client";

// Pauses every currently-playing <video> in the page for the duration of an
// incoming/active call (see incoming-call-listener.tsx) and resumes exactly
// the ones that were actually playing once the call ends — a feed video (or
// story/lightbox/live-stream) autoplaying under a full-screen call UI would
// otherwise keep playing (and, worse, keep making noise) behind it. Works
// against the DOM directly rather than each video surface's own React state
// so it applies uniformly to every current and future <video> on the page —
// feed posts, comments, stories, the lightbox, live streams — with no
// per-component wiring.
let pausedVideos: HTMLVideoElement[] = [];

export function pauseAllPlayingVideos() {
  pausedVideos = Array.from(document.querySelectorAll("video")).filter((v) => !v.paused);
  pausedVideos.forEach((v) => v.pause());
}

export function resumePausedVideos() {
  const toResume = pausedVideos;
  pausedVideos = [];
  toResume.forEach((v) => {
    // A story/post could have advanced away, unmounted, or otherwise
    // stopped making sense to resume while the call was up — play() then
    // rejects (or the element just silently no-ops), neither of which
    // should surface as an error for something this best-effort.
    v.play().catch(() => {});
  });
}
