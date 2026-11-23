import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TAP_MAX_MOVE_PX,
  USER_GESTURE_WINDOW_MS,
  isTapGesture,
  shouldBlockPlayDuringCall,
  shouldResumeHeldMedia,
} from "@/lib/video-playback-guard";

vi.mock("@/lib/use-autoplay-on-view", () => {
  const state = { suspended: 0 };
  return {
    __state: state,
    suspendAutoplayOnView: () => {
      state.suspended++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        state.suspended--;
      };
    },
  };
});

describe("pure rules", () => {
  it("blocks a play during a call unless the person just tapped", () => {
    expect(shouldBlockPlayDuringCall({ callHeld: false, msSinceGesture: Infinity })).toBe(false);
    expect(shouldBlockPlayDuringCall({ callHeld: true, msSinceGesture: Infinity })).toBe(true);
    expect(shouldBlockPlayDuringCall({ callHeld: true, msSinceGesture: 0 })).toBe(false);
    expect(shouldBlockPlayDuringCall({ callHeld: true, msSinceGesture: USER_GESTURE_WINDOW_MS })).toBe(false);
    expect(shouldBlockPlayDuringCall({ callHeld: true, msSinceGesture: USER_GESTURE_WINDOW_MS + 1 })).toBe(true);
    // A clock that went backwards is not a fresh gesture.
    expect(shouldBlockPlayDuringCall({ callHeld: true, msSinceGesture: -5 })).toBe(true);
  });

  it("tells a tap from a swipe", () => {
    expect(isTapGesture({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(true);
    expect(isTapGesture({ x: 0, y: 0 }, { x: 0, y: TAP_MAX_MOVE_PX + 1 })).toBe(false);
  });

  it("resumes only what is still on the page, still paused and not finished", () => {
    expect(shouldResumeHeldMedia({ isConnected: true, paused: true, ended: false })).toBe(true);
    expect(shouldResumeHeldMedia({ isConnected: false, paused: true, ended: false })).toBe(false);
    expect(shouldResumeHeldMedia({ isConnected: true, paused: false, ended: false })).toBe(false);
    expect(shouldResumeHeldMedia({ isConnected: true, paused: true, ended: true })).toBe(false);
  });
});

// The real module against a minimal fake DOM: media events are queued tasks, as in a browser.
describe("the hold registry", () => {
  type Listener = (e: Record<string, unknown>) => void;
  let queue: (() => void)[];
  let elements: FakeMedia[];
  let iframes: { src: string; isConnected: boolean }[];
  let listeners: Map<string, Listener[]>;

  class FakeMedia {
    paused = true;
    ended = false;
    isConnected = true;
    srcObject: unknown = null;
    attrs: Record<string, string> = {};
    playCalls = 0;
    getAttribute(name: string) {
      return this.attrs[name] ?? null;
    }
    play() {
      this.playCalls++;
      this.paused = false;
      queue.push(() => dispatch("play", { target: this }));
      return Promise.resolve();
    }
    pause() {
      this.paused = true;
    }
  }
  class FakeVideo extends FakeMedia {}
  class FakeAudio extends FakeMedia {}

  function dispatch(type: string, event: Record<string, unknown>) {
    (listeners.get(type) ?? []).forEach((l) => l(event));
  }
  const flush = () => {
    while (queue.length) queue.shift()!();
  };
  function playing<T extends FakeMedia>(el: T): T {
    elements.push(el);
    el.play();
    flush();
    return el;
  }
  function tap() {
    dispatch("pointerdown", { pointerId: 1, clientX: 10, clientY: 10 });
    dispatch("pointerup", { pointerId: 1, clientX: 12, clientY: 11 });
  }
  function swipe() {
    dispatch("pointerdown", { pointerId: 1, clientX: 10, clientY: 300 });
    dispatch("pointerup", { pointerId: 1, clientX: 10, clientY: 40 });
  }

  beforeEach(() => {
    vi.resetModules();
    queue = [];
    elements = [];
    iframes = [];
    listeners = new Map();
    vi.stubGlobal("HTMLMediaElement", FakeMedia);
    vi.stubGlobal("HTMLVideoElement", FakeVideo);
    vi.stubGlobal("document", {
      querySelectorAll: (sel: string) => {
        if (sel === "video, audio") return elements.filter((el) => el.isConnected);
        if (sel === "video") return elements.filter((el) => el instanceof FakeVideo && el.isConnected);
        if (sel === "iframe[data-video-embed-pause]") return iframes;
        return [];
      },
      addEventListener: (type: string, l: Listener) => {
        listeners.set(type, [...(listeners.get(type) ?? []), l]);
      },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function load() {
    const guard = await import("@/lib/video-playback-guard");
    guard.installMediaGuard();
    const autoplay = (await import("@/lib/use-autoplay-on-view")) as unknown as { __state: { suspended: number } };
    return { guard, autoplay: autoplay.__state };
  }

  it("pauses every playing video and audio on a call, and resumes exactly those when it ends", async () => {
    const { guard } = await load();
    const feed = playing(new FakeVideo());
    const voiceNote = playing(new FakeAudio());
    const pausedByUser = new FakeVideo();
    elements.push(pausedByUser);
    const callAudio = playing(new FakeAudio());
    callAudio.srcObject = {}; // the call's own (live) audio is never held
    const museTrack = new FakeAudio();
    museTrack.attrs["data-media-hold"] = "self"; // holds itself
    playing(museTrack);

    guard.beginCallMediaHold();
    expect(feed.paused).toBe(true);
    expect(voiceNote.paused).toBe(true);
    expect(callAudio.paused).toBe(false);
    expect(museTrack.paused).toBe(false);
    expect(guard.isCallMediaHoldActive()).toBe(true);

    guard.endCallMediaHold();
    expect(guard.isCallMediaHoldActive()).toBe(false);
    expect(feed.paused).toBe(false);
    expect(voiceNote.paused).toBe(false);
    expect(pausedByUser.paused).toBe(true);
    expect(pausedByUser.playCalls).toBe(0);
  });

  it("counts overlapping holds: ringing then the session, resumed only after the last", async () => {
    const { guard } = await load();
    const feed = playing(new FakeVideo());
    guard.beginCallMediaHold(); // ringing
    guard.beginCallMediaHold(); // answered: the session
    guard.endCallMediaHold(); // ringing stops
    expect(feed.paused).toBe(true);
    guard.endCallMediaHold(); // hung up
    expect(feed.paused).toBe(false);
    // A stray extra end does nothing.
    guard.endCallMediaHold();
    expect(guard.isCallMediaHoldActive()).toBe(false);
  });

  it("keeps autoplay from starting during a call, and plays it once the call ends", async () => {
    const { guard, autoplay } = await load();
    guard.beginCallMediaHold();
    expect(autoplay.suspended).toBe(1);
    const muse = new FakeVideo();
    elements.push(muse);
    swipe(); // a swipe is not pressing play
    muse.play();
    flush();
    expect(muse.paused).toBe(true);
    guard.endCallMediaHold();
    expect(autoplay.suspended).toBe(0);
    expect(muse.paused).toBe(false);
  });

  it("lets the person play something themselves during a call, and leaves it to them afterwards", async () => {
    const { guard } = await load();
    const voiceNote = playing(new FakeAudio());
    guard.beginCallMediaHold();
    expect(voiceNote.paused).toBe(true);
    tap();
    voiceNote.play();
    flush();
    expect(voiceNote.paused).toBe(false);
    voiceNote.pause(); // and pauses it again
    guard.endCallMediaHold();
    expect(voiceNote.paused).toBe(true);
  });

  it("does not let an old tap count as pressing play", async () => {
    const { guard } = await load();
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    tap();
    guard.beginCallMediaHold();
    now.mockReturnValue(1_000_000 + USER_GESTURE_WINDOW_MS + 1);
    const feed = new FakeVideo();
    elements.push(feed);
    feed.play();
    flush();
    expect(feed.paused).toBe(true);
    guard.endCallMediaHold();
  });

  it("does not resume what left the page or finished during the call", async () => {
    const { guard } = await load();
    const gone = playing(new FakeVideo());
    const finished = playing(new FakeAudio());
    guard.beginCallMediaHold();
    gone.isConnected = false;
    finished.ended = true;
    guard.endCallMediaHold();
    expect(gone.playCalls).toBe(1);
    expect(finished.playCalls).toBe(1);
  });

  it("a viewer opened during a call keeps what the call paused until the viewer closes", async () => {
    const { guard } = await load();
    const feed = playing(new FakeVideo());
    guard.beginCallMediaHold();
    guard.holdPageMedia(); // a Lightbox opens mid-call
    guard.endCallMediaHold();
    expect(feed.paused).toBe(true); // still behind the Lightbox
    guard.releasePageMedia();
    expect(feed.paused).toBe(false);
  });

  it("a call during a viewer holds the viewer's own media, and the page's waits for the viewer", async () => {
    const { guard } = await load();
    const feed = playing(new FakeVideo());
    guard.holdPageMedia(); // a Lightbox opens
    expect(feed.paused).toBe(true);
    const lightboxVideo = playing(new FakeVideo());
    guard.beginCallMediaHold();
    expect(lightboxVideo.paused).toBe(true);
    guard.releasePageMedia(); // the Lightbox closes mid-call: nothing plays yet
    expect(feed.paused).toBe(true);
    lightboxVideo.isConnected = false;
    guard.endCallMediaHold();
    expect(feed.paused).toBe(false);
    expect(lightboxVideo.playCalls).toBe(1);
  });

  it("silences embedded players while any hold is on and reloads them once, at the end", async () => {
    const { guard } = await load();
    const embed = { src: "https://www.youtube.com/embed/x", isConnected: true };
    iframes.push(embed);
    guard.beginCallMediaHold();
    guard.holdPageMedia();
    expect(embed.src).toBe("about:blank");
    guard.endCallMediaHold();
    expect(embed.src).toBe("about:blank");
    guard.releasePageMedia();
    expect(embed.src).toBe("https://www.youtube.com/embed/x");
  });

  it("tells players that hold themselves when a call starts and ends", async () => {
    const { guard } = await load();
    const listener = vi.fn();
    const unsubscribe = guard.subscribeCallMediaHold(listener);
    guard.beginCallMediaHold();
    expect(listener).toHaveBeenCalledTimes(1);
    guard.endCallMediaHold();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("still plays one video at a time outside calls", async () => {
    await load();
    const a = playing(new FakeVideo());
    const b = playing(new FakeVideo());
    expect(a.paused).toBe(true);
    expect(b.paused).toBe(false);
  });
});

describe("wiring", () => {
  const read = (...p: string[]) => readFileSync(join(__dirname, "..", ...p), "utf8");

  it("holds media from the ring through the answered call, and from every call session", () => {
    const ring = read("components", "incoming-call-listener.tsx");
    expect(ring).toContain("const holdsMedia = Boolean(incoming) || activeCall !== null;");
    expect(ring).toContain("beginCallMediaHold();");
    expect(ring).toContain("endCallMediaHold();");
    const session = read("lib", "call-session.tsx");
    expect(session).toContain("beginCallMediaHold();");
    expect(session).toContain("endCallMediaHold();");
  });

  it("players that hold themselves are marked so the page-wide hold leaves them alone", () => {
    const story = read("components", "story-viewer.tsx");
    const attr = /^\s*data-media-hold="self"$/gm;
    expect(story.match(attr)?.length).toBe(2);
    const muse = read("components", "muse-feed.tsx");
    expect(muse.match(attr)?.length).toBe(2);
    expect(muse).toContain("const callHold = useCallMediaHold();");
  });

  it("viewers use the page hold", () => {
    for (const file of ["lightbox.tsx", "view-once-viewer.tsx", "page-media-hold.tsx"]) {
      const source = read("components", file);
      expect(source, file).toContain("holdPageMedia();");
      expect(source, file).toContain("releasePageMedia();");
    }
  });
});
