import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createHeartBurst,
  createVideoTapToggle,
  HEART_BURST_MS,
  likeGestureAction,
  likeRolledBack,
  pausedStatePlayback,
  type HeartBurstTimers,
} from "./heart-burst";

// The rising like heart on Muse and Story (owner request: "apply the heart animation to Muse and Story too"): the
// per-item cleanup, the Muse double tap (likes only, playback left as it was) and the wiring in each viewer.

function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: HeartBurstTimers = {
    set: (fn, ms) => {
      const id = nextId++;
      pending.set(id, { at: now + ms, fn });
      return id;
    },
    clear: (h) => void pending.delete(h as number),
  };
  return {
    timers,
    pending: () => pending.size,
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...pending]) {
        if (t.at <= now) {
          pending.delete(id);
          t.fn();
        }
      }
    },
  };
}

describe("a heart belongs to the item it was shown for (Story viewer)", () => {
  it("moving to another item hides it at once and leaves no timer", () => {
    const f = fakeTimers();
    const seen: (number | null)[] = [];
    const b = createHeartBurst({ onChange: (k) => seen.push(k), timers: f.timers });
    b.show("story-a");
    b.itemChanged("story-b");
    expect(seen).toEqual([1, null]);
    expect(f.pending()).toBe(0);
    f.advance(HEART_BURST_MS * 2);
    expect(seen).toEqual([1, null]);
  });

  it("staying on the same item (or nothing showing) changes nothing", () => {
    const f = fakeTimers();
    const seen: (number | null)[] = [];
    const b = createHeartBurst({ onChange: (k) => seen.push(k), timers: f.timers });
    b.itemChanged("story-a");
    expect(seen).toEqual([]);
    b.show("story-a");
    b.itemChanged("story-a");
    expect(seen).toEqual([1]);
    expect(f.pending()).toBe(1);
    f.advance(HEART_BURST_MS);
    expect(seen).toEqual([1, null]);
    b.itemChanged("story-b");
    expect(seen).toEqual([1, null]);
  });

  it("reports the item with each start", () => {
    const f = fakeTimers();
    const items: unknown[] = [];
    const b = createHeartBurst({ onChange: (k, item) => k !== null && items.push(item), timers: f.timers });
    b.show("story-a");
    b.show("story-b");
    expect(items).toEqual(["story-a", "story-b"]);
  });

  it("a rolled-back like only takes its own item's heart", () => {
    const f = fakeTimers();
    const seen: (number | null)[] = [];
    const b = createHeartBurst({ onChange: (k) => seen.push(k), timers: f.timers });
    b.show("story-b");
    b.cancel("story-a");
    expect(seen).toEqual([1]);
    expect(f.pending()).toBe(1);
    b.cancel("story-b");
    expect(seen).toEqual([1, null]);
    expect(f.pending()).toBe(0);
    // Already gone: nothing more.
    b.cancel("story-b");
    expect(seen).toEqual([1, null]);
  });

  it("after unmount nothing calls back", () => {
    const f = fakeTimers();
    const seen: (number | null)[] = [];
    const b = createHeartBurst({ onChange: (k) => seen.push(k), timers: f.timers });
    b.show("story-a");
    b.dispose();
    b.itemChanged("story-b");
    b.cancel("story-a");
    expect(seen).toEqual([1]);
    expect(f.pending()).toBe(0);
  });
});

describe("Muse like gestures", () => {
  it("the heart button likes or unlikes", () => {
    expect(likeGestureAction(false, "button")).toBe("like");
    expect(likeGestureAction(true, "button")).toBe("unlike");
  });

  it("a double tap never unlikes: it likes, or only shows the heart again", () => {
    expect(likeGestureAction(false, "double-tap")).toBe("like");
    expect(likeGestureAction(true, "double-tap")).toBe("heart");
  });

  it("takes the heart back only when a like was refused", () => {
    expect(likeRolledBack(true, false)).toBe(true);
    expect(likeRolledBack(true, true)).toBe(false);
    // An unlike never showed a heart.
    expect(likeRolledBack(false, false)).toBe(false);
    expect(likeRolledBack(false, true)).toBe(false);
  });
});

describe("Muse tap / double tap on the video (paused state)", () => {
  function cardState(initiallyPaused: boolean) {
    let paused = initiallyPaused;
    const history: boolean[] = [];
    const playback = pausedStatePlayback(
      () => paused,
      (next) => {
        paused = next;
        history.push(next);
      },
    );
    return { playback, history, paused: () => paused };
  }

  it("a single tap pauses or plays at once", () => {
    const toggle = createVideoTapToggle(280, 40);
    const card = cardState(false);
    expect(toggle.tap(1000, 100, 100, card.playback)).toBe("toggled");
    expect(card.paused()).toBe(true);
    expect(toggle.tap(2000, 100, 100, card.playback)).toBe("toggled");
    expect(card.paused()).toBe(false);
  });

  it("a double tap on a playing video likes and leaves it playing", () => {
    const toggle = createVideoTapToggle(280, 40);
    const card = cardState(false);
    expect(toggle.tap(1000, 100, 100, card.playback)).toBe("toggled");
    expect(toggle.tap(1200, 110, 105, card.playback)).toBe("double");
    expect(card.paused()).toBe(false);
    expect(card.history).toEqual([true, false]);
  });

  it("a double tap on a paused video likes and leaves it paused", () => {
    const toggle = createVideoTapToggle(280, 40);
    const card = cardState(true);
    toggle.tap(1000, 100, 100, card.playback);
    expect(toggle.tap(1150, 100, 100, card.playback)).toBe("double");
    expect(card.paused()).toBe(true);
  });

  it("a tap that turned sound on (reset) never starts a double tap", () => {
    const toggle = createVideoTapToggle(280, 40);
    const card = cardState(false);
    // The card resets the detector instead of tapping; the next tap is a plain first tap.
    toggle.reset();
    expect(toggle.tap(1100, 100, 100, card.playback)).toBe("toggled");
    expect(card.paused()).toBe(true);
  });
});

describe("wiring", () => {
  const read = (...p: string[]) => readFileSync(join(__dirname, "..", ...p), "utf8");
  const muse = read("components", "muse-feed.tsx");
  const museCard = muse.slice(muse.indexOf("function MuseCard("));
  const story = read("components", "story-viewer.tsx");
  const post = read("components", "post-card.tsx");
  const layer = read("components", "heart-burst-layer.tsx");
  const css = read("app", "globals.css");

  it("one shared overlay: never hit-testable, hidden from assistive tech, clipped", () => {
    expect(layer).toMatch(/aria-hidden="true"/);
    expect(layer).toMatch(/pointer-events-none absolute inset-0 z-\[1\] overflow-hidden/);
    for (const source of [post, muse, story]) {
      expect(source).toMatch(/import \{ HeartBurstLayer \} from "@\/components\/heart-burst-layer"/);
      expect(source).not.toMatch(/function HeartLayer\(/);
      expect(source).not.toMatch(/<LikeHeartArt/);
    }
  });

  it("Muse: the heart rises inside the media frame, on a like only, through the existing like path", () => {
    const frame = museCard.slice(museCard.indexOf("<m.div"), museCard.indexOf("</m.div>"));
    expect(frame).toMatch(/ref=\{mediaFrameRef\}/);
    expect(frame).toMatch(/<HeartBurstLayer burst=\{heart\} \/>/);
    expect(muse).toMatch(/const action = likeGestureAction\(current\.myReaction !== null, gesture\);/);
    expect(muse).toMatch(/if \(action === "like"\) heart\.show\(\);/);
    expect(muse).toMatch(/if \(likeRolledBack\(action === "like", settled\.myReaction !== null\)\) heart\.cancel\(\);/);
    // Guests still get the sign-up prompt first, before any heart.
    const toggle = muse.slice(muse.indexOf("async function toggleLike("), muse.indexOf("heart.show()"));
    expect(toggle).toMatch(/if \(isGuest\) \{\s*promptSignUp\(\);\s*return;/);
  });

  it("Muse: a double tap on the video likes; single taps keep pausing at once; embeds and the seed post never like", () => {
    expect(museCard).toMatch(/videoTap\.current\.tap\(Date\.now\(\), e\.clientX, e\.clientY, pausedPlayback\) === "double" && !isSeedPost/);
    expect(museCard).toMatch(/onLike\("double-tap", likeHeart\)/);
    const click = museCard.slice(museCard.indexOf("onClick={(e) => {"), museCard.indexOf("onLike(\"double-tap\""));
    // Hold release, comments, embed and the sound-unblock tap still come first, unchanged.
    const order = ["suppressClickRef.current", "if (commentsOpen)", "if (isEmbed) return;", "soundBlocked || consumeUnblockTap()", "videoTap.current.tap("];
    let at = -1;
    for (const step of order) {
      const next = click.indexOf(step);
      expect(next, step).toBeGreaterThan(at);
      at = next;
    }
  });

  it("Story: the heart replaces the old bloom, is keyed to the story on screen and has no double tap", () => {
    expect(story).toMatch(/const heart = useHeartBurst\(story\?\.id\);/);
    expect(story).toMatch(/<HeartBurstLayer burst=\{heart\} className="z-10" \/>/);
    expect(story).toMatch(/if \(likeRolledBack\(wanted\.liked, settled\.liked\)\) heart\.cancel\(storyId\);/);
    expect(story).not.toMatch(/likeBurst|story-like-burst/);
    expect(css).not.toMatch(/story-like-burst/);
    expect(story).not.toMatch(/createDoubleTapDetector|createVideoTapToggle|DOUBLE_TAP_MS/);
    // The heart is still never offered on the author's own story, and guests get the sign-up prompt.
    const like = story.slice(story.indexOf("async function handleToggleLike("), story.indexOf("heart.show("));
    expect(like).toMatch(/if \(!story \|\| isOwner\) return;/);
    expect(like).toMatch(/if \(isGuest\) \{\s*promptSignUp\(\);\s*return;/);
  });
});
