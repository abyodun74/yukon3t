"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { Smile } from "lucide-react";
// Type-only import — erased entirely at build time, so this doesn't pull
// the package into this file's bundle. The actual component is loaded via
// next/dynamic below, fetched only once a user clicks the emoji button
// instead of shipping on every page (this button sits on /home and every
// DM thread) — emoji-picker-react bundles a full emoji dataset+search
// index that's otherwise dead weight for the vast majority of page loads.
import type { Theme, EmojiStyle } from "emoji-picker-react";

const EmojiPicker = dynamic(() => import("emoji-picker-react"), { ssr: false });
// String enums under the hood (Theme.AUTO === "auto", EmojiStyle.NATIVE ===
// "native") — literal values avoid needing a runtime import of the enums.
const THEME_AUTO = "auto" as Theme;
const EMOJI_STYLE_NATIVE = "native" as EmojiStyle;

const PICKER_WIDTH = 300;
const PICKER_HEIGHT = 360;
const VIEWPORT_MARGIN = 8;

type Position = { top: number; left: number; width: number; height: number };

/**
 * window.visualViewport (not window.innerWidth/innerHeight) is what
 * actually shrinks when a mobile on-screen keyboard opens — this button
 * also sits in the comment/message composer, where the keyboard is up by
 * the time someone taps it. Falls back to the layout viewport for browsers
 * without the API.
 */
function getViewportSize() {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  return { width: vv?.width ?? window.innerWidth, height: vv?.height ?? window.innerHeight };
}

/**
 * The picker is rendered via a portal, positioned with `fixed` coordinates
 * computed from the trigger button's own bounding rect — not CSS
 * `top-full`/`bottom-full` on a relatively-positioned ancestor. Buttons
 * live inside scrollable message lists, and an absolutely-positioned
 * popup taller than the remaining space in that scroll container gets
 * silently clipped (and its "visible" — but unclickable — remainder
 * swallows clicks meant for whatever sits behind it). A portal escapes
 * that clipping and lets us flip/clamp against the actual viewport.
 *
 * Width/height are also clamped to the viewport, not just position — on
 * a narrow phone (or any viewport shorter than ~376px once the keyboard is
 * up) the fixed 300x360 size itself doesn't fit, and clamping only the
 * top/left coordinates against a size larger than the viewport pushes the
 * box partly off-screen rather than shrinking it to fit.
 */
function computePosition(rect: DOMRect): Position {
  const { width: viewportWidth, height: viewportHeight } = getViewportSize();
  const width = Math.min(PICKER_WIDTH, viewportWidth - VIEWPORT_MARGIN * 2);
  const height = Math.min(PICKER_HEIGHT, viewportHeight - VIEWPORT_MARGIN * 2);

  const spaceBelow = viewportHeight - rect.bottom;
  const openUp = spaceBelow < height + VIEWPORT_MARGIN && rect.top > spaceBelow;

  const top = openUp
    ? Math.max(VIEWPORT_MARGIN, rect.top - height - VIEWPORT_MARGIN)
    : Math.min(rect.bottom + VIEWPORT_MARGIN, viewportHeight - height - VIEWPORT_MARGIN);

  const left = Math.min(
    Math.max(VIEWPORT_MARGIN, rect.right - width),
    viewportWidth - width - VIEWPORT_MARGIN,
  );

  return { top, left, width, height };
}

export function EmojiPickerButton({ onSelect }: { onSelect: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function close(e: Event) {
      const target = e.target as Node;
      if (popupRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", close);
    // Any scroll (message list, page) invalidates the computed position — close rather than chase it.
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    // window's resize event doesn't fire when the on-screen keyboard
    // opens/closes in iOS Safari (only visualViewport's does) — without
    // this, the popup's now-stale size/position would linger open through
    // a keyboard toggle instead of closing like it does for every other
    // viewport change.
    window.visualViewport?.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.visualViewport?.removeEventListener("resize", close);
    };
  }, [open]);

  function toggleOpen() {
    if (!open && buttonRef.current) {
      setPosition(computePosition(buttonRef.current.getBoundingClientRect()));
    }
    setOpen((v) => !v);
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        className="rounded-lg p-1.5 text-foreground-soft hover:bg-line"
        title="Add an emoji"
        aria-label="Add an emoji"
      >
        <Smile size={16} />
      </button>
      {open &&
        position &&
        createPortal(
          <div ref={popupRef} className="fixed z-50" style={{ top: position.top, left: position.left }}>
            <EmojiPicker
              theme={THEME_AUTO}
              emojiStyle={EMOJI_STYLE_NATIVE}
              width={position.width}
              height={position.height}
              // Bigger glyphs in the picker grid itself — easier to tell
              // similar emoji apart when tapping on mobile.
              style={{ "--epr-emoji-size": "28px" } as CSSProperties}
              onEmojiClick={(data) => {
                onSelect(data.emoji);
                setOpen(false);
              }}
            />
          </div>,
          document.body,
        )}
    </>
  );
}
