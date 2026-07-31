"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Smile } from "lucide-react";
import EmojiPicker, { Theme, EmojiStyle } from "emoji-picker-react";

export function EmojiPickerButton({ onSelect }: { onSelect: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-lg p-1.5 text-foreground-soft hover:bg-line"
        title="Add an emoji"
        aria-label="Add an emoji"
      >
        <Smile size={16} />
      </button>
      {open && (
        <div className="absolute bottom-full right-0 z-20 mb-2">
          <EmojiPicker
            theme={Theme.AUTO}
            emojiStyle={EmojiStyle.NATIVE}
            width={300}
            height={360}
            // Bigger glyphs in the picker grid itself — easier to tell
            // similar emoji apart when tapping on mobile.
            style={{ "--epr-emoji-size": "28px" } as CSSProperties}
            onEmojiClick={(data) => {
              onSelect(data.emoji);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
