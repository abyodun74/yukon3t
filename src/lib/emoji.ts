const EMOJI_CLUSTER_RE = /^[\p{Extended_Pictographic}‍️\u{1F3FB}-\u{1F3FF}]+$/u;

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
