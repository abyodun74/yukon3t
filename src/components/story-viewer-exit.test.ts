import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Owner, 2026-11-15: "Make it easy to exit a Story when you are watching them." Guards the ways out of the Story
// viewer so a later edit can't quietly shrink, hide or unhook them.

const read = (f: string) => readFileSync(join(__dirname, f), "utf8");
const viewer = read("story-viewer.tsx");
const trayViewer = read("story-tray-viewer.tsx");
const profileRing = read("profile-story-ring.tsx");
const shareButton = read("story-share-button.tsx");

function closeButton(): string {
  const at = viewer.indexOf("data-story-close");
  expect(at).toBeGreaterThan(-1);
  const start = viewer.lastIndexOf("<button", at);
  const end = viewer.indexOf("</button>", at);
  return viewer.slice(start, end);
}

describe("Story viewer close button", () => {
  it("is a named button that runs the viewer's close", () => {
    const button = closeButton();
    expect(button).toMatch(/aria-label=\{shell\.common\.close\}/);
    expect(button).toMatch(/onClick=\{handleClose\}/);
  });

  it("has at least a 44px hit target, a translucent disc and a visible focus ring", () => {
    const button = closeButton();
    expect(button).toMatch(/\bh-11\b/);
    expect(button).toMatch(/\bw-11\b/);
    expect(button).toMatch(/\bmin-h-11\b/);
    expect(button).toMatch(/\bmin-w-11\b/);
    expect(button).toMatch(/\brounded-full\b/);
    expect(button).toMatch(/\bbg-black\/\d+/);
    expect(button).toMatch(/focus-visible:outline/);
  });

  it("is not conditional on the story (rendered for every story, owner or not)", () => {
    const before = viewer.slice(0, viewer.indexOf("data-story-close"));
    const headerStart = before.lastIndexOf("absolute inset-x-0 top-0 z-20");
    expect(headerStart).toBeGreaterThan(-1);
    const header = viewer.slice(headerStart, viewer.indexOf("data-story-close"));
    // The only conditional in the header row before it is the owner's delete button, which is closed by then.
    expect(header.split("{isOwner && (").length).toBe(2);
    expect(header.lastIndexOf(")}")).toBeGreaterThan(header.lastIndexOf("{isOwner && ("));
  });

  it("keeps the header (and the button) below the notch / Dynamic Island, end-aligned for the reader", () => {
    expect(viewer).toMatch(/env\(safe-area-inset-top\)/);
    expect(viewer).toMatch(/paddingTop: `calc\(\$\{SAFE_AREA_TOP\}/);
    expect(viewer).toMatch(/<div dir=\{dir\} className="mt-2 flex items-center justify-between/);
  });
});

describe("Story viewer drag down to close", () => {
  it("wires the gesture on the tap zones only, with direction lock and no browser panning", () => {
    expect(viewer).toMatch(/lockGestureAxis\(/);
    expect(viewer).toMatch(/decideStoryDismiss\(/);
    expect(viewer).toMatch(/canStartStoryDismiss\(/);
    expect((viewer.match(/data-story-zone/g) ?? []).length).toBe(2);
    expect((viewer.match(/onPointerMove=\{handlePointerMove\}/g) ?? []).length).toBe(2);
    expect((viewer.match(/onPointerCancel=\{handlePointerCancel\}/g) ?? []).length).toBe(2);
    expect((viewer.match(/className="h-full w-[12]\/3 touch-none"/g) ?? []).length).toBe(2);
  });

  it("animates with a tween only and respects reduced motion", () => {
    expect(viewer).toMatch(/prefers-reduced-motion: reduce/);
    expect(viewer).not.toMatch(/type:\s*["']spring["']/);
    expect(viewer).not.toMatch(/\bbounce\s*:/);
  });
});

describe("Story viewer back / Escape", () => {
  it("owns one history entry above the per-person viewer, used by every close", () => {
    expect(trayViewer).toMatch(/const \{ close, closeThen \} = useViewerHistory\(onClose\)/);
    expect(trayViewer).toMatch(/onClose=\{close\}/);
    // The end of the last person's stories closes through it too.
    expect(trayViewer).toMatch(/if \(authorIndex \+ 1 >= groups\.length\) \{\s*close\(\);/);
    expect(trayViewer).not.toMatch(/onClose=\{onClose\}/);
  });

  it("is used by the profile ring as well as the Home tray", () => {
    expect(profileRing).toMatch(/<StoryTrayViewer/);
    expect(profileRing).not.toMatch(/<StoryViewer\b/);
  });

  it("routes in-app links through the history-consuming close, then navigates", () => {
    expect(trayViewer).toMatch(/closeThen\(\(\) => router\.push\(href\)\)/);
    expect(trayViewer).toMatch(/onNavigate=\{navigate\}/);
    expect(viewer).toMatch(/onClickCapture=\{handleLinkClickCapture\}/);
    expect(viewer).toMatch(/internalNavigationFromClick\(e\)/);
    expect(viewer).toMatch(/e\.preventDefault\(\);\s*e\.stopPropagation\(\);/);
  });

  it("gives the emoji picker its own back entry and Escape step, before panels and the viewer", () => {
    expect(viewer).toMatch(/useBackDismiss\(emojiOpen, closeEmojiPicker\)/);
    expect(viewer).toMatch(
      /if \(emojiOpenRef\.current\) closeEmojiPicker\(\);\s*else if \(panelOpenRef\.current\) closePanels\(\);\s*else handleClose\(\);/,
    );
    // closeEmojiPicker remounts the picker (its close); the key must be on the viewer's picker.
    expect(viewer).toMatch(/<EmojiPickerButton\s+key=\{emojiPickerKey\}/);
    expect(viewer).toMatch(/onOpenChange=\{setEmojiOpen\}/);
  });

  it("closes panels and sheets before the viewer", () => {
    expect(viewer).toMatch(/useBackDismiss\(panelOpen, closePanels\)/);
    expect(shareButton).toMatch(/useBackDismiss\(open, close\)/);
  });
});
