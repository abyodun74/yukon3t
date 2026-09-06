"use client";

import dynamic from "next/dynamic";
import type { Emoji as EmojiComponent, EmojiStyle } from "emoji-picker-react";
import { useEmojiStyle, EMOJI_STYLE_VALUES, type EmojiStyleValue } from "@/lib/emoji-style";
import { cn } from "@/lib/utils";

// Lazy-loaded for the same reason as the main picker (emoji-picker-button.tsx)
// — this settings row is the only thing on /settings that needs the library.
const Emoji = dynamic(() => import("emoji-picker-react").then((m) => m.Emoji), { ssr: false }) as typeof EmojiComponent;

const PREVIEW_UNIFIED = "1f600"; // 😀 — expressive enough to show style differences clearly.

const STYLE_LABELS: Record<EmojiStyleValue, string> = {
  native: "Native",
  apple: "Apple (3D-style)",
  google: "Google",
  facebook: "Facebook (2.5D-style)",
  twitter: "Twitter/X",
};

export function EmojiStyleSetting() {
  const [style, setStyle] = useEmojiStyle();

  return (
    <div className="flex flex-wrap gap-2">
      {EMOJI_STYLE_VALUES.map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={style === value}
          onClick={() => setStyle(value)}
          className={cn(
            "flex flex-col items-center gap-1 rounded-lg border px-3 py-2 text-xs",
            style === value ? "border-accent bg-accent/10 text-accent" : "border-line hover:border-accent/50",
          )}
        >
          <Emoji unified={PREVIEW_UNIFIED} emojiStyle={value as EmojiStyle} size={28} />
          {STYLE_LABELS[value]}
        </button>
      ))}
    </div>
  );
}
