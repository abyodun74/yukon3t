import { describe, expect, it } from "vitest";
import {
  INITIAL_PROGRESS_BAR_STATE,
  MUSE_HOLD_MOVE_TOLERANCE_PX,
  MUSE_LIKE_EMOJI,
  PROGRESS_KEY_STEP_SECONDS,
  clampTime,
  formatMediaTime,
  holdCancelledByMove,
  keyboardSeekTime,
  likeToggleEmoji,
  optimisticLike,
  progressBarReducer,
  progressBarVisible,
  progressFraction,
  progressValueText,
  resolveDuration,
  seekFractionFromPointer,
  seekTimeFromPointer,
  settleLike,
  shouldVideoPlay,
  type ProgressBarEvent,
  type ProgressBarState,
} from "@/lib/muse-controls";

const run = (...events: ProgressBarEvent["type"][]) =>
  events.reduce<ProgressBarState>((s, type) => progressBarReducer(s, { type } as ProgressBarEvent), INITIAL_PROGRESS_BAR_STATE);
const video = { isEmbed: false, commentsOpen: false, duration: 45 };

describe("formatMediaTime", () => {
  it("formats m:ss, and h:mm:ss for an hour or more", () => {
    expect(formatMediaTime(0)).toBe("0:00");
    expect(formatMediaTime(7)).toBe("0:07");
    expect(formatMediaTime(12.9)).toBe("0:12");
    expect(formatMediaTime(65)).toBe("1:05");
    expect(formatMediaTime(600)).toBe("10:00");
    expect(formatMediaTime(3723)).toBe("1:02:03");
    expect(formatMediaTime(36000)).toBe("10:00:00");
  });

  it("reads 0:00 for anything unusable", () => {
    for (const bad of [NaN, Infinity, -Infinity, -3, null, undefined]) expect(formatMediaTime(bad)).toBe("0:00");
  });
});

describe("resolveDuration (Infinity / NaN from iOS screen recordings)", () => {
  it("prefers the element's usable duration", () => {
    expect(resolveDuration(44.6, 45)).toBe(44.6);
  });

  it("falls back to the stored length when the element reports Infinity, NaN or 0", () => {
    expect(resolveDuration(Infinity, 45)).toBe(45);
    expect(resolveDuration(NaN, 45)).toBe(45);
    expect(resolveDuration(0, 45)).toBe(45);
    expect(resolveDuration(null, 45)).toBe(45);
  });

  it("is null when neither is known (no bar then)", () => {
    expect(resolveDuration(Infinity, null)).toBeNull();
    expect(resolveDuration(NaN, 0)).toBeNull();
    expect(progressBarVisible(run("pause"), { ...video, duration: null })).toBe(false);
  });

  it("fills safely whatever the numbers", () => {
    expect(progressFraction(10, null)).toBe(0);
    expect(progressFraction(NaN, 45)).toBe(0);
    expect(progressFraction(90, 45)).toBe(1);
    expect(progressFraction(-1, 45)).toBe(0);
    expect(progressFraction(22.5, 45)).toBe(0.5);
    expect(clampTime(Infinity, 45)).toBe(0);
  });
});

describe("seek math from the pointer", () => {
  const rect = { left: 16, width: 200 };

  it("maps the pointer along the line, clamped to both ends", () => {
    expect(seekFractionFromPointer(16, rect)).toBe(0);
    expect(seekFractionFromPointer(116, rect)).toBe(0.5);
    expect(seekFractionFromPointer(216, rect)).toBe(1);
    expect(seekFractionFromPointer(-50, rect)).toBe(0);
    expect(seekFractionFromPointer(999, rect)).toBe(1);
    expect(seekTimeFromPointer(116, rect, 45)).toBe(22.5);
    expect(seekTimeFromPointer(999, rect, 45)).toBe(45);
  });

  it("never flips for right-to-left: left is always the start", () => {
    // Same rect, same answer: the bar is dir="ltr" in every language.
    expect(seekFractionFromPointer(66, rect)).toBe(0.25);
  });

  it("is safe with a zero-width line or a bad coordinate", () => {
    expect(seekFractionFromPointer(50, { left: 0, width: 0 })).toBe(0);
    expect(seekFractionFromPointer(NaN, rect)).toBe(0);
  });
});

describe("keyboard seek", () => {
  it("moves 5 seconds with the arrows, clamped", () => {
    expect(PROGRESS_KEY_STEP_SECONDS).toBe(5);
    expect(keyboardSeekTime("ArrowRight", 10, 45)).toBe(15);
    expect(keyboardSeekTime("ArrowUp", 10, 45)).toBe(15);
    expect(keyboardSeekTime("ArrowLeft", 10, 45)).toBe(5);
    expect(keyboardSeekTime("ArrowDown", 3, 45)).toBe(0);
    expect(keyboardSeekTime("ArrowRight", 43, 45)).toBe(45);
  });

  it("jumps to either end with Home / End and leaves other keys alone", () => {
    expect(keyboardSeekTime("Home", 30, 45)).toBe(0);
    expect(keyboardSeekTime("End", 3, 45)).toBe(45);
    expect(keyboardSeekTime("Tab", 3, 45)).toBeNull();
    expect(keyboardSeekTime("Enter", 3, 45)).toBeNull();
  });

  it("speaks the value as elapsed of total", () => {
    expect(progressValueText("{current} of {total}", 12.4, 45)).toBe("0:12 of 0:45");
    expect(progressValueText("{current} من {total}", 0, 3723)).toBe("0:00 من 1:02:03");
  });
});

describe("bar visibility", () => {
  it("is hidden while playing normally", () => {
    expect(progressBarVisible(INITIAL_PROGRESS_BAR_STATE, video)).toBe(false);
    expect(progressBarVisible(run("play"), video)).toBe(false);
  });

  it("shows while held, while paused, while dragged and with keyboard focus", () => {
    expect(progressBarVisible(run("hold_start"), video)).toBe(true);
    expect(progressBarVisible(run("pause"), video)).toBe(true);
    expect(progressBarVisible(run("scrub_start"), video)).toBe(true);
    expect(progressBarVisible(run("focus"), video)).toBe(true);
  });

  it("lingers after resuming, then hides", () => {
    const resumed = run("pause", "play");
    expect(resumed.lingering).toBe(true);
    expect(progressBarVisible(resumed, video)).toBe(true);
    const done = progressBarReducer(resumed, { type: "linger_done" });
    expect(progressBarVisible(done, video)).toBe(false);
  });

  it("lingers after a hold ends and after a drag ends", () => {
    expect(run("hold_start", "hold_end")).toMatchObject({ holding: false, lingering: true });
    expect(run("scrub_start", "scrub_end")).toMatchObject({ scrubbing: false, lingering: true });
  });

  it("stays up while any reason remains (paused, then a drag ends)", () => {
    const s = run("pause", "scrub_start", "scrub_end");
    expect(s).toMatchObject({ paused: true, lingering: false });
    expect(progressBarVisible(s, video)).toBe(true);
  });

  it("a new reason during the linger cancels it", () => {
    expect(run("pause", "play", "hold_start")).toMatchObject({ holding: true, lingering: false });
  });

  it("is never shown with comments open or for an embed", () => {
    for (const s of [run("pause"), run("hold_start"), run("scrub_start"), run("pause", "play")]) {
      expect(progressBarVisible(s, { ...video, commentsOpen: true })).toBe(false);
      expect(progressBarVisible(s, { ...video, isEmbed: true })).toBe(false);
    }
  });

  it("returns the same object when nothing changes (no extra render)", () => {
    const paused = run("pause");
    expect(progressBarReducer(paused, { type: "pause" })).toBe(paused);
    expect(progressBarReducer(INITIAL_PROGRESS_BAR_STATE, { type: "linger_done" })).toBe(INITIAL_PROGRESS_BAR_STATE);
  });
});

describe("play / pause while holding and dragging", () => {
  const base = { isVisible: true, paused: false, holding: false, scrubbing: false };
  it("plays on screen, unpaused, not held, not dragged", () => {
    expect(shouldVideoPlay(base)).toBe(true);
    expect(shouldVideoPlay({ ...base, isVisible: false })).toBe(false);
    expect(shouldVideoPlay({ ...base, paused: true })).toBe(false);
    expect(shouldVideoPlay({ ...base, holding: true })).toBe(false);
    expect(shouldVideoPlay({ ...base, scrubbing: true })).toBe(false);
  });

  it("a drag restores the state from before it: playing plays on, paused stays paused", () => {
    const playing = run("scrub_start", "scrub_end");
    expect(shouldVideoPlay({ ...base, paused: playing.paused, scrubbing: playing.scrubbing })).toBe(true);
    const paused = run("pause", "scrub_start", "scrub_end");
    expect(shouldVideoPlay({ ...base, paused: true, scrubbing: paused.scrubbing })).toBe(false);
  });

  it("a press that moves is a scroll, not a hold", () => {
    const start = { x: 100, y: 100 };
    expect(holdCancelledByMove(start, { x: 104, y: 105 })).toBe(false);
    expect(holdCancelledByMove(start, { x: 100, y: 100 + MUSE_HOLD_MOVE_TOLERANCE_PX + 1 })).toBe(true);
  });
});

describe("the heart (like toggle)", () => {
  it("not liked: sends the heart; liked with any emoji: sends that emoji, which removes it", () => {
    expect(MUSE_LIKE_EMOJI).toBe("❤️");
    expect(likeToggleEmoji(null)).toBe("❤️");
    expect(likeToggleEmoji("❤️")).toBe("❤️");
    expect(likeToggleEmoji("😂")).toBe("😂");
  });

  it("shows the opposite state at once", () => {
    expect(optimisticLike({ myReaction: null, likeCount: 4 })).toEqual({ myReaction: "❤️", likeCount: 5 });
    expect(optimisticLike({ myReaction: "🔥", likeCount: 4 })).toEqual({ myReaction: null, likeCount: 3 });
    expect(optimisticLike({ myReaction: "🔥", likeCount: 0 })).toEqual({ myReaction: null, likeCount: 0 });
  });

  it("takes the server's count and liked state (a like group's count)", () => {
    expect(settleLike({ myReaction: null, likeCount: 4 }, { error: null, liked: true, likeCount: 9 })).toEqual({
      myReaction: "❤️",
      likeCount: 9,
    });
    expect(settleLike({ myReaction: "😂", likeCount: 4 }, { error: null, liked: false, likeCount: 3 })).toEqual({
      myReaction: null,
      likeCount: 3,
    });
    // Liked kept (an old emoji like): that emoji stays.
    expect(settleLike({ myReaction: "😂", likeCount: 4 }, { error: null, liked: true, likeCount: 4 })).toEqual({
      myReaction: "😂",
      likeCount: 4,
    });
  });

  it("rolls back to exactly what was shown on failure", () => {
    const before = { myReaction: "😂", likeCount: 4 };
    expect(settleLike(before, { error: "not_found" })).toBe(before);
    expect(settleLike(before, { error: "failed" })).toBe(before);
    expect(settleLike(before, { error: null })).toBe(before);
  });
});
