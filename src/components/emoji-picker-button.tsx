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
import { getSuggestedEmojis } from "@/lib/emoji-suggestions";
import { useEmojiStyle } from "@/lib/emoji-style";
import { computePopoverPosition, type PopoverPosition } from "@/lib/popover-position";

const EmojiPicker = dynamic(() => import("emoji-picker-react"), { ssr: false });
// The library's own search input, found once it's mounted (see the
// MutationObserver in useSuggestions below) — there's no prop to read or
// control its value directly (confirmed against emoji-picker-react's
// shipped types), so this is the only way to react to what's typed there.
// The label text is part of the library's public accessibility contract,
// far less likely to change across versions than an internal class name.
const SEARCH_INPUT_SELECTOR = 'input[aria-label="Type to search for an emoji"]';
// String enums under the hood (Theme.AUTO === "auto") — literal values
// avoid needing a runtime import of the enum.
const THEME_AUTO = "auto" as Theme;

const PICKER_WIDTH = 300;
const PICKER_HEIGHT = 360;
const SUGGESTIONS_BAR_HEIGHT = 40;
// A compact quick-reaction row (see the `quickReactions` prop) — sized to
// content instead of the full picker's fixed box, same WhatsApp-style
// long-press reaction bar pattern already used in story-viewer.tsx.
const QUICK_BAR_HEIGHT = 44;
const QUICK_BUTTON_WIDTH = 36;

type Position = PopoverPosition;

export function EmojiPickerButton({
  onSelect,
  quickReactions,
}: {
  onSelect: (emoji: string) => void;
  /**
   * When given, the button opens to a small WhatsApp-style quick-reaction
   * row first (no emoji-picker-react import triggered yet) instead of the
   * full picker — tapping "+" then expands into the full picker below.
   * Omit for uses that always want the full picker directly (e.g. the
   * composer's insert-emoji-into-text button).
   */
  quickReactions?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [showFullPicker, setShowFullPicker] = useState(!quickReactions);
  const [emojiStyle] = useEmojiStyle();
  const [position, setPosition] = useState<Position | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  // Watches for the library's search input to appear (it mounts async —
  // next/dynamic + the picker's own render pass) and mirrors its typed
  // value into `suggestions`, so a term like "amen" or "sad" that the
  // library's own search doesn't know surfaces a small curated row above
  // its results instead of the search coming up empty. Cleaned up whenever
  // the picker closes, since a fresh input element exists on every reopen.
  // Only relevant once the full picker is actually showing — the compact
  // quick-reaction row below has no search input at all.
  useEffect(() => {
    if (!open || !showFullPicker) return;

    let inputEl: HTMLInputElement | null = null;
    function onInput(e: Event) {
      setSuggestions(getSuggestedEmojis((e.target as HTMLInputElement).value));
    }

    const observer = new MutationObserver(() => {
      if (inputEl || !popupRef.current) return;
      const found = popupRef.current.querySelector<HTMLInputElement>(SEARCH_INPUT_SELECTOR);
      if (!found) return;
      inputEl = found;
      inputEl.addEventListener("input", onInput);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      inputEl?.removeEventListener("input", onInput);
    };
  }, [open, showFullPicker]);

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

    // Re-measure and reposition (not dismiss) on a viewport resize instead
    // of closing — confirmed on-device (see GifPickerButton, which shares
    // this same positioning code) that opening the on-screen keyboard right
    // after this popup's initial position was computed against the
    // pre-keyboard viewport left the popup's bottom portion hidden behind
    // the keyboard for the whole session, since the "close on resize"
    // behavior below never actually fired to correct for it.
    function reposition() {
      if (!buttonRef.current) return;
      const rect = buttonRef.current.getBoundingClientRect();
      const quickBarWidth = quickReactions ? (quickReactions.length + 1) * QUICK_BUTTON_WIDTH : PICKER_WIDTH;
      setPosition(
        !showFullPicker && quickReactions
          ? computePopoverPosition(rect, quickBarWidth, QUICK_BAR_HEIGHT)
          : computePopoverPosition(rect, PICKER_WIDTH, PICKER_HEIGHT),
      );
    }
    window.visualViewport?.addEventListener("resize", reposition);
    // Fallback for when the keyboard's open animation doesn't fire a
    // visualViewport resize event at all on some Android WebView versions —
    // one re-measure after the keyboard's typical animation window closes
    // that gap regardless of whether the event fires.
    const fallbackTimer = setTimeout(reposition, 350);

    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.visualViewport?.removeEventListener("resize", reposition);
      clearTimeout(fallbackTimer);
    };
  }, [open, showFullPicker, quickReactions]);

  function toggleOpen() {
    if (!open && buttonRef.current) {
      const startsWithQuickBar = Boolean(quickReactions);
      setShowFullPicker(!startsWithQuickBar);
      const rect = buttonRef.current.getBoundingClientRect();
      const quickBarWidth = quickReactions ? (quickReactions.length + 1) * QUICK_BUTTON_WIDTH : PICKER_WIDTH;
      setPosition(
        startsWithQuickBar
          ? computePopoverPosition(rect, quickBarWidth, QUICK_BAR_HEIGHT)
          : computePopoverPosition(rect, PICKER_WIDTH, PICKER_HEIGHT),
      );
      // Cleared here (a plain event handler) rather than in the effect
      // above, so a stale "Suggested" row from the last time this was open
      // can't flash before the new search input's first keystroke.
      setSuggestions([]);
    }
    setOpen((v) => !v);
  }

  /** "+" on the compact quick-reaction row — expands the same popup into the full picker (triggering its dynamic import for the first time). */
  function expandToFullPicker() {
    if (buttonRef.current) {
      setPosition(computePopoverPosition(buttonRef.current.getBoundingClientRect(), PICKER_WIDTH, PICKER_HEIGHT));
    }
    setShowFullPicker(true);
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
          <div
            ref={popupRef}
            className="fixed z-50 flex flex-col overflow-hidden rounded-lg shadow-lg"
            style={{ top: position.top, left: position.left, width: position.width, height: position.height }}
          >
            {!showFullPicker && quickReactions ? (
              // Compact WhatsApp-style quick-reaction row — no
              // emoji-picker-react import triggered until "+" is tapped.
              <div className="flex h-full items-center gap-1 bg-surface px-1.5">
                {quickReactions.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => {
                      onSelect(emoji);
                      setOpen(false);
                    }}
                    className="shrink-0 rounded-full p-1.5 text-xl hover:bg-line"
                  >
                    {emoji}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={expandToFullPicker}
                  title="More emoji"
                  aria-label="More emoji"
                  className="ml-auto shrink-0 rounded-full p-1.5 text-foreground-soft hover:bg-line"
                >
                  <Smile size={18} />
                </button>
              </div>
            ) : (
              <>
                {suggestions.length > 0 && (
                  <div
                    className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-surface px-2"
                    style={{ height: SUGGESTIONS_BAR_HEIGHT }}
                  >
                    <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-foreground-soft">
                      Suggested
                    </span>
                    {suggestions.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => {
                          onSelect(emoji);
                          setOpen(false);
                        }}
                        className="shrink-0 rounded-md p-1 text-xl hover:bg-line"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
                <EmojiPicker
                  theme={THEME_AUTO}
                  emojiStyle={emojiStyle as EmojiStyle}
                  width={position.width}
                  // Borrows space from the picker itself when the suggestions
                  // bar is showing, rather than adding to the popup's total
                  // height — the popup's own box (set above) is already
                  // clamped to fit the viewport, and growing past that on a
                  // short/keyboard-open viewport is exactly the kind of
                  // overflow this app has had to fix before.
                  height={suggestions.length > 0 ? position.height - SUGGESTIONS_BAR_HEIGHT : position.height}
                  // Bigger glyphs in the picker grid itself — easier to tell
                  // similar emoji apart when tapping on mobile.
                  style={{ "--epr-emoji-size": "28px" } as CSSProperties}
                  onEmojiClick={(data) => {
                    onSelect(data.emoji);
                    setOpen(false);
                  }}
                />
              </>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
