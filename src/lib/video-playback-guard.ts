"use client";

import { suspendAutoplayOnView } from "@/lib/use-autoplay-on-view";

// The app's one registry for holding media still: every <video> AND <audio> on the page (feed posts, comments, chat
// voice/video messages, the lightbox, live replays, any custom player) plus the embedded third-party players. It works
// against the DOM directly rather than each surface's own React state, so it applies to every current and future
// media element with no per-component wiring, and it records exactly which elements IT paused, so that only those are
// played again afterwards (never something the person had paused themselves, nor something that wasn't playing).
//
// Two kinds of hold, each reference-counted (overlapping holds are normal: a call rings then connects, and both the
// ringing listener and the call session hold; a viewer can open over another):
//
// - The PAGE hold (holdPageMedia / releasePageMedia): a full-screen viewer (Story viewer, Lightbox, view-once viewer)
//   covers the page. Whatever was playing behind it pauses; it plays again when the last viewer closes.
// - The CALL hold (beginCallMediaHold / endCallMediaHold): a call is ringing (incoming, 1:1 or group) or under way
//   (either side). Everything playing pauses, and for as long as any call holds, nothing may START on its own: a play
//   that is not the person's own tap is paused again on the spot and remembered (see installMediaGuard). When the last
//   call hold ends (answered call hung up, declined, missed, cancelled), everything it paused or stopped from starting
//   plays again, if it is still on the page, still paused and not finished.
//
// The two lists hand over between each other so nothing behind a viewer starts while the viewer is still open and
// nothing a call paused is forgotten: a viewer opening during a call takes over what the call had paused (it was
// playing before the viewer opened), and a viewer closing during a call gives its list to the call (it plays when the
// call ends).
//
// Not held here:
// - Live media: any element whose `srcObject` is a MediaStream (the call's own remote audio/video and self-view, a live
//   stream's grid, the camera preview of a recorder). Holding those would silence the call itself.
// - Players that hold THEMSELVES during a call (SELF_HELD_MEDIA_ATTR="self": the Story viewer and the Muse feed). They
//   read useCallMediaHold and keep their own play/pause state consistent (a "paused" flag, an auto-resume watchdog);
//   pausing them from outside would fight that.
// - Embedded third-party players (YouTube, TikTok, Instagram, Vimeo... in a cross-origin iframe) can't be paused or
//   resumed from here: there is no reliable control API for a bare embed. The ones marked data-video-embed-pause are
//   silenced the only way that always works, by blanking their src while any hold is on, and reloaded from their start
//   afterwards; any other iframe is left alone (and never the call's own Daily iframe).

const MEDIA_SELECTOR = "video, audio";
const EMBED_SELECTOR = "iframe[data-video-embed-pause]";

/** Set to "self" on a <video>/<audio> whose player holds itself during a call (it reads useCallMediaHold). */
export const SELF_HELD_MEDIA_ATTR = "data-media-hold";

/**
 * How recent the person's own tap/click/key must be for a play during a call to count as theirs (and be allowed).
 * Short on purpose: a tap grants the page "user activation" for several seconds, which would also let an autoplay
 * that happens to start right after (a Muse swiped to, a feed video) through.
 */
export const USER_GESTURE_WINDOW_MS = 1000;
/** A pointer that moved further than this between down and up was a scroll or a swipe, not a tap. */
export const TAP_MAX_MOVE_PX = 10;

/** Whether a play that starts while a call holds the page's media is stopped (it is not the person's own doing). */
export function shouldBlockPlayDuringCall(input: { callHeld: boolean; msSinceGesture: number }): boolean {
  return input.callHeld && !(input.msSinceGesture >= 0 && input.msSinceGesture <= USER_GESTURE_WINDOW_MS);
}

/** Whether a pointer that went down at `down` and up at `up` was a tap (and so the person's own gesture). */
export function isTapGesture(down: { x: number; y: number }, up: { x: number; y: number }): boolean {
  return Math.hypot(up.x - down.x, up.y - down.y) <= TAP_MAX_MOVE_PX;
}

/** Whether something a hold paused should be played again when the hold ends. */
export function shouldResumeHeldMedia(el: { isConnected: boolean; paused: boolean; ended: boolean }): boolean {
  return el.isConnected && el.paused && !el.ended;
}

function isHoldable(el: unknown): el is HTMLMediaElement {
  if (typeof HTMLMediaElement === "undefined" || !(el instanceof HTMLMediaElement)) return false;
  if (el.srcObject) return false;
  return el.getAttribute(SELF_HELD_MEDIA_ATTR) !== "self";
}

function playingMedia(): HTMLMediaElement[] {
  return Array.from(document.querySelectorAll(MEDIA_SELECTOR)).filter(
    (el): el is HTMLMediaElement => isHoldable(el) && !el.paused && !el.ended,
  );
}

function resume(list: HTMLMediaElement[]) {
  for (const el of list) {
    // Best effort: a post scrolled away or a sheet closed meanwhile simply no longer plays (play() rejects or no-ops).
    if (shouldResumeHeldMedia(el)) el.play().catch(() => {});
  }
}

function addUnique(list: HTMLMediaElement[], el: HTMLMediaElement) {
  if (!list.includes(el)) list.push(el);
}

// --- Embedded third-party players ---------------------------------------------------------------------------------

let embedHoldCount = 0;
let frozenEmbeds: { el: HTMLIFrameElement; src: string }[] = [];

function freezeEmbeds() {
  if (embedHoldCount === 0) {
    frozenEmbeds = Array.from(document.querySelectorAll<HTMLIFrameElement>(EMBED_SELECTOR))
      .filter((el) => el.src && el.src !== "about:blank")
      .map((el) => ({ el, src: el.src }));
    frozenEmbeds.forEach(({ el }) => {
      el.src = "about:blank";
    });
  }
  embedHoldCount++;
}

function unfreezeEmbeds() {
  if (embedHoldCount === 0) return;
  embedHoldCount--;
  if (embedHoldCount > 0) return;
  const toUnfreeze = frozenEmbeds;
  frozenEmbeds = [];
  toUnfreeze.forEach(({ el, src }) => {
    if (el.isConnected) el.src = src;
  });
}

// --- Page hold (a full-screen viewer over the page) ----------------------------------------------------------------

let pageHoldCount = 0;
let pageHeld: HTMLMediaElement[] = [];

/** A full-screen viewer opens over the page: what plays behind it pauses until the matching releasePageMedia. */
export function holdPageMedia() {
  if (pageHoldCount === 0) {
    const playing = playingMedia();
    playing.forEach((el) => el.pause());
    // What a call is already holding was playing before this viewer opened: it now waits for the viewer to close.
    pageHeld = [...playing, ...callHeld.splice(0)];
  }
  pageHoldCount++;
  freezeEmbeds();
}

/** The matching end of holdPageMedia: once the last viewer closes, what it paused plays again (after any call). */
export function releasePageMedia() {
  if (pageHoldCount === 0) return;
  pageHoldCount--;
  unfreezeEmbeds();
  if (pageHoldCount > 0) return;
  const held = pageHeld;
  pageHeld = [];
  if (callHoldCount > 0) {
    // A call is still on: these wait for it to end.
    held.forEach((el) => addUnique(callHeld, el));
    return;
  }
  resume(held);
}

// --- Call hold (a call ringing or under way) -----------------------------------------------------------------------

let callHoldCount = 0;
let callHeld: HTMLMediaElement[] = [];
let releaseCallAutoplay: (() => void) | null = null;
const callHoldListeners = new Set<() => void>();

function notifyCallHold() {
  callHoldListeners.forEach((listener) => listener());
}

/**
 * A call starts ringing, or its session begins (caller and callee, 1:1 and group): everything playing pauses, feed
 * autoplay is suspended, players that hold themselves are told to, and nothing starts on its own until the last
 * matching endCallMediaHold.
 */
export function beginCallMediaHold() {
  installMediaGuard();
  callHoldCount++;
  // Self-held players first, so they already want to be paused when anything else reacts.
  notifyCallHold();
  if (callHoldCount === 1) {
    releaseCallAutoplay = suspendAutoplayOnView();
    for (const el of playingMedia()) {
      el.pause();
      addUnique(callHeld, el);
    }
  }
  freezeEmbeds();
}

/** The matching end of beginCallMediaHold: once the last one ends, what the call paused (or kept from starting) plays. */
export function endCallMediaHold() {
  if (callHoldCount === 0) return;
  callHoldCount--;
  notifyCallHold();
  unfreezeEmbeds();
  if (callHoldCount > 0) return;
  releaseCallAutoplay?.();
  releaseCallAutoplay = null;
  const held = callHeld;
  callHeld = [];
  resume(held);
}

export function isCallMediaHoldActive(): boolean {
  return callHoldCount > 0;
}

export function subscribeCallMediaHold(listener: () => void): () => void {
  callHoldListeners.add(listener);
  return () => {
    callHoldListeners.delete(listener);
  };
}

// --- Document listeners: the call's play guard and the one-video-at-a-time rule ------------------------------------

let guardInstalled = false;
let lastGestureAt = Number.NEGATIVE_INFINITY;
let pointerDown: { id: number; x: number; y: number } | null = null;

function onPlay(e: Event) {
  const started = e.target;
  if (isHoldable(started) && callHoldCount > 0) {
    if (shouldBlockPlayDuringCall({ callHeld: true, msSinceGesture: Date.now() - lastGestureAt })) {
      // Something started on its own during a call (an autoplay, a player re-trying): hold it with the rest.
      started.pause();
      addUnique(callHeld, started);
      return;
    }
    // The person started it themselves: it is theirs now, and is not resumed (or paused) by the call ending.
    callHeld = callHeld.filter((el) => el !== started);
  }
  // Only one video plays at a time (see installMediaGuard). Live media (srcObject) is exempt both ways.
  if (typeof HTMLVideoElement === "undefined" || !(started instanceof HTMLVideoElement) || started.srcObject) return;
  document.querySelectorAll("video").forEach((v) => {
    if (v !== started && !v.paused && !v.srcObject) v.pause();
  });
}

/**
 * Installs the document-level listeners, once (safe to call from anywhere, any number of times):
 *
 * - The call's play guard (onPlay above): while a call holds the page, a play that is not the person's own tap,
 *   click or key press is paused again on the spot and added to what the call resumes. `play` doesn't bubble, so the
 *   listener is registered with `capture: true` to see it via delegation. Taps are told from swipes by how far the
 *   pointer moved, because a swipe to the next Muse or a scroll of the feed is not "pressing play".
 * - The app-wide "only one video plays at a time" rule: whenever any file-backed <video> starts, every other one
 *   that is playing pauses. Confirmed live: a feed video kept playing under a Muse, a story or a chat video opened
 *   elsewhere. Live media (`srcObject`: a call's remote video and self-view, a live stream's grid, a recorder's camera
 *   preview) is exempt, or a call's two <video> elements would pause each other.
 */
export function installMediaGuard() {
  if (guardInstalled || typeof document === "undefined") return;
  guardInstalled = true;

  const markGesture = () => {
    lastGestureAt = Date.now();
  };
  document.addEventListener("play", onPlay, { capture: true });
  document.addEventListener("click", markGesture, { capture: true });
  document.addEventListener(
    "keydown",
    (e) => {
      const key = (e as KeyboardEvent).key;
      if (key === "Enter" || key === " " || key === "MediaPlayPause" || key === "MediaPlay" || key === "k") markGesture();
    },
    { capture: true },
  );
  document.addEventListener(
    "pointerdown",
    (e) => {
      const p = e as PointerEvent;
      pointerDown = { id: p.pointerId, x: p.clientX, y: p.clientY };
    },
    { capture: true, passive: true },
  );
  document.addEventListener(
    "pointerup",
    (e) => {
      const p = e as PointerEvent;
      if (pointerDown && pointerDown.id === p.pointerId && isTapGesture(pointerDown, { x: p.clientX, y: p.clientY })) {
        markGesture();
      }
      pointerDown = null;
    },
    { capture: true, passive: true },
  );
}
