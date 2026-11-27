/*
 * Post music playback: who is playing, and when it must stop. Pure (no DOM): src/lib/post-music-player.ts wires it to
 * the one shared <audio> element and the page's events; the tests drive it with a fake element.
 *
 * Rules (owner decisions for post music):
 * - One post plays at a time: starting a track for an owner (a card's chip, a video's music, the composer's preview)
 *   takes over from whoever had it, and the previous owner just sees "paused".
 * - Nothing starts during a call or while the page is hidden; a call starting, the page going to the background, a
 *   full-screen viewer opening over the page or another audible video / audio starting all interrupt it (paused, not
 *   resumed by themselves: a video's music follows its video, a chip waits for a tap).
 * - A start that is superseded (another owner, a pause, a stop) while its track was still being prepared never plays.
 * - On a video, the music follows the video: its position is the video's time modulo the track's loop.
 */

import type { PostMusicKey } from "@/lib/post-music";

export type MusicStatus = "idle" | "loading" | "playing" | "paused" | "error";

export type MusicState = { owner: symbol | null; key: PostMusicKey | null; status: MusicStatus };

/** The part of an HTMLAudioElement the coordinator uses. */
export type MusicElement = {
  src: string;
  currentTime: number;
  paused: boolean;
  play(): Promise<void>;
  pause(): void;
};

export type ResolvedTrack = { url: string; seconds: number };

/** Why playback was interrupted from outside (for the record; every reason pauses the same way). */
export type MusicInterruption = "hidden" | "call" | "viewer" | "other-media";

/** A video's music is out of step (circular distance, seconds) by more than this before it is moved back in line. */
export const MUSIC_REALIGN_SECONDS = 0.3;

/** The track position that goes with a video time: the track loops, the video may be longer or shorter. */
export function musicPosition(videoSeconds: number, loopSeconds: number): number {
  if (!(loopSeconds > 0) || !Number.isFinite(videoSeconds) || videoSeconds < 0) return 0;
  return videoSeconds % loopSeconds;
}

/** How far two positions in a loop are apart, the short way round. */
export function loopDistance(a: number, b: number, loopSeconds: number): number {
  if (!(loopSeconds > 0)) return Math.abs(a - b);
  const d = Math.abs(a - b) % loopSeconds;
  return Math.min(d, loopSeconds - d);
}

/** Whether a video's music should be sounding right now. */
export function videoMusicWanted(input: {
  videoPlaying: boolean;
  videoWaiting: boolean;
  muted: boolean;
  hidden: boolean;
  callHold: boolean;
}): boolean {
  return input.videoPlaying && !input.videoWaiting && !input.muted && !input.hidden && !input.callHold;
}

/** Whether a video jumped back to (near) its start: it looped, or the person sought back. */
export function videoJumpedBack(previousSeconds: number, nowSeconds: number): boolean {
  return nowSeconds + 0.5 < previousSeconds;
}

/**
 * Whether another media element starting to play takes the sound over (stops the music): an audible element that is
 * not the music's own and not live call / stream media (srcObject), which the call hold already covers.
 */
export function otherMediaTakesOver(el: { isMusicElement: boolean; muted: boolean; volume: number; live: boolean }): boolean {
  return !el.isMusicElement && !el.live && !el.muted && el.volume > 0;
}

export type MusicCoordinator = ReturnType<typeof createMusicCoordinator>;

export function createMusicCoordinator(deps: {
  element: () => MusicElement;
  resolve: (key: PostMusicKey) => Promise<ResolvedTrack>;
  /** A call holds the page's media, or the page is hidden: nothing may start. */
  blocked: () => boolean;
}) {
  let state: MusicState = { owner: null, key: null, status: "idle" };
  let seq = 0;
  let loadedKey: PostMusicKey | null = null;
  let loopSeconds = 0;
  const listeners = new Set<() => void>();

  function set(next: MusicState) {
    state = next;
    listeners.forEach((listener) => listener());
  }

  function place(el: MusicElement, at: number | undefined) {
    if (at === undefined) return;
    try {
      el.currentTime = musicPosition(at, loopSeconds);
    } catch {
      // Not seekable yet: it starts from the beginning, and the next realign moves it.
    }
  }

  return {
    getState: (): MusicState => state,

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    /** Seconds in the loaded track's loop (0 until one has been loaded). */
    loopSeconds: () => loopSeconds,

    /** Whether this owner's music is sounding (or about to). */
    isActive: (owner: symbol) => state.owner === owner && (state.status === "playing" || state.status === "loading"),

    /**
     * Plays `key` for `owner`, from `at` seconds of the owner's own clock (a video's time; omitted = from where the
     * track is, or its start for a new track). Resolves true once it is actually playing.
     */
    async start(owner: symbol, key: PostMusicKey, at?: number): Promise<boolean> {
      if (deps.blocked()) return false;
      const token = ++seq;
      const fresh = state.owner !== owner || state.key !== key;
      if (fresh && state.owner) deps.element().pause();
      set({ owner, key, status: "loading" });
      let track: ResolvedTrack;
      try {
        track = await deps.resolve(key);
      } catch {
        if (token === seq) set({ owner, key, status: "error" });
        return false;
      }
      if (token !== seq) return false;
      if (deps.blocked()) {
        set({ owner, key, status: "paused" });
        return false;
      }
      const el = deps.element();
      if (loadedKey !== key) {
        el.src = track.url;
        loadedKey = key;
        loopSeconds = track.seconds;
        place(el, at ?? 0);
      } else if (at !== undefined || fresh) {
        place(el, at ?? 0);
      }
      try {
        await el.play();
      } catch {
        // Refused (no user gesture yet) or interrupted: shown as paused, a tap tries again.
        if (token === seq) set({ owner, key, status: "paused" });
        return false;
      }
      if (token !== seq) return false;
      set({ owner, key, status: "playing" });
      return true;
    },

    /** Moves this owner's music to the position that goes with `at` (a video's time), if it is the one playing. */
    seek(owner: symbol, at: number) {
      if (state.owner !== owner || loadedKey !== state.key) return;
      place(deps.element(), at);
    },

    pause(owner: symbol) {
      if (state.owner !== owner) return;
      seq++;
      deps.element().pause();
      if (state.status !== "paused") set({ ...state, status: state.status === "error" ? "error" : "paused" });
    },

    /** Stops and lets go: `owner` only if it is the current one, everyone when omitted. */
    stop(owner?: symbol) {
      if (owner !== undefined && state.owner !== owner) return;
      seq++;
      if (state.owner) deps.element().pause();
      if (state.owner || state.status !== "idle") set({ owner: null, key: null, status: "idle" });
    },

    /** Something outside took the page (see MusicInterruption): pause whoever plays, without resuming later. */
    interrupt(reason: MusicInterruption) {
      void reason;
      if (!state.owner || (state.status !== "playing" && state.status !== "loading")) return;
      seq++;
      deps.element().pause();
      set({ ...state, status: "paused" });
    },

    /** The element stopped by itself (the OS took audio focus, the file ended, an error). */
    elementPaused() {
      if (state.status === "playing") set({ ...state, status: "paused" });
    },
  };
}
