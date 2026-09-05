const EMOJI_CLUSTER_RE = /^[\p{Extended_Pictographic}‍️\u{1F3FB}-\u{1F3FF}]+$/u;

// Shared quick-reaction set — a WhatsApp-style row of common reactions
// shown before the full emoji picker (see EmojiPickerButton's
// `quickReactions` prop), so posts, messages, and stories all offer the
// same fast one-tap reactions instead of forcing the full picker open for
// something this common.
export const QUICK_REACTIONS = ["❤️", "😂", "😮", "👏", "🔥", "😢"];

/**
 * True when `text` is nothing but a handful of emoji (chat-app convention
 * for rendering emoji-only messages larger). Segments by grapheme cluster
 * first so multi-codepoint emoji (families, skin-tone variants) count as
 * one "character" rather than failing the check.
 */
export function isEmojiOnly(text: string, maxClusters = 6) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  try {
    const clusters = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(trimmed)].map(
      (s) => s.segment,
    );
    if (clusters.length === 0 || clusters.length > maxClusters) return false;
    return clusters.every((c) => EMOJI_CLUSTER_RE.test(c));
  } catch {
    return false;
  }
}
