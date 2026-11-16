import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bezierEases, bezierOvershoots, springLiterals } from "./motion-guard";

// Source guards for the Muse viewer's controls (src/lib/muse-controls.ts): the right rail has a heart Like button and
// no emoji reaction picker, the comments composer keeps its emoji / GIF pickers, and the length bar is an accessible
// slider that never mirrors, never bounces and never touches the <video> element itself.

const read = (...p: string[]) => readFileSync(join(__dirname, ...p), "utf8");
const feed = read("muse-feed.tsx");
const bar = read("muse-progress-bar.tsx");
const sheet = read("muse-comments-sheet.tsx");
const nav = read("nav.tsx");
const actions = read("..", "app", "actions", "muse.ts");
const cardSource = feed.slice(feed.indexOf("function MuseCard("));

describe("the Muse rail: a heart, no emoji picker", () => {
  it("imports no emoji picker, reaction bar or per-emoji summary", () => {
    expect(feed).not.toMatch(/EmojiPickerButton|emoji-picker-button/);
    expect(feed).not.toMatch(/ReactionBar|reaction-bar/);
    expect(feed).not.toMatch(/QUICK_REACTIONS/);
    expect(feed).not.toMatch(/getMuseReactionSummary|ReactionSummary/);
    expect(actions).not.toMatch(/getMuseReactionSummary|museReactionSummary/);
  });

  it("has one heart button that toggles the like, with a toggling accessible name", () => {
    expect(cardSource).toMatch(/<Heart\b/);
    expect(cardSource).toMatch(/onClick=\{onToggleLike\}/);
    expect(cardSource).toMatch(/liked \? controls\.unlikeLabel : controls\.likeLabel/);
    // 44px hit target and no pop: colour / fill tween only.
    const heart = cardSource.slice(cardSource.indexOf("onClick={onToggleLike}"), cardSource.indexOf("</button>", cardSource.indexOf("onClick={onToggleLike}")));
    expect(heart).toMatch(/min-w-11/);
    expect(heart).toMatch(/transition-\[color,fill\] duration-150 ease-out motion-reduce:transition-none/);
    expect(heart).not.toMatch(/scale|bounce|animate-/);
  });

  it("likes with the heart and unlikes whatever emoji the viewer had, optimistically with rollback", () => {
    expect(feed).toMatch(/toggleMuseReaction\(museId, likeToggleEmoji\(before\.myReaction\)\)/);
    expect(feed).toMatch(/optimisticLike\(before\)/);
    expect(feed).toMatch(/settleLike\(before, result\)/);
    // Same-tab sync with the author's feed copy is kept.
    expect(feed).toMatch(/announceLikeGroup\(\{ \.\.\.change, source: likeSyncSource \}\)/);
  });
});

describe("the comments composer keeps its pickers", () => {
  it("still imports the emoji / GIF picker panel and the quick-emoji row", () => {
    expect(sheet).toMatch(/import \{ CommentPickerPanel, useRecentEmoji, type CommentPickerKind \} from "@\/components\/comment-picker-panel"/);
    expect(sheet).toMatch(/MUSE_COMMENT_QUICK_EMOJI\.map/);
  });
});

describe("the length bar", () => {
  it("is a slider with its values and a localized name", () => {
    expect(bar).toMatch(/role="slider"/);
    expect(bar).toMatch(/tabIndex=\{0\}/);
    expect(bar).toMatch(/aria-label=\{t\.progressLabel\}/);
    expect(bar).toMatch(/aria-valuemin=\{0\}/);
    expect(bar).toMatch(/aria-valuemax=\{Math\.round\(duration\)\}/);
    expect(bar).toMatch(/aria-valuenow=\{Math\.round\(shown\)\}/);
    expect(bar).toMatch(/aria-valuetext=\{progressValueText\(t\.progressValue, shown, duration\)\}/);
    expect(bar).toMatch(/onKeyDown=\{onKeyDown\}/);
    // Uses the app's own :focus-visible ring (no data-ring-on-wrapper opt-out, no outline-none).
    expect(bar).not.toMatch(/data-ring-on-wrapper|outline-none/);
  });

  it("fills left to right in every language and keeps the tab swipe out of a drag", () => {
    expect(bar).toMatch(/dir="ltr"/);
    expect(bar).toMatch(/className="absolute inset-y-0 left-0 bg-white"/);
    expect(bar).toMatch(/data-no-tab-swipe/);
    expect(nav).toMatch(/\[data-no-tab-swipe\]/);
    expect(nav).toMatch(/closest\(NO_TAB_SWIPE_SELECTOR\)/);
  });

  it("drags with pointer capture on a 44px hit area; vertical swipes still scroll the feed", () => {
    expect(bar).toMatch(/setPointerCapture\(e\.pointerId\)/);
    expect(bar).toMatch(/onPointerCancel=\{endScrub\}/);
    expect(bar).toMatch(/touchAction: "pan-y"/);
    expect(bar).toMatch(/relative flex h-11 min-w-0 flex-1/);
    // Only the line's thickness changes while dragging, never a scale.
    expect(bar).toMatch(/state\.scrubbing \? "h-1\.5" : "h-0\.5"/);
    expect(bar).not.toMatch(/scale/);
  });

  it("fades with a plain opacity tween, and nothing in it springs or overshoots", () => {
    expect(bar).toMatch(/transition-opacity duration-150 ease-out motion-reduce:transition-none/);
    expect(springLiterals(bar)).toEqual([]);
    for (const ease of bezierEases(bar)) expect(bezierOvershoots(ease)).toBe(false);
    expect(bar).not.toMatch(/motion\/react/);
  });

  it("reads the card's <video> through its ref and never renders one", () => {
    expect(bar).not.toMatch(/<video\s/);
    expect(cardSource).toMatch(/<MuseProgressBar\s+videoRef=\{videoRef\}/);
  });

  it("is never rendered for an embed, and sits in the controls that step aside while comments are open", () => {
    expect(cardSource).toMatch(/\{isEmbed \? \(\s*\/\/[^\n]*\n\s*<div className="h-4" \/>\s*\) : \(\s*<MuseProgressBar/);
    const controlsAt = cardSource.indexOf("inert={commentsOpen}");
    expect(controlsAt).toBeGreaterThan(-1);
    expect(cardSource.indexOf("<MuseProgressBar")).toBeGreaterThan(controlsAt);
    expect(cardSource).toMatch(/commentsOpen=\{commentsOpen\}/);
  });

  it("holds the video still while held or dragged, and a hold's release is not a tap", () => {
    expect(cardSource).toMatch(/shouldVideoPlay\(\{ isVisible, paused, holding: bar\.holding, scrubbing: bar\.scrubbing \}\)/);
    expect(cardSource).toMatch(/onPointerCancel=\{\(e\) => endHold\(e\.pointerId, false\)\}/);
    expect(cardSource).toMatch(/if \(suppressClickRef\.current\) \{/);
    expect(feed).toMatch(/const MUSE_HOLD_EXCLUDED = "button, a, input, textarea, select, iframe, \[role='slider'\], \[data-muse-progress\]"/);
  });
});
