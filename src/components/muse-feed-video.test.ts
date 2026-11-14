import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bezierEases, bezierOvershoots, dragBounceOvershoots, springLiterals } from "./motion-guard";

// Opening a Muse's comments shrinks its video into a card (and closing grows it back) while it keeps playing. That only
// holds while the <video> element is never remounted: the same element, at the same place in the tree, with no key
// or condition that depends on the comments being open. These read the source to keep it that way.

const feed = readFileSync(join(__dirname, "muse-feed.tsx"), "utf8");
const sheet = readFileSync(join(__dirname, "muse-comments-sheet.tsx"), "utf8");
const overlay = readFileSync(join(__dirname, "muse-viewer-overlay.tsx"), "utf8");
const cardSource = feed.slice(feed.indexOf("function MuseCard("));
// The JSX element itself (comments in the file mention "<video>" too).
const VIDEO_TAG = /<video\s+ref=/g;
const videoAt = cardSource.search(VIDEO_TAG);

describe("the Muse card's video across the comments transition", () => {
  it("has exactly one <video>, inside the media frame that moves", () => {
    expect(cardSource.match(VIDEO_TAG)).toHaveLength(1);
    const frameOpen = cardSource.indexOf("<m.div");
    const frameClose = cardSource.indexOf("</m.div>");
    const video = videoAt;
    expect(frameOpen).toBeGreaterThan(-1);
    expect(video).toBeGreaterThan(frameOpen);
    expect(video).toBeLessThan(frameClose);
  });

  it("never keys or conditions the frame or the video on the comments state", () => {
    const frameTag = cardSource.slice(cardSource.indexOf("<m.div"), cardSource.indexOf(">", cardSource.indexOf("onAnimationComplete")));
    expect(frameTag).not.toMatch(/\bkey=/);
    const videoTag = cardSource.slice(videoAt, cardSource.indexOf("/>", videoAt));
    expect(videoTag).not.toMatch(/\bkey=/);
    expect(videoTag).not.toMatch(/comments(Open|Frame)/);
    // The frame is rendered unconditionally (not behind `commentsOpen &&` or a ternary on it).
    const beforeFrame = cardSource.slice(cardSource.lastIndexOf("\n", cardSource.indexOf("<m.div")) - 200, cardSource.indexOf("<m.div"));
    expect(beforeFrame).not.toMatch(/comments(Open|Frame)\s*(&&|\?)/);
    // Which media element shows depends on embed / nearness only.
    expect(cardSource).toMatch(/\) : isNearby \? \(\s*<video/);
  });

  it("keeps each card's React key independent of the comments state (the seed card keeps its key)", () => {
    expect(feed).toMatch(/key=\{item\.id === seedItemId \? "seed" : item\.id\}/);
    const cardUse = feed.slice(feed.indexOf("<MuseCard"), feed.indexOf("/>", feed.indexOf("<MuseCard")));
    expect(cardUse.match(/key=\{[^}]*\}/g)).toEqual(['key={item.id === seedItemId ? "seed" : item.id}']);
  });

  it("moves the frame with transform and clip-path only, as a tween, instant under reduced motion", () => {
    expect(cardSource).toMatch(/animate=\{\{ y: frameTarget\.y, scale: frameTarget\.scale, clipPath: frameTarget\.clipPath \}\}/);
    expect(cardSource).toMatch(/transition=\{reducedMotion \? MUSE_COMMENTS_INSTANT : MUSE_COMMENTS_TRANSITION\}/);
    // will-change only while it moves.
    expect(cardSource).toMatch(/willChange: frameMoving \?/);
  });

  it("locks the feed's swipe while comments are open", () => {
    expect(feed).toMatch(/overflowY: commentsOpenForId \? "hidden" : "scroll"/);
  });

  it("closes comments before the viewer on back: their own history entry, which the overlay ignores", () => {
    expect(feed).toMatch(/pushState\(\{ \.\.\.\(window\.history\.state \?\? \{\}\), museComments: true \}/);
    expect(overlay).toMatch(/history\.state as \{ museViewer\?: boolean \} \| null\)\?\.museViewer\) return;/);
  });
});

describe("the comments sheet's motion", () => {
  it("has no spring, a non-overshooting curve and a non-wobbling drag release", () => {
    expect(springLiterals(sheet)).toEqual([]);
    for (const ease of bezierEases(sheet)) expect(bezierOvershoots(ease)).toBe(false);
    const drag = sheet.match(/MUSE_SHEET_DRAG_TRANSITION = (\{[^}]*\})/)?.[1];
    expect(drag).toBeDefined();
    expect(dragBounceOvershoots(drag!)).toBe(false);
    expect(sheet).toMatch(/transition=\{reducedMotion \? MUSE_COMMENTS_INSTANT : MUSE_COMMENTS_TRANSITION\}/);
  });

  it("drags only from its handle, so the list scrolls", () => {
    expect(sheet).toMatch(/dragListener=\{false\}/);
    expect(sheet).toMatch(/onPointerDown=\{startHandleDrag\}/);
  });

  it("brings new comments in with the one-way rise-in, nothing that bounces", () => {
    expect(sheet).toMatch(/animate-rise-in/);
    const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");
    const riseIn = css.slice(css.indexOf("@keyframes rise-in"), css.indexOf("}", css.indexOf("to {", css.indexOf("@keyframes rise-in"))));
    expect(riseIn).toMatch(/from \{\s*opacity: 0;\s*transform: translateY\(8px\);/);
  });
});
