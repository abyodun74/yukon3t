"use client";

// Pauses every currently-playing <video> (and freezes every embedded
// YouTube/Vimeo/TikTok/Instagram/Facebook/Dailymotion iframe — see
// post-card.tsx's data-video-embed-pause) for the duration of a call, and
// restores exactly what was playing once the call is fully done. Works
// against the DOM directly rather than each video surface's own React state
// so it applies uniformly to every current and future <video>/embed on the
// page — feed posts, comments, stories, the lightbox, live streams — with
// no per-component wiring.
//
// Reference-counted rather than a plain on/off flag: a call can be paused
// for by more than one caller in overlapping windows — an incoming call
// pauses on ring (see incoming-call-listener.tsx) and CallSessionProvider's
// startSession also pauses once it connects, and both callee *and* caller
// go through startSession/endSession (confirmed live: an earlier version
// only wired this into the callee-only ringing path, so a video kept
// playing — and audibly fighting the call's own audio — for whoever placed
// the call, since they never go through a "ringing" state at all). Only the
// first activation actually captures what was playing, and only the last
// matching deactivation resumes it, so ring-then-answer on the callee side
// doesn't stomp its own paused-list with an empty one from the second call.
let activeCount = 0;
let pausedVideos: HTMLVideoElement[] = [];
let frozenEmbeds: { el: HTMLIFrameElement; src: string }[] = [];

const EMBED_SELECTOR = "iframe[data-video-embed-pause]";

export function pauseAllPlayingVideos() {
  if (activeCount === 0) {
    pausedVideos = Array.from(document.querySelectorAll("video")).filter((v) => !v.paused);
    pausedVideos.forEach((v) => v.pause());

    // No cross-origin postMessage control API is wired up for any of
    // these providers, and several (TikTok, Instagram, Facebook) don't
    // reliably expose one at all for a bare embed — clearing src is the
    // one mechanism that's guaranteed to actually stop playback/audio
    // for every provider uniformly. Loses playback position on resume
    // (the embed reloads from its start), an acceptable trade-off for a
    // passive social embed. Scoped to the explicit data attribute, not a
    // bare `iframe` selector — this must never touch the active call's
    // own iframe (Daily Prebuilt) or anything else on the page.
    frozenEmbeds = Array.from(document.querySelectorAll<HTMLIFrameElement>(EMBED_SELECTOR))
      .filter((el) => el.src)
      .map((el) => ({ el, src: el.src }));
    frozenEmbeds.forEach(({ el }) => {
      el.src = "about:blank";
    });
  }
  activeCount++;
}

export function resumePausedVideos() {
  activeCount = Math.max(0, activeCount - 1);
  if (activeCount > 0) return;

  const toResume = pausedVideos;
  pausedVideos = [];
  toResume.forEach((v) => {
    // A story/post could have advanced away, unmounted, or otherwise
    // stopped making sense to resume while the call was up — play() then
    // rejects (or the element just silently no-ops), neither of which
    // should surface as an error for something this best-effort.
    v.play().catch(() => {});
  });

  const toUnfreeze = frozenEmbeds;
  frozenEmbeds = [];
  toUnfreeze.forEach(({ el, src }) => {
    el.src = src;
  });
}
