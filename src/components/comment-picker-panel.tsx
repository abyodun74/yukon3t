"use client";

import { useCallback, useState, type CSSProperties } from "react";
import dynamic from "next/dynamic";
// Type-only: erased at build time. The picker itself (emoji-picker-react, the same library as EmojiPickerButton, with
// its whole emoji dataset) is fetched only when the emoji panel first opens.
import type { Categories, EmojiStyle, Theme } from "emoji-picker-react";
import { GifSearchPanel } from "@/components/gif-picker-button";
import { useCommentToolsText } from "@/components/comment-tools-text";
import { useEmojiStyle } from "@/lib/emoji-style";
import { pushRecentEmoji, readRecentEmoji, safeLocalStorage, writeRecentEmoji } from "@/lib/emoji-insert";

const EmojiPicker = dynamic(() => import("emoji-picker-react"), { ssr: false });
const THEME_AUTO = "auto" as Theme;
const RECENT_ROW_HEIGHT = 44;

// Every category but the library's own "suggested" one: the recently used row above the grid is ours (kept with
// try/catch in localStorage, shared with the composer's quick-emoji row), so the picker doesn't keep a second list.
const CATEGORY_ORDER = [
  "smileys_people",
  "animals_nature",
  "food_drink",
  "travel_places",
  "activities",
  "objects",
  "symbols",
  "flags",
] as const;

export type CommentPickerKind = "emoji" | "gif";

/** The recently used emoji, newest first: read once from this device, updated (and saved) on every pick. */
export function useRecentEmoji(): [string[], (emoji: string) => void] {
  const [recents, setRecents] = useState<string[]>(() => readRecentEmoji(safeLocalStorage()));
  const remember = useCallback((emoji: string) => {
    setRecents((prev) => {
      const next = pushRecentEmoji(prev, emoji);
      writeRecentEmoji(safeLocalStorage(), next);
      return next;
    });
  }, []);
  return [recents, remember];
}

/**
 * The emoji or GIF panel of a comments composer, shown where the keyboard was (like WhatsApp / TikTok): a fixed
 * height, its own scrolling, nothing that animates. Emoji: a recently used row, then the full picker (categories in
 * the reader's language, search). GIF: the same Giphy search as everywhere else (GifSearchPanel).
 */
export function CommentPickerPanel({
  kind,
  height,
  recents,
  onEmoji,
  onGif,
}: {
  kind: CommentPickerKind;
  height: number;
  recents: string[];
  onEmoji: (emoji: string) => void;
  onGif: (gifUrl: string) => void;
}) {
  const { t } = useCommentToolsText();
  const [emojiStyle] = useEmojiStyle();
  const recentHeight = recents.length > 0 ? RECENT_ROW_HEIGHT : 0;

  return (
    <div
      role="region"
      aria-label={kind === "emoji" ? t.picker.emojiTab : t.picker.label}
      className="flex shrink-0 flex-col overflow-hidden border-t border-line bg-surface"
      style={{ height }}
    >
      {kind === "gif" ? (
        <GifSearchPanel onSelect={onGif} gridClassName="grid-cols-3" />
      ) : (
        <>
          {recents.length > 0 && (
            <div
              role="group"
              aria-label={t.picker.recent}
              className="flex shrink-0 items-center gap-1 overflow-x-auto px-2"
              style={{ height: RECENT_ROW_HEIGHT }}
            >
              {recents.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onEmoji(emoji)}
                  className="shrink-0 rounded-md p-1 text-2xl leading-none hover:bg-line"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
          <EmojiPicker
            theme={THEME_AUTO}
            emojiStyle={emojiStyle as EmojiStyle}
            className="wa-emoji-picker"
            width="100%"
            height={Math.max(160, height - recentHeight)}
            autoFocusSearch={false}
            lazyLoadEmojis
            searchPlaceholder={t.picker.searchEmoji}
            previewConfig={{ showPreview: false }}
            categories={CATEGORY_ORDER.map((category) => ({
              category: category as Categories,
              name: t.picker.categories[category],
            }))}
            style={{ "--epr-emoji-size": "28px", border: "none", borderRadius: 0 } as CSSProperties}
            onEmojiClick={(data) => onEmoji(data.emoji)}
          />
        </>
      )}
    </div>
  );
}
