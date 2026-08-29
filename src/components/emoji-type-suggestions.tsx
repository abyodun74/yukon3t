"use client";

import { useMemo } from "react";
import { getMessageEmojiSuggestions } from "@/lib/emoji-suggestions";

/**
 * Gboard/iMessage-style suggestion strip: as `text` changes, shows emoji
 * whose keywords match a word in it (see getMessageEmojiSuggestions),
 * tappable to insert rather than ever inserted automatically — the message
 * itself is only ever what the person actually typed plus whatever emoji
 * they chose to add.
 */
export function EmojiTypeSuggestions({
  text,
  onSelect,
}: {
  text: string;
  onSelect: (emoji: string) => void;
}) {
  const suggestions = useMemo(() => getMessageEmojiSuggestions(text), [text]);

  if (suggestions.length === 0) return null;

  return (
    <div className="animate-rise-in mt-2 flex items-center gap-1.5 overflow-x-auto">
      {suggestions.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onSelect(emoji)}
          className="shrink-0 rounded-full border border-line bg-surface px-2.5 py-1 text-lg leading-none hover:border-accent"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
