"use client";

import type { GiftScoreHandle, playGiftScore } from "@/lib/gift-sound-engine";
import {
  GIFT_SOUND_ARM_WINDOW_MS,
  GIFT_SOUND_STOP_FADE_MS,
  giftSoundPlan,
  isArmFresh,
  mayStartGiftSound,
  type GiftSoundCueName,
} from "@/lib/gift-sound-plan";
import { readGiftSoundMuted, writeGiftSoundMuted } from "@/lib/gift-sound-pref";
import type { GiftTierName } from "@/lib/gifts-data";
import { isCallMediaHoldActive, subscribeCallMediaHold } from "@/lib/video-playback-guard";

// When a gift's sound may play, and stopping it. Small and loaded with the reveal; the synth itself
// (gift-sound-engine.ts) is a separate chunk imported only once a score is about to start.
//
// - Only from the person's own tap: the tap that opens a gift (or a marketplace preview), Replay, or Unmute calls
//   armGiftSound, which creates and resumes the AudioContext inside that gesture (what iOS and Chrome require). The
//   reveal then calls startGiftSound when it mounts; without a fresh arm (GIFT_SOUND_ARM_WINDOW_MS) nothing plays.
// - Never while muted (the per-device preference), during a call (the call media hold), or with the page hidden.
// - One score at a time, app-wide: a new one stops the previous one first, and a Replay starts after its fade-out.
// - Stops at once (a GIFT_SOUND_STOP_FADE_MS fade, then the context is closed and every timer cancelled) on
//   stopGiftSound (close, Escape, Back, unmount), a call starting, or the page being unloaded; a hidden page suspends the
//   audio clock and a visible one resumes it.
// - Never throws: without Web Audio, or if anything in it fails, the reveal simply stays silent.

export type GiftSoundRequest = {
  tier: GiftTierName;
  lowEnd: boolean;
  /** When the reveal shows the gift's name, in ms after it opened (the score's hit lands there). */
  hitMs: number;
  onCue?: (cue: GiftSoundCueName) => void;
  onEnded?: () => void;
};

type Engine = { playGiftScore: typeof playGiftScore };

/** Everything the controller needs from the browser, injectable so its rules are unit-tested with fakes. */
export type GiftSoundEnv = {
  createContext(): AudioContext | null;
  loadEngine(): Promise<Engine>;
  now(): number;
  isCallHeld(): boolean;
  subscribeCallHold(listener: () => void): () => void;
  isHidden(): boolean;
  subscribeVisibility(listener: () => void): () => void;
  subscribePageHide(listener: () => void): () => void;
  readMuted(): boolean;
  writeMuted(muted: boolean): void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
};

type Session = {
  ctx: AudioContext;
  handle: GiftScoreHandle | null;
  cancelled: boolean;
  cleanup: (() => void)[];
};

export type GiftSoundController = ReturnType<typeof createGiftSoundController>;

export function createGiftSoundController(env: GiftSoundEnv) {
  let armedAt: number | null = null;
  let armedCtx: AudioContext | null = null;
  let armTimer: unknown = null;
  let session: Session | null = null;
  let lastStopAt = Number.NEGATIVE_INFINITY;

  function closeContext(ctx: AudioContext) {
    try {
      ctx.close().catch(() => {});
    } catch {
      // Already closed.
    }
  }

  function disarm() {
    if (armTimer !== null) env.clearTimeout(armTimer);
    armTimer = null;
    armedAt = null;
    if (armedCtx) closeContext(armedCtx);
    armedCtx = null;
  }

  function stopSession(s: Session, fadeMs = GIFT_SOUND_STOP_FADE_MS) {
    if (s.cancelled) return;
    s.cancelled = true;
    s.cleanup.splice(0).forEach((off) => off());
    if (session === s) session = null;
    lastStopAt = env.now();
    try {
      if (s.handle) s.handle.stop(fadeMs);
      else closeContext(s.ctx);
    } catch {
      closeContext(s.ctx);
    }
  }

  return {
    /** From the person's tap (open, preview, Replay, Unmute): may a reveal starting soon play sound. */
    arm() {
      try {
        disarm();
        armedAt = env.now();
        // Muted: remember the tap, but no audio is created until an Unmute tap.
        if (env.readMuted()) return;
        const ctx = env.createContext();
        if (!ctx) return;
        ctx.resume().catch(() => {});
        armedCtx = ctx;
        armTimer = env.setTimeout(disarm, GIFT_SOUND_ARM_WINDOW_MS);
        // Warm the synth chunk while the gift is being opened.
        env.loadEngine().catch(() => {});
      } catch {
        disarm();
      }
    },

    /** Starts the score if the gate allows (see mayStartGiftSound). Returns whether it is starting. */
    start(req: GiftSoundRequest): boolean {
      try {
        const gate = {
          armed: isArmFresh(armedAt, env.now()),
          muted: env.readMuted(),
          callActive: env.isCallHeld(),
          documentHidden: env.isHidden(),
          audioAvailable: armedCtx !== null,
        };
        const ctx = armedCtx;
        if (!mayStartGiftSound(gate) || !ctx) {
          disarm();
          return false;
        }
        armedCtx = null;
        disarm();
        if (session) stopSession(session);
        const startedAt = env.now();
        // A score stopped just now is still fading out: start after it, so the two never overlap.
        const sinceStop = startedAt - lastStopAt;
        const startDelayS = sinceStop < GIFT_SOUND_STOP_FADE_MS + 30 ? (GIFT_SOUND_STOP_FADE_MS + 30 - sinceStop) / 1000 + 0.03 : 0.03;
        const s: Session = { ctx, handle: null, cancelled: false, cleanup: [] };
        session = s;
        s.cleanup.push(
          env.subscribeCallHold(() => {
            if (env.isCallHeld()) stopSession(s);
          }),
          env.subscribePageHide(() => stopSession(s)),
          env.subscribeVisibility(() => {
            if (!s.handle) return;
            if (env.isHidden()) s.handle.suspend();
            else s.handle.resume();
          }),
        );
        env.loadEngine().then(
          (engine) => {
            if (s.cancelled) return;
            if (env.isCallHeld() || env.readMuted()) {
              stopSession(s);
              return;
            }
            try {
              // The reveal has been running while the synth loaded: keep the hit on the name.
              const hitMs = Math.max(0, req.hitMs - (env.now() - startedAt));
              const plan = giftSoundPlan(req.tier, { lowEnd: req.lowEnd, hitMs });
              s.handle = engine.playGiftScore(ctx, plan, {
                startDelayS,
                onCue: req.onCue,
                onEnded: () => {
                  s.cancelled = true;
                  s.cleanup.splice(0).forEach((off) => off());
                  if (session === s) session = null;
                  req.onEnded?.();
                },
              });
              if (env.isHidden()) s.handle.suspend();
            } catch {
              stopSession(s);
            }
          },
          () => stopSession(s),
        );
        return true;
      } catch {
        return false;
      }
    },

    /** Stops whatever is playing at once (and forgets an unused tap). */
    stop() {
      try {
        if (session) stopSession(session);
        disarm();
      } catch {
        // Nothing left to stop.
      }
    },

    /** Mute / unmute from the reveal's control: remembered on this device; fades the score out or back in. */
    setMuted(next: boolean) {
      try {
        env.writeMuted(next);
        const handle = session?.handle;
        if (!handle) {
          if (next && session) stopSession(session);
          return;
        }
        if (next) handle.mute();
        else handle.unmute();
      } catch {
        // The preference is what matters; the score is best effort.
      }
    },

    /** A score is starting or sounding (muted counts as not playing). */
    isPlaying(): boolean {
      return session !== null && !session.cancelled && (session.handle === null || session.handle.state === "playing");
    },

    /** A score exists in this reveal (playing, muted or loading). */
    hasSession(): boolean {
      return session !== null;
    },
  };
}

function browserEnv(): GiftSoundEnv {
  return {
    createContext() {
      if (typeof window === "undefined") return null;
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      try {
        // "playback": a larger buffer, kinder to the battery; nothing here needs low latency.
        return new Ctor({ latencyHint: "playback" });
      } catch {
        try {
          return new Ctor();
        } catch {
          return null;
        }
      }
    },
    loadEngine: () => import("@/lib/gift-sound-engine"),
    now: () => Date.now(),
    isCallHeld: isCallMediaHoldActive,
    subscribeCallHold: subscribeCallMediaHold,
    isHidden: () => document.visibilityState === "hidden",
    subscribeVisibility(listener) {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
    subscribePageHide(listener) {
      window.addEventListener("pagehide", listener);
      return () => window.removeEventListener("pagehide", listener);
    },
    readMuted: readGiftSoundMuted,
    writeMuted: writeGiftSoundMuted,
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (id) => window.clearTimeout(id as number),
  };
}

let controller: GiftSoundController | null = null;
function shared(): GiftSoundController {
  controller ??= createGiftSoundController(browserEnv());
  return controller;
}

/** Call synchronously from the tap that opens a gift or a preview (and from Replay / Unmute). */
export function armGiftSound(): void {
  if (typeof window !== "undefined") shared().arm();
}
export function startGiftSound(req: GiftSoundRequest): boolean {
  return typeof window !== "undefined" && shared().start(req);
}
export function stopGiftSound(): void {
  if (controller) controller.stop();
}
export function setGiftSoundMuted(muted: boolean): void {
  if (typeof window !== "undefined") shared().setMuted(muted);
}
/** True while a gift's score is sounding: other app sounds (the like heartbeat) stay quiet meanwhile. */
export function isGiftSoundPlaying(): boolean {
  return controller !== null && controller.isPlaying();
}
export function hasGiftSoundSession(): boolean {
  return controller !== null && controller.hasSession();
}

/** iPhone / iPad (Safari or the app): Web Audio follows the ring/silent switch there, so the reveal says so once. */
export function isSilentSwitchPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}
