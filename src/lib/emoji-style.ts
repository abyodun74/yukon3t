"use client";

import { useState } from "react";

export const EMOJI_STYLE_COOKIE = "yk3-emoji-style";
// Matches emoji-picker-react's own EmojiStyle enum values exactly (see
// node_modules/emoji-picker-react/src/types/exposedTypes.ts) — kept as
// plain string literals here so this file doesn't need to import the
// library just for its enum.
export const EMOJI_STYLE_VALUES = ["native", "apple", "google", "facebook", "twitter"] as const;
export type EmojiStyleValue = (typeof EMOJI_STYLE_VALUES)[number];

export function parseEmojiStyle(value: string | undefined | null): EmojiStyleValue {
  return (EMOJI_STYLE_VALUES as readonly string[]).includes(value ?? "")
    ? (value as EmojiStyleValue)
    : "native";
}

function readCookie(): EmojiStyleValue {
  if (typeof document === "undefined") return "native";
  const match = document.cookie.match(new RegExp(`(?:^|; )${EMOJI_STYLE_COOKIE}=([^;]*)`));
  return parseEmojiStyle(match?.[1]);
}

function persist(value: EmojiStyleValue) {
  document.cookie = `${EMOJI_STYLE_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * Client-only preference (same cookie pattern as theme.ts) — read fresh on
 * mount rather than threaded through props, since every consumer is already
 * a client component. Lazy initializer (not an effect) so this doesn't
 * cause a cascading extra render; readCookie() itself guards the
 * `document`-less SSR pass, and nothing renders based on this value until
 * a picker popup is actually opened well after hydration, so there's
 * nothing for an SSR/client mismatch here to visibly affect.
 */
export function useEmojiStyle(): [EmojiStyleValue, (next: EmojiStyleValue) => void] {
  const [style, setStyle] = useState<EmojiStyleValue>(() => readCookie());

  function apply(next: EmojiStyleValue) {
    setStyle(next);
    persist(next);
  }

  return [style, apply];
}
