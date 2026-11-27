/*
 * Colored-background ("styled") text posts and colored video frames: the preset catalogue and its rules. Pure and
 * client-safe. The same presets also frame a VIDEO post (the whole video, uncropped, inset on the background; see
 * styledPostRefusal and PostCard's FramedVideo), in which case the text color is unused.
 *
 * A styled post is a text-only post (mediaType NONE, no event, not a repost/share) whose `Post.backgroundStyle` holds
 * one of the preset keys below. Only the key is ever stored or accepted from a client: the CSS is always built here,
 * from this typed catalogue, so no client-chosen color or CSS string ever reaches the database or a style attribute.
 * A key the catalogue no longer has (a preset removed later) renders as an ordinary text post.
 *
 * Every preset's text color is checked against every point of its background (post-backgrounds.test.ts asserts WCAG
 * contrast >= 4.5:1 at the worst point of each gradient), so no preset needs a text shadow. Links and "Show more" in
 * a styled post use the same text color, underlined, which is what keeps them readable on every preset.
 */

/** Longest text a styled post can carry (UTF-16 length after trimming, the same count as the textarea's maxLength). */
export const STYLED_POST_MAX_CHARS = 220;

const WHITE = "#ffffff";
const DARK = "#111418";

type Hex = `#${string}`;

type PresetShape =
  | { kind: "solid"; color: Hex }
  | { kind: "linear"; angle: number; stops: readonly Hex[] }
  | { kind: "radial"; at: string; stops: readonly Hex[] }
  /** A solid base with a small repeating dot of a second color. */
  | { kind: "dots"; base: Hex; dot: Hex };

type Preset = { shape: PresetShape; text: Hex };

/** The catalogue, in picker order (most colorful first). Keys are stable: they are what's stored on a post. */
const PRESETS = {
  sunset: { shape: { kind: "linear", angle: 135, stops: ["#9a3412", "#be123c", "#7e22ce"] }, text: WHITE },
  aurora: { shape: { kind: "linear", angle: 135, stops: ["#134e4a", "#1d4ed8", "#7e22ce"] }, text: WHITE },
  ocean: { shape: { kind: "linear", angle: 135, stops: ["#0c4a6e", "#0369a1", "#0e7490"] }, text: WHITE },
  candy: { shape: { kind: "linear", angle: 135, stops: ["#f9a8d4", "#c4b5fd", "#93c5fd"] }, text: DARK },
  neon: { shape: { kind: "linear", angle: 135, stops: ["#c026d3", "#7c3aed", "#2563eb"] }, text: WHITE },
  gold: { shape: { kind: "linear", angle: 135, stops: ["#fde68a", "#fbbf24", "#f59e0b"] }, text: DARK },
  forest: { shape: { kind: "linear", angle: 160, stops: ["#14532d", "#166534", "#3f6212"] }, text: WHITE },
  midnight: { shape: { kind: "linear", angle: 180, stops: ["#0f172a", "#1e1b4b", "#312e81"] }, text: WHITE },
  peach: { shape: { kind: "linear", angle: 135, stops: ["#fed7aa", "#fda4af"] }, text: DARK },
  mint: { shape: { kind: "linear", angle: 135, stops: ["#a7f3d0", "#99f6e4", "#bae6fd"] }, text: DARK },
  glow: { shape: { kind: "radial", at: "30% 20%", stops: ["#7c3aed", "#1e1b4b"] }, text: WHITE },
  ember: { shape: { kind: "radial", at: "50% 100%", stops: ["#c2410c", "#450a0a"] }, text: WHITE },
  dots: { shape: { kind: "dots", base: "#1e3a8a", dot: "#1d4ed8" }, text: WHITE },
  ink: { shape: { kind: "solid", color: "#14181a" }, text: WHITE },
  royal: { shape: { kind: "solid", color: "#3654ff" }, text: WHITE },
  crimson: { shape: { kind: "solid", color: "#be123c" }, text: WHITE },
  emerald: { shape: { kind: "solid", color: "#047857" }, text: WHITE },
  violet: { shape: { kind: "solid", color: "#6d28d9" }, text: WHITE },
  sunflower: { shape: { kind: "solid", color: "#fbbf24" }, text: DARK },
  sky: { shape: { kind: "solid", color: "#7dd3fc" }, text: DARK },
  blush: { shape: { kind: "solid", color: "#fbcfe8" }, text: DARK },
} as const satisfies Record<string, Preset>;

export type PostBackgroundKey = keyof typeof PRESETS;

/** Every preset key, in picker order: the allow-list the server validates against (validations.ts). */
export const POST_BACKGROUND_KEYS = Object.keys(PRESETS) as [PostBackgroundKey, ...PostBackgroundKey[]];

export function isPostBackgroundKey(value: unknown): value is PostBackgroundKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PRESETS, value);
}

function cssBackground(shape: PresetShape): string {
  switch (shape.kind) {
    case "solid":
      return shape.color;
    case "linear":
      return `linear-gradient(${shape.angle}deg, ${shape.stops.join(", ")})`;
    case "radial":
      return `radial-gradient(circle at ${shape.at}, ${shape.stops.join(", ")})`;
    case "dots":
      return `radial-gradient(${shape.dot} 2px, transparent 2.5px) 0 0 / 18px 18px, ${shape.base}`;
  }
}

export type PostBackgroundStyle = { background: string; color: string };

/** The inline style for a stored key, or null for no key / a key the catalogue doesn't have. */
export function postBackgroundStyle(key: string | null | undefined): PostBackgroundStyle | null {
  if (!isPostBackgroundKey(key)) return null;
  const preset: Preset = PRESETS[key];
  return { background: cssBackground(preset.shape), color: preset.text };
}

/**
 * The colors of a preset in the order a gradient runs through them (a solid is one color; the dot pattern is its base
 * then its dot, since an anti-aliased dot edge blends between the two). The contrast test samples every point between
 * neighbours.
 */
export function postBackgroundColorRun(key: PostBackgroundKey): readonly string[] {
  const shape: PresetShape = PRESETS[key].shape;
  switch (shape.kind) {
    case "solid":
      return [shape.color];
    case "dots":
      return [shape.base, shape.dot];
    default:
      return shape.stops;
  }
}

export function postBackgroundTextColor(key: PostBackgroundKey): string {
  return PRESETS[key].text;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance([r, g, b]: readonly number[]): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2 contrast ratio of two sRGB colors given as [r, g, b] (0-255). */
export function contrastRatio(a: readonly number[], b: readonly number[]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The lowest contrast between the preset's text color and any point of its background, sampling `steps` points
 * between each pair of neighbouring colors (browsers interpolate hex-color gradients in sRGB).
 */
export function worstContrast(key: PostBackgroundKey, steps = 100): number {
  const text = rgb(postBackgroundTextColor(key));
  const run = postBackgroundColorRun(key).map(rgb);
  if (run.length === 1) return contrastRatio(run[0], text);
  let worst = Infinity;
  for (let i = 0; i < run.length - 1; i++) {
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const point = run[i].map((v, c) => v + (run[i + 1][c] - v) * t);
      worst = Math.min(worst, contrastRatio(point, text));
    }
  }
  return worst;
}

export type StyledTextSize = { fontSizeRem: number; lineHeight: number; maxLines: number };

/**
 * Font size for a styled post: the shorter the text, the bigger. Each line break counts as 20 characters (a short line
 * still takes a whole row). Sized so the longest allowed text fits a square card on a ~340px-wide phone; `maxLines` is
 * the clamp the feed applies (the full text is on the post's own page).
 */
export function styledPostTextSize(text: string): StyledTextSize {
  const trimmed = text.trim();
  const breaks = (trimmed.match(/\n/g) ?? []).length;
  const weight = trimmed.length + breaks * 20;
  if (weight <= 40) return { fontSizeRem: 1.875, lineHeight: 1.2, maxLines: 6 };
  if (weight <= 90) return { fontSizeRem: 1.5, lineHeight: 1.25, maxLines: 8 };
  if (weight <= 150) return { fontSizeRem: 1.25, lineHeight: 1.3, maxLines: 10 };
  return { fontSizeRem: 1.125, lineHeight: 1.35, maxLines: 12 };
}

export type StyledPostRefusal = "background_not_allowed" | "background_too_long";

/**
 * Whether a post may carry a background:
 * - a text-only post (no media, embed, link, GIF, event, repost or share) with text of at most STYLED_POST_MAX_CHARS;
 * - the author's own uploaded VIDEO (not an embed), as a colored frame around the whole video. Its caption stays
 *   ordinary text with no length limit of its own, and the video file itself is never touched (the frame is drawn
 *   by the app).
 * Used by createPost and editPost; the composer enforces the same.
 */
export function styledPostRefusal(input: {
  mediaType: string;
  hasEvent: boolean;
  isRepostOrShare: boolean;
  content: string;
}): StyledPostRefusal | null {
  if (input.hasEvent || input.isRepostOrShare) return "background_not_allowed";
  if (input.mediaType === "VIDEO") return null;
  if (input.mediaType !== "NONE") return "background_not_allowed";
  const text = input.content.trim();
  if (text.length === 0) return "background_not_allowed";
  if (text.length > STYLED_POST_MAX_CHARS) return "background_too_long";
  return null;
}

/** A VIDEO post shown in a colored frame: its own uploaded video plus a background key the catalogue has. */
export function isFramedVideo(post: { mediaType: string; backgroundStyle?: string | null }): boolean {
  return post.mediaType === "VIDEO" && isPostBackgroundKey(post.backgroundStyle);
}
