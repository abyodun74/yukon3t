import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STORY_VIDEO_MAX_AUTO_RESUMES,
  STORY_VIDEO_STALL_GIVE_UP_MS,
  STORY_VIDEO_STALL_RETRY_MS,
  STORY_SOUND_TRACK_MAX_DRIFT_S,
  playFailureAction,
  shouldResumeAfterPause,
  soundTrackOutOfStep,
  soundTrackPosition,
  stallAction,
} from "@/lib/story-video-playback";

const domError = (name: string) => Object.assign(new Error(name), { name });

describe("playFailureAction", () => {
  it("retries muted when unmuted playback needs a tap, and asks for a tap when even muted is refused", () => {
    expect(playFailureAction(domError("NotAllowedError"), false)).toBe("retry-muted");
    expect(playFailureAction(domError("NotAllowedError"), true)).toBe("blocked");
  });

  it("treats an unplayable file as an error", () => {
    expect(playFailureAction(domError("NotSupportedError"), false)).toBe("error");
  });

  it("ignores an interrupted play (the pause handler and watchdog take it from there) and junk", () => {
    expect(playFailureAction(domError("AbortError"), false)).toBe("ignore");
    expect(playFailureAction(undefined, false)).toBe("ignore");
    expect(playFailureAction("nope", true)).toBe("ignore");
  });
});

describe("shouldResumeAfterPause", () => {
  const base = { wantPlaying: true, ended: false, connected: true, pageVisible: true, issueShown: false, autoResumes: 0 };

  it("plays again after a pause nobody in the viewer asked for", () => {
    expect(shouldResumeAfterPause(base)).toBe(true);
  });

  it("leaves a held, ended, removed, hidden or already-flagged video alone", () => {
    expect(shouldResumeAfterPause({ ...base, wantPlaying: false })).toBe(false);
    expect(shouldResumeAfterPause({ ...base, ended: true })).toBe(false);
    expect(shouldResumeAfterPause({ ...base, connected: false })).toBe(false);
    expect(shouldResumeAfterPause({ ...base, pageVisible: false })).toBe(false);
    expect(shouldResumeAfterPause({ ...base, issueShown: true })).toBe(false);
  });

  it("stops after a bounded number of automatic restarts per story", () => {
    expect(shouldResumeAfterPause({ ...base, autoResumes: STORY_VIDEO_MAX_AUTO_RESUMES - 1 })).toBe(true);
    expect(shouldResumeAfterPause({ ...base, autoResumes: STORY_VIDEO_MAX_AUTO_RESUMES })).toBe(false);
  });
});

describe("stallAction", () => {
  it("waits, restarts once, then gives up to Tap to play", () => {
    expect(stallAction(STORY_VIDEO_STALL_RETRY_MS - 1, 0)).toBe("wait");
    expect(stallAction(STORY_VIDEO_STALL_RETRY_MS, 0)).toBe("retry");
    // After the restart the clock starts again from it; the total wait is STORY_VIDEO_STALL_GIVE_UP_MS.
    const second = STORY_VIDEO_STALL_GIVE_UP_MS - STORY_VIDEO_STALL_RETRY_MS;
    expect(stallAction(second - 1, 1)).toBe("wait");
    expect(stallAction(second, 1)).toBe("give-up");
  });
});

describe("a Muse's sound track on a Story", () => {
  it("follows the video's time, looping over the track's own length", () => {
    expect(soundTrackPosition(12, 30)).toBe(12);
    expect(soundTrackPosition(45, 30)).toBe(15);
    expect(soundTrackPosition(0, 30)).toBe(0);
  });

  it("has no position while the track's length isn't known", () => {
    for (const d of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) expect(soundTrackPosition(5, d)).toBeNull();
    expect(soundTrackPosition(Number.NaN, 30)).toBeNull();
  });

  it("is moved back into step only past the drift allowance, measured around the loop", () => {
    expect(soundTrackOutOfStep(10, 10 + STORY_SOUND_TRACK_MAX_DRIFT_S / 2, 30)).toBe(false);
    expect(soundTrackOutOfStep(10, 11, 30)).toBe(true);
    // 29.95s and 0.05s are 0.1s apart across the wrap, not 29.9s.
    expect(soundTrackOutOfStep(29.95, 0.05, 30)).toBe(false);
  });
});

// A reproduction of the 2026-11-22 report ("this story not playing after other stories played") against the real
// video-playback-guard module, with a minimal fake DOM: media events are queued tasks, as in a browser.
describe("moving to the next person's stories with a feed video behind the viewer", () => {
  type Listener = (e: { target: unknown }) => void;
  let queue: (() => void)[];
  let videos: FakeVideo[];
  let playListeners: Listener[];

  class FakeVideo {
    paused = true;
    srcObject = null;
    play() {
      this.paused = false;
      queue.push(() => playListeners.forEach((l) => l({ target: this })));
      return Promise.resolve();
    }
    pause() {
      this.paused = true;
    }
  }

  beforeEach(() => {
    vi.resetModules();
    queue = [];
    videos = [];
    playListeners = [];
    vi.stubGlobal("HTMLVideoElement", FakeVideo);
    vi.stubGlobal("document", {
      querySelectorAll: (sel: string) => (sel === "video" ? videos : []),
      addEventListener: (type: string, l: Listener) => {
        if (type === "play") playListeners.push(l);
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const flush = () => {
    while (queue.length) queue.shift()!();
  };

  async function scenario(holdPerPerson: boolean) {
    const guard = await import("@/lib/video-playback-guard");
    guard.installVideoCoordinator();
    const feed = new FakeVideo();
    videos.push(feed);
    feed.play();
    flush();

    // Open the viewer on person A (one hold either way).
    guard.pauseAllPlayingVideos();
    // Move to person B: the old per-person viewer released and re-took the hold in the same commit.
    if (holdPerPerson) {
      guard.resumePausedVideos();
      guard.pauseAllPlayingVideos();
    }
    const story = new FakeVideo();
    videos.push(story);
    story.play(); // the new viewer's playback effect
    flush();
    return { feed, story };
  }

  it("froze the next person's story video when the hold was taken per person (the bug)", async () => {
    const { story } = await scenario(true);
    expect(story.paused).toBe(true);
  });

  it("keeps it playing with one hold for the viewer's whole life (the fix)", async () => {
    const { feed, story } = await scenario(false);
    expect(story.paused).toBe(false);
    expect(feed.paused).toBe(true);
  });
});

// An incoming call while a Story video is open: the viewer's PageMediaHold already holds the page's media, so the
// call's pause captured nothing and the story played on under the ringtone. The call now also raises its own signal.
describe("a call while a Story viewer is open", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("document", { querySelectorAll: () => [] });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("tells call-aware viewers to hold while any call holds, and to play on after the last one ends", async () => {
    const guard = await import("@/lib/video-playback-guard");
    const listener = vi.fn();
    const unsubscribe = guard.subscribeCallMediaHold(listener);
    guard.pauseAllPlayingVideos(); // the Story viewer's PageMediaHold
    expect(guard.isCallMediaHoldActive()).toBe(false);
    guard.beginCallMediaHold(); // ringing
    guard.beginCallMediaHold(); // answered: the session
    expect(guard.isCallMediaHoldActive()).toBe(true);
    guard.endCallMediaHold(); // ringing stops
    expect(guard.isCallMediaHoldActive()).toBe(true);
    guard.endCallMediaHold(); // hung up
    expect(guard.isCallMediaHoldActive()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(4);
    // A stray extra end changes nothing (and can't release the viewer's own page hold).
    guard.endCallMediaHold();
    expect(listener).toHaveBeenCalledTimes(4);
    unsubscribe();
    guard.beginCallMediaHold();
    expect(listener).toHaveBeenCalledTimes(4);
  });
});

describe("Story viewer wiring", () => {
  const read = (f: string) => readFileSync(join(__dirname, "..", "components", f), "utf8");
  const viewer = read("story-viewer.tsx");

  it("never takes the page media hold itself (it remounts per person)", () => {
    expect(viewer).not.toMatch(/pauseAllPlayingVideos|resumePausedVideos|<PageMediaHold|video-playback-guard/);
  });

  it("holds the page media once, beside the viewer, wherever a StoryViewer is opened", () => {
    const tray = read("story-tray-viewer.tsx");
    expect(tray).toMatch(/<PageMediaHold \/>/);
    expect(tray.indexOf("<PageMediaHold />")).toBeLessThan(tray.indexOf("<StoryViewer"));
    expect(read("chat-thread.tsx")).toMatch(/storyViewer && <PageMediaHold \/>/);
  });

  it("handles every play() failure and every unplanned pause / error of the story video", () => {
    expect(viewer).not.toMatch(/\.play\(\)\.catch\(\(\) => \{\}\)/);
    const video = viewer.match(/<video\s[\s\S]*?\/>\s*\n/)?.[0] ?? "";
    expect(video).toMatch(/ref=\{attachVideo\}/);
    expect(video).toMatch(/onPause=/);
    expect(video).toMatch(/onError=/);
    expect(video).toMatch(/onPlaying=/);
    expect(video).toMatch(/playsInline/);
  });

  it("holds the story during a call, and the calls raise that hold", () => {
    expect(viewer).toContain("const callHold = useCallMediaHold();");
    expect(viewer).toMatch(/const isPaused =[\s\S]*?\|\| callHold;/);
    const calls = readFileSync(join(__dirname, "call-session.tsx"), "utf8");
    expect(calls).toContain("beginCallMediaHold();");
    expect(calls).toContain("endCallMediaHold();");
    expect(calls).not.toMatch(/pauseAllPlayingVideos\(\)|resumePausedVideos\(\)/);
    const ring = read("incoming-call-listener.tsx");
    expect(ring).toContain("beginCallMediaHold();");
    expect(ring).toContain("endCallMediaHold();");
  });

  it("plays a Muse's sound track in place of the video's sound, driven by the video's events", () => {
    const video = viewer.match(/<video\s[\s\S]*?\/>\s*\n/)?.[0] ?? "";
    expect(video).toContain("muted={Boolean(soundTrackUrl)}");
    for (const event of ["onTimeUpdate", "onPlaying", "onWaiting", "onSeeked", "onPause", "onEnded"]) {
      expect(video, event).toContain(event);
    }
    expect(viewer).toMatch(/<audio\s[\s\S]*?ref=\{attachAudio\}[\s\S]*?loop[\s\S]*?onError=/);
    // Released on unmount like the video, and silenced whenever the video is held.
    expect(viewer).toMatch(/const attachAudio = useCallback[\s\S]*?el\.removeAttribute\("src"\)/);
    expect(viewer).toContain("audioRef.current?.pause();");
  });
});
