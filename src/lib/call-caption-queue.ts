// The captions on screen during a call: the other person's latest sentences, each shown until
// CALL_CAPTION_VISIBLE_MS after it last changed, at most CALL_CAPTION_MAX_VISIBLE at once. Pure (time is passed in),
// so the fade and the queue are unit-tested; the call screen keeps the list in React state and re-renders on a timer.
// Lives only in memory: nothing here is stored or logged.

import { CALL_CAPTION_MAX_VISIBLE, CALL_CAPTION_VISIBLE_MS } from "@/lib/call-captions";

export type CaptionTranslation =
  /** Asking the server. The original is shown meanwhile. */
  | { status: "pending" }
  /** Already in the reader's language (or translation was skipped): show the original as it is. */
  | { status: "same" }
  | { status: "translated"; text: string }
  /** Couldn't translate (rate limit, outage): show the original. */
  | { status: "failed" };

export type CaptionItem = {
  id: string;
  original: string;
  translation: CaptionTranslation;
  /** When it last changed (arrived, or its translation arrived); it fades CALL_CAPTION_VISIBLE_MS after this. */
  updatedAt: number;
};

/** Adds a sentence (ignored if that id is already there), keeping only the newest CALL_CAPTION_MAX_VISIBLE. */
export function addCaption(
  items: readonly CaptionItem[],
  caption: { id: string; text: string; translation: CaptionTranslation },
  now: number,
): CaptionItem[] {
  if (items.some((i) => i.id === caption.id)) return [...items];
  const next = [...items, { id: caption.id, original: caption.text, translation: caption.translation, updatedAt: now }];
  return next.slice(-CALL_CAPTION_MAX_VISIBLE);
}

/** Records the translation of one sentence (and restarts its time on screen); unknown ids are ignored. */
export function setCaptionTranslation(
  items: readonly CaptionItem[],
  id: string,
  translation: CaptionTranslation,
  now: number,
): CaptionItem[] {
  return items.map((i) => (i.id === id ? { ...i, translation, updatedAt: now } : i));
}

/** The captions still on screen at `now`. Returns the same array when nothing expired (so React can skip a render). */
export function visibleCaptions(items: CaptionItem[], now: number): CaptionItem[] {
  const kept = items.filter((i) => now - i.updatedAt < CALL_CAPTION_VISIBLE_MS);
  return kept.length === items.length ? items : kept;
}

/** When the next caption on screen expires, or null when there are none (for the fade timer). */
export function nextExpiryAt(items: readonly CaptionItem[]): number | null {
  if (items.length === 0) return null;
  return Math.min(...items.map((i) => i.updatedAt + CALL_CAPTION_VISIBLE_MS));
}

/** The text to show for a caption: the translation when there is one and the reader hasn't asked for the original. */
export function captionDisplayText(item: CaptionItem, showOriginal: boolean): string {
  if (!showOriginal && item.translation.status === "translated") return item.translation.text;
  return item.original;
}
