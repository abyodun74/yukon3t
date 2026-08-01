"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Smile } from "lucide-react";
import EmojiPicker, { Theme, EmojiStyle } from "emoji-picker-react";

const PICKER_WIDTH = 300;
const PICKER_HEIGHT = 360;
const VIEWPORT_MARGIN = 8;

type Position = { top: number; left: number };

/**
 * The picker is rendered via a portal, positioned with `fixed` coordinates
 * computed from the trigger button's own bounding rect — not CSS
 * `top-full`/`bottom-full` on a relatively-positioned ancestor. Buttons
 * live inside scrollable message lists, and an absolutely-positioned
 * popup taller than the remaining space in that scroll container gets
 * silently clipped (and its "visible" — but unclickable — remainder
 * swallows clicks meant for whatever sits behind it). A portal escapes
 * that clipping and lets us flip/clamp against the actual viewport.
 */
function computePosition(rect: DOMRect): Position {
  const spaceBelow = window.innerHeight - rect.bottom;
  const openUp = spaceBelow < PICKER_HEIGHT + VIEWPORT_MARGIN && rect.top > spaceBelow;

  const top = openUp
    ? Math.max(VIEWPORT_MARGIN, rect.top - PICKER_HEIGHT - VIEWPORT_MARGIN)
    : Math.min(rect.bottom + VIEWPORT_MARGIN, window.innerHeight - PICKER_HEIGHT - VIEWPORT_MARGIN);

  const left = Math.min(
    Math.max(VIEWPORT_MARGIN, rect.right - PICKER_WIDTH),
    window.innerWidth - PICKER_WIDTH - VIEWPORT_MARGIN,
  );

  return { top, left };
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
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
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
              theme={Theme.AUTO}
              emojiStyle={EmojiStyle.NATIVE}
              width={PICKER_WIDTH}
              height={PICKER_HEIGHT}
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
