import { describe, expect, it, vi } from "vitest";
import {
  createMusicCoordinator,
  loopDistance,
  musicPosition,
  otherMediaTakesOver,
  videoJumpedBack,
  videoMusicWanted,
  type MusicElement,
} from "@/lib/post-music-playback";
import type { PostMusicKey } from "@/lib/post-music";

// Post music playback coordination, driven with a fake <audio> element: one post at a time, nothing while blocked
// (call / hidden page), interruptions that don't resume by themselves, superseded starts that never play, and a
// video's music following the video's clock.

function fakeElement() {
  const el: MusicElement & { plays: number; pauses: number; rejectNext: boolean } = {
    src: "",
    currentTime: 0,
    paused: true,
    plays: 0,
    pauses: 0,
    rejectNext: false,
    play() {
      el.plays++;
      if (el.rejectNext) {
        el.rejectNext = false;
        return Promise.reject(new DOMException("blocked", "NotAllowedError"));
      }
      el.paused = false;
      return Promise.resolve();
    },
    pause() {
      el.pauses++;
      el.paused = true;
    },
  };
  return el;
}

function setup(opts: { blocked?: () => boolean; resolve?: (key: PostMusicKey) => Promise<{ url: string; seconds: number }> } = {}) {
  const el = fakeElement();
  const resolve = vi.fn(opts.resolve ?? (async (key: PostMusicKey) => ({ url: `blob:${key}`, seconds: 20 })));
  const coordinator = createMusicCoordinator({ element: () => el, resolve, blocked: opts.blocked ?? (() => false) });
  return { el, coordinator, resolve };
}

describe("music coordinator", () => {
  it("plays a track for its owner", async () => {
    const { el, coordinator } = setup();
    const chip = Symbol("chip");
    expect(await coordinator.start(chip, "sunrise")).toBe(true);
    expect(el.src).toBe("blob:sunrise");
    expect(el.paused).toBe(false);
    expect(coordinator.getState()).toEqual({ owner: chip, key: "sunrise", status: "playing" });
  });

  it("plays one post at a time: a second owner takes over", async () => {
    const { el, coordinator } = setup();
    const first = Symbol("first");
    const second = Symbol("second");
    await coordinator.start(first, "sunrise");
    await coordinator.start(second, "groove");
    expect(coordinator.getState()).toEqual({ owner: second, key: "groove", status: "playing" });
    expect(el.src).toBe("blob:groove");
    expect(coordinator.isActive(first)).toBe(false);
    // The old owner's pause no longer touches the new owner's music.
    coordinator.pause(first);
    expect(coordinator.getState().status).toBe("playing");
  });

  it("never plays a start that was superseded while its track was still being prepared", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { el, coordinator } = setup({
      resolve: async (key) => {
        if (key === "daydream") await gate;
        return { url: `blob:${key}`, seconds: 14 };
      },
    });
    const slow = Symbol("slow");
    const pending = coordinator.start(slow, "daydream");
    coordinator.pause(slow);
    release();
    expect(await pending).toBe(false);
    expect(el.plays).toBe(0);
    expect(coordinator.getState().status).toBe("paused");
  });

  it("starts nothing while a call holds the page or the page is hidden", async () => {
    let blocked = true;
    const { el, coordinator, resolve } = setup({ blocked: () => blocked });
    expect(await coordinator.start(Symbol("chip"), "focus")).toBe(false);
    expect(resolve).not.toHaveBeenCalled();
    expect(el.plays).toBe(0);
    blocked = false;
    expect(await coordinator.start(Symbol("chip"), "focus")).toBe(true);
  });

  it("a call / viewer / hidden page / other sound interrupts it, and it doesn't resume by itself", async () => {
    for (const reason of ["call", "viewer", "hidden", "other-media"] as const) {
      const { el, coordinator } = setup();
      const owner = Symbol(reason);
      await coordinator.start(owner, "tender");
      coordinator.interrupt(reason);
      expect(el.paused).toBe(true);
      expect(coordinator.getState()).toEqual({ owner, key: "tender", status: "paused" });
      expect(el.plays).toBe(1);
    }
  });

  it("a refused play (no user gesture yet) shows paused, and a tap can try again", async () => {
    const { el, coordinator } = setup();
    const chip = Symbol("chip");
    el.rejectNext = true;
    expect(await coordinator.start(chip, "island")).toBe(false);
    expect(coordinator.getState().status).toBe("paused");
    expect(await coordinator.start(chip, "island")).toBe(true);
  });

  it("stop lets go of everything; stop(owner) only of that owner", async () => {
    const { coordinator } = setup();
    const a = Symbol("a");
    await coordinator.start(a, "breeze");
    coordinator.stop(Symbol("someone else"));
    expect(coordinator.getState().owner).toBe(a);
    coordinator.stop(a);
    expect(coordinator.getState()).toEqual({ owner: null, key: null, status: "idle" });
  });

  it("follows a video's clock: the position is the video time modulo the track loop", async () => {
    const { el, coordinator } = setup({ resolve: async (key) => ({ url: `blob:${key}`, seconds: 20 }) });
    const video = Symbol("video");
    await coordinator.start(video, "celebrate", 47.5);
    expect(el.currentTime).toBeCloseTo(7.5);
    coordinator.seek(video, 3);
    expect(el.currentTime).toBeCloseTo(3);
    // Someone else's seek is ignored.
    coordinator.seek(Symbol("other"), 10);
    expect(el.currentTime).toBeCloseTo(3);
  });

  it("a chip resumes where it paused; a new owner of the same track starts from the beginning", async () => {
    const { el, coordinator, resolve } = setup();
    const chip = Symbol("chip");
    await coordinator.start(chip, "lateNight");
    el.currentTime = 9;
    coordinator.pause(chip);
    await coordinator.start(chip, "lateNight");
    expect(el.currentTime).toBe(9);
    await coordinator.start(Symbol("another card"), "lateNight");
    expect(el.currentTime).toBe(0);
    expect(resolve).toHaveBeenCalledTimes(3);
  });

  it("notifies subscribers of every change", async () => {
    const { coordinator } = setup();
    const seen: string[] = [];
    const unsubscribe = coordinator.subscribe(() => seen.push(coordinator.getState().status));
    const owner = Symbol("o");
    await coordinator.start(owner, "adventure");
    coordinator.pause(owner);
    unsubscribe();
    coordinator.stop();
    expect(seen).toEqual(["loading", "playing", "paused"]);
  });
});

describe("music playback rules", () => {
  it("wants a video's music only while it plays, with sound on, visible and with no call", () => {
    const on = { videoPlaying: true, videoWaiting: false, muted: false, hidden: false, callHold: false };
    expect(videoMusicWanted(on)).toBe(true);
    expect(videoMusicWanted({ ...on, videoPlaying: false })).toBe(false);
    expect(videoMusicWanted({ ...on, videoWaiting: true })).toBe(false);
    expect(videoMusicWanted({ ...on, muted: true })).toBe(false);
    expect(videoMusicWanted({ ...on, hidden: true })).toBe(false);
    expect(videoMusicWanted({ ...on, callHold: true })).toBe(false);
  });

  it("maps video time onto the loop and measures drift the short way round", () => {
    expect(musicPosition(0, 20)).toBe(0);
    expect(musicPosition(25, 20)).toBe(5);
    expect(musicPosition(Number.NaN, 20)).toBe(0);
    expect(musicPosition(12, 0)).toBe(0);
    expect(loopDistance(19.9, 0.1, 20)).toBeCloseTo(0.2);
    expect(loopDistance(5, 7, 20)).toBeCloseTo(2);
  });

  it("notices a video looping or being sought back", () => {
    expect(videoJumpedBack(14.8, 0.1)).toBe(true);
    expect(videoJumpedBack(3, 3.25)).toBe(false);
    expect(videoJumpedBack(3, 2.8)).toBe(false);
  });

  it("only audible, file-backed media of someone else takes the sound over", () => {
    const audible = { isMusicElement: false, muted: false, volume: 1, live: false };
    expect(otherMediaTakesOver(audible)).toBe(true);
    expect(otherMediaTakesOver({ ...audible, muted: true })).toBe(false);
    expect(otherMediaTakesOver({ ...audible, volume: 0 })).toBe(false);
    expect(otherMediaTakesOver({ ...audible, live: true })).toBe(false);
    expect(otherMediaTakesOver({ ...audible, isMusicElement: true })).toBe(false);
  });
});
