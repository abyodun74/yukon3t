"use client";

/*
 * Post music in the browser: one shared <audio> element for the whole page, driven by the coordinator in
 * src/lib/post-music-playback.ts (one post at a time, and every rule for when it stops).
 *
 * Why an <audio> element playing a WAV rendered on the device (not Web Audio, not a downloaded file):
 * - The track is synthesized by our own code (src/lib/music/) once per device, in short slices that hand the main
 *   thread back (renderScoreAsync; a Web Worker was tried, but Turbopack emits `new Worker(new URL(...))` as a raw
 *   asset, so it could not run on Vercel's build): the WAV is kept in Cache Storage (keyed by synth version + a hash of
 *   the score) and in memory as a blob: URL. Nothing is downloaded,
 *   so there is nothing to fetch in low-data mode, and nothing to license.
 * - An HTML media element is what the rest of the app's media already is: it follows the same iOS silent-switch and
 *   audio-session behaviour as the video sound it replaces, the same autoplay / user-gesture rules (one tap unlocks
 *   this element for the session, see unlockPostMusic), and the same background behaviour (we pause it on hide). Web
 *   Audio contexts on iOS WKWebView are muted by the silent switch, get "interrupted" on backgrounding and need a
 *   resume() inside a gesture afterwards, which is the less reliable path.
 * - PCM loops without the encoder gap an MP3/AAC file has at its seam, and the synth renders the loop seamlessly.
 *
 * The element is marked SELF_HELD (data-media-hold="self"): video-playback-guard.ts doesn't pause/resume it; the
 * coordinator interrupts it itself for a call, a full-screen viewer, the page being hidden or other audible media.
 */

import { useEffect, useRef, useSyncExternalStore, type RefObject } from "react";
import {
  createMusicCoordinator,
  loopDistance,
  musicPosition,
  MUSIC_REALIGN_SECONDS,
  otherMediaTakesOver,
  videoJumpedBack,
  videoMusicWanted,
  type MusicState,
  type ResolvedTrack,
} from "@/lib/post-music-playback";
import type { PostMusicKey } from "@/lib/post-music";
import {
  isCallMediaHoldActive,
  SELF_HELD_MEDIA_ATTR,
  subscribeCallMediaHold,
  subscribePageMediaHold,
} from "@/lib/video-playback-guard";

const CACHE_PREFIX = "yk-post-music-";
const MUSIC_ELEMENT_ATTR = "data-post-music";
const SAMPLE_RATE = 24_000;

let element: HTMLAudioElement | null = null;
let installed = false;
let unlocked = false;
const urls = new Map<PostMusicKey, Promise<ResolvedTrack>>();

function getElement(): HTMLAudioElement {
  if (element) return element;
  const el = document.createElement("audio");
  el.loop = true;
  el.preload = "auto";
  el.setAttribute(SELF_HELD_MEDIA_ATTR, "self");
  el.setAttribute(MUSIC_ELEMENT_ATTR, "");
  el.setAttribute("aria-hidden", "true");
  el.style.display = "none";
  document.body.appendChild(el);
  el.addEventListener("pause", () => coordinator.elementPaused());
  el.addEventListener("playing", pauseOtherAudibleMedia);
  element = el;
  return el;
}

/** Our music started: anything else audible on the page (a feed video with its own sound) stops. */
function pauseOtherAudibleMedia() {
  document.querySelectorAll<HTMLMediaElement>("video, audio").forEach((el) => {
    if (el === element || el.paused) return;
    if (otherMediaTakesOver({ isMusicElement: false, muted: el.muted, volume: el.volume, live: Boolean(el.srcObject) })) {
      el.pause();
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Rendering and caching a track

async function cachedWav(cacheId: string): Promise<ArrayBuffer | null> {
  try {
    if (typeof caches === "undefined") return null;
    const cache = await caches.open(`${CACHE_PREFIX}v1`);
    const hit = await cache.match(`/__post-music/${cacheId}.wav`);
    return hit ? await hit.arrayBuffer() : null;
  } catch {
    return null;
  }
}

async function storeWav(cacheId: string, wav: ArrayBuffer) {
  try {
    if (typeof caches === "undefined") return;
    const cache = await caches.open(`${CACHE_PREFIX}v1`);
    // Older renders of the same track (a changed score or synth) are dropped so they don't pile up.
    const key = cacheId.slice(0, cacheId.indexOf("-v"));
    for (const request of await cache.keys()) {
      const path = new URL(request.url).pathname;
      if (path.startsWith(`/__post-music/${key}-v`) && path !== `/__post-music/${cacheId}.wav`) await cache.delete(request);
    }
    await cache.put(
      `/__post-music/${cacheId}.wav`,
      new Response(wav.slice(0), { headers: { "Content-Type": "audio/wav" } }),
    );
  } catch {
    // Private mode, storage full, no Cache Storage: it renders again next time.
  }
}

async function loadTrack(key: PostMusicKey): Promise<ResolvedTrack> {
  const { trackCacheId, renderTrackWavAsync } = await import("@/lib/music/render-track");
  const cacheId = trackCacheId(key);
  let wav = await cachedWav(cacheId);
  if (!wav) {
    wav = await renderTrackWavAsync(key);
    void storeWav(cacheId, wav);
  }
  const seconds = (wav.byteLength - 44) / 2 / SAMPLE_RATE;
  return { url: URL.createObjectURL(new Blob([wav], { type: "audio/wav" })), seconds };
}

function resolveTrack(key: PostMusicKey): Promise<ResolvedTrack> {
  let promise = urls.get(key);
  if (!promise) {
    promise = loadTrack(key);
    urls.set(key, promise);
    promise.catch(() => urls.delete(key));
  }
  return promise;
}

// ---------------------------------------------------------------------------------------------------------------
// The coordinator and the page events that interrupt it

const coordinator = createMusicCoordinator({
  element: () => getElement(),
  resolve: resolveTrack,
  blocked: () => isCallMediaHoldActive() || (typeof document !== "undefined" && document.visibilityState === "hidden"),
});

function install() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") coordinator.interrupt("hidden");
  });
  window.addEventListener("pagehide", () => coordinator.stop());
  subscribeCallMediaHold(() => {
    if (isCallMediaHoldActive()) coordinator.interrupt("call");
  });
  subscribePageMediaHold(() => coordinator.interrupt("viewer"));
  // `play` doesn't bubble: captured on the document, like the media guard's one-video-at-a-time rule.
  document.addEventListener(
    "play",
    (event) => {
      const el = event.target;
      if (!(el instanceof HTMLMediaElement) || el === element) return;
      if (otherMediaTakesOver({ isMusicElement: el.hasAttribute(MUSIC_ELEMENT_ATTR), muted: el.muted, volume: el.volume, live: Boolean(el.srcObject) })) {
        coordinator.interrupt("other-media");
      }
    },
    { capture: true },
  );
}

const SILENT_WAV = (() => {
  // 10 ms of silence: played once from a tap so iOS lets the element play later without one.
  const samples = 240;
  const view = new DataView(new ArrayBuffer(44 + samples * 2));
  const ascii = (o: number, s: string) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples * 2, true);
  return view.buffer;
})();

/**
 * Call synchronously from a tap (the chip, a video's sound button or play button, the composer's preview): the first
 * time, the shared element plays a moment of silence inside the gesture, which is what lets iOS WebKit play it later
 * when the track is ready (after an await) or when a video's music starts on its own.
 */
export function unlockPostMusic() {
  if (typeof document === "undefined") return;
  install();
  if (unlocked) return;
  unlocked = true;
  const el = getElement();
  if (el.src) return;
  const silent = URL.createObjectURL(new Blob([SILENT_WAV], { type: "audio/wav" }));
  el.src = silent;
  // Stopped again at once (unless a track took the element meanwhile), so the silence never holds the device's
  // audio (another app's music keeps playing until a track really starts).
  el.play()
    .then(() => {
      if (el.src === silent) el.pause();
    })
    .catch(() => {});
}

export function startPostMusic(owner: symbol, key: PostMusicKey, at?: number) {
  install();
  return coordinator.start(owner, key, at);
}

export function pausePostMusic(owner: symbol) {
  coordinator.pause(owner);
}

export function stopPostMusic(owner?: symbol) {
  coordinator.stop(owner);
}

/** Resolves (renders, if needed) a track's blob: URL: the Muse viewer plays it in its own audio element. */
export function postMusicUrl(key: PostMusicKey): Promise<string> {
  return resolveTrack(key).then((track) => track.url);
}

const IDLE: MusicState = { owner: null, key: null, status: "idle" };

export function usePostMusicState(): MusicState {
  return useSyncExternalStore(coordinator.subscribe, coordinator.getState, () => IDLE);
}

/**
 * A video post's music: plays (muted video, music instead) while the video plays, the sound is on and the page is
 * visible; follows its pauses, buffering, seeks and loops; stops when the video unmounts. `muted` is the feed's shared
 * sound setting (useFeedVideoMuted) or a viewer's own.
 */
export function useVideoMusic(
  videoRef: RefObject<HTMLVideoElement | null>,
  key: PostMusicKey | null,
  muted: boolean,
  /** Changes whenever the <video> element itself is replaced (e.g. a frame toggled on), so the follower re-attaches. */
  elementKey: string | number | boolean = 0,
) {
  const mutedRef = useRef(muted);
  const syncRef = useRef<((realign: boolean) => void) | null>(null);
  useEffect(() => {
    mutedRef.current = muted;
    syncRef.current?.(false);
  }, [muted]);

  useEffect(() => {
    const video = videoRef.current;
    if (!key || !video) return;
    install();
    const owner = Symbol("post-video-music");
    let waiting = false;
    let lastTime = 0;
    const wanted = () =>
      videoMusicWanted({
        videoPlaying: !video.paused && !video.ended,
        videoWaiting: waiting,
        muted: mutedRef.current,
        hidden: document.visibilityState === "hidden",
        callHold: isCallMediaHoldActive(),
      });
    const sync = (realign: boolean) => {
      if (!wanted()) {
        pausePostMusic(owner);
        return;
      }
      if (!coordinator.isActive(owner)) void coordinator.start(owner, key, video.currentTime);
      else if (realign) coordinator.seek(owner, video.currentTime);
    };
    syncRef.current = sync;
    const onPlaying = () => {
      waiting = false;
      sync(true);
    };
    const onWaiting = () => {
      waiting = true;
      sync(false);
    };
    const onTime = () => {
      const now = video.currentTime;
      const jumped = videoJumpedBack(lastTime, now);
      lastTime = now;
      if (!coordinator.isActive(owner) || coordinator.getState().status !== "playing") return;
      const el = element;
      const loop = coordinator.loopSeconds();
      const drift = el ? loopDistance(el.currentTime, musicPosition(now, loop), loop) : 0;
      if (jumped || drift > MUSIC_REALIGN_SECONDS) coordinator.seek(owner, now);
    };
    const onPause = () => sync(false);
    const onSeeked = () => sync(true);
    const onVisibility = () => sync(true);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("play", onPlaying);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onPause);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("timeupdate", onTime);
    document.addEventListener("visibilitychange", onVisibility);
    const unsubscribeCall = subscribeCallMediaHold(() => sync(false));
    // Already playing when the music arrived (a picked track in the composer's preview).
    sync(true);
    return () => {
      syncRef.current = null;
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("play", onPlaying);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onPause);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("timeupdate", onTime);
      document.removeEventListener("visibilitychange", onVisibility);
      unsubscribeCall();
      stopPostMusic(owner);
    };
  }, [key, videoRef, elementKey]);
}
