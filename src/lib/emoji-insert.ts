// Inserting an emoji (or any text) into a composer at the caret, and the "recently used" emoji list. Pure and
// client-safe; the browser parts (reading the caret, localStorage) stay in the components and in the two small
// storage wrappers at the end, which never throw.

export type Selection = { start: number; end: number };

/** Grapheme boundaries of `text` (UTF-16 offsets), when the runtime can segment; null otherwise. */
function graphemeBoundaries(text: string): number[] | null {
  const Segmenter = (Intl as unknown as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (!Segmenter) return null;
  const out = [0];
  for (const { index, segment } of new Segmenter(undefined, { granularity: "grapheme" }).segment(text)) {
    out.push(index + segment.length);
  }
  return out;
}

/**
 * Moves an offset that falls inside a character (half of a surrogate pair, the middle of a ZWJ sequence or a flag) to
 * that character's start (`dir` -1) or end (`dir` 1), so an insertion never splits it.
 */
export function snapToCharacter(text: string, offset: number, dir: -1 | 1): number {
  const at = Math.max(0, Math.min(text.length, Math.trunc(offset) || 0));
  const bounds = graphemeBoundaries(text);
  if (bounds) {
    if (bounds.includes(at)) return at;
    return dir < 0 ? Math.max(...bounds.filter((b) => b < at)) : Math.min(...bounds.filter((b) => b > at));
  }
  // No Intl.Segmenter: at least never split a surrogate pair.
  const code = text.charCodeAt(at);
  const prev = text.charCodeAt(at - 1);
  const insidePair = at > 0 && at < text.length && code >= 0xdc00 && code <= 0xdfff && prev >= 0xd800 && prev <= 0xdbff;
  return insidePair ? at + (dir < 0 ? -1 : 1) : at;
}

/**
 * `insert` put in place of the selection (or at the caret when start == end), with the caret just after it. A null
 * selection (the field was never focused) appends. Refused (null) when the result would pass `maxLength` UTF-16 units,
 * the same measure as the input's maxLength and the server's check, so an emoji is never cut in half to fit.
 */
export function insertAtSelection(
  text: string,
  selection: Selection | null,
  insert: string,
  maxLength = Infinity,
): { text: string; caret: number } | null {
  let start = selection ? Math.min(selection.start, selection.end) : text.length;
  let end = selection ? Math.max(selection.start, selection.end) : text.length;
  const collapsed = start === end;
  start = snapToCharacter(text, start, -1);
  // A caret inside a character moves to its start; a selection grows to cover whole characters at both ends.
  end = collapsed ? start : snapToCharacter(text, end, 1);
  const next = text.slice(0, start) + insert + text.slice(end);
  if (next.length > maxLength) return null;
  return { text: next, caret: start + insert.length };
}

// ---------------------------------------------------------------------------------------------------------------
// Recently used emoji (newest first), kept per device in localStorage.

export const RECENT_EMOJI_STORAGE_KEY = "yk-recent-emoji";
export const RECENT_EMOJI_MAX = 16;

/** `emoji` moved (or added) to the front, without duplicates, capped at `max`. */
export function pushRecentEmoji(list: readonly string[], emoji: string, max = RECENT_EMOJI_MAX): string[] {
  const value = emoji.trim();
  if (!value) return list.slice(0, max);
  return [value, ...list.filter((e) => e !== value)].slice(0, max);
}

/** A stored value read back: only short non-empty strings, deduplicated, capped. Anything else is an empty list. */
export function parseRecentEmoji(raw: string | null | undefined, max = RECENT_EMOJI_MAX): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    for (const item of parsed) {
      if (typeof item !== "string") continue;
      const value = item.trim();
      if (!value || value.length > 32 || out.includes(value)) continue;
      out.push(value);
      if (out.length >= max) break;
    }
    return out;
  } catch {
    return [];
  }
}

/** Never throws (private mode, blocked site data, a WebView without storage): an empty list instead. */
export function readRecentEmoji(storage: Pick<Storage, "getItem"> | null | undefined): string[] {
  try {
    return parseRecentEmoji(storage?.getItem(RECENT_EMOJI_STORAGE_KEY));
  } catch {
    return [];
  }
}

/** Never throws; a failed write just means the list isn't remembered. */
export function writeRecentEmoji(storage: Pick<Storage, "setItem"> | null | undefined, list: readonly string[]): void {
  try {
    storage?.setItem(RECENT_EMOJI_STORAGE_KEY, JSON.stringify(list.slice(0, RECENT_EMOJI_MAX)));
  } catch {
    // Quota or blocked storage: keep going without it.
  }
}

/** window.localStorage, or null where even reading the property throws. */
export function safeLocalStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
