import { describe, expect, it } from "vitest";
import {
  POST_BACKGROUND_KEYS,
  STYLED_POST_MAX_CHARS,
  contrastRatio,
  isFramedVideo,
  isPostBackgroundKey,
  postBackgroundColorRun,
  postBackgroundStyle,
  postBackgroundTextColor,
  styledPostRefusal,
  styledPostTextSize,
  worstContrast,
} from "@/lib/post-backgrounds";
import { postBackgroundKeySchema } from "@/lib/validations";

// Colored-background text posts: the preset catalogue (stable keys, CSS built only from it, readable text on every
// point of every background), the font-size scale, and the text-only / length rule createPost and editPost apply.

describe("post background catalogue", () => {
  it("has between 16 and 24 presets with unique, stable-looking keys", () => {
    expect(POST_BACKGROUND_KEYS.length).toBeGreaterThanOrEqual(16);
    expect(POST_BACKGROUND_KEYS.length).toBeLessThanOrEqual(24);
    expect(new Set(POST_BACKGROUND_KEYS).size).toBe(POST_BACKGROUND_KEYS.length);
    for (const key of POST_BACKGROUND_KEYS) expect(key).toMatch(/^[a-z]+$/);
  });

  it("offers solid colors, linear gradients, radial gradients and a multicolor mix", () => {
    const styles = POST_BACKGROUND_KEYS.map((key) => postBackgroundStyle(key)!.background);
    expect(styles.some((s) => /^#[0-9a-f]{6}$/.test(s))).toBe(true);
    expect(styles.some((s) => s.startsWith("linear-gradient("))).toBe(true);
    expect(styles.some((s) => s.startsWith("radial-gradient(circle"))).toBe(true);
    expect(POST_BACKGROUND_KEYS.some((key) => postBackgroundColorRun(key).length >= 3)).toBe(true);
  });

  it("builds every background from hex colors only (nothing but the catalogue's own values)", () => {
    for (const key of POST_BACKGROUND_KEYS) {
      for (const color of postBackgroundColorRun(key)) expect(color, key).toMatch(/^#[0-9a-f]{6}$/);
      expect(postBackgroundTextColor(key), key).toMatch(/^#[0-9a-f]{6}$/);
      const css = postBackgroundStyle(key)!.background;
      expect(css, key).not.toMatch(/url\(|expression|;|[<>"'{}]/i);
    }
  });

  it.each(POST_BACKGROUND_KEYS)("%s: text has at least 4.5:1 contrast at the worst point of the background", (key) => {
    expect(worstContrast(key)).toBeGreaterThanOrEqual(4.5);
  });

  it("measures contrast the WCAG way", () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrastRatio([255, 255, 255], [255, 255, 255])).toBe(1);
    // #767676 on white is the textbook 4.54:1.
    expect(contrastRatio([0x76, 0x76, 0x76], [255, 255, 255])).toBeCloseTo(4.54, 2);
  });

  it("knows only its own keys", () => {
    expect(isPostBackgroundKey("sunset")).toBe(true);
    for (const value of ["", "Sunset", "red", "#ff0000", "linear-gradient(red, blue)", "toString", "__proto__", null, 3]) {
      expect(isPostBackgroundKey(value), String(value)).toBe(false);
      expect(postBackgroundStyle(value as string)).toBeNull();
    }
    expect(postBackgroundStyle(null)).toBeNull();
    expect(postBackgroundStyle(undefined)).toBeNull();
  });

  it("validates through the same allow-list on the server", () => {
    for (const key of POST_BACKGROUND_KEYS) expect(postBackgroundKeySchema.safeParse(key).success).toBe(true);
    for (const value of ["", "red", "#000000", "background:url(x)", "SUNSET"]) {
      expect(postBackgroundKeySchema.safeParse(value).success, value).toBe(false);
    }
  });
});

describe("styledPostTextSize", () => {
  it("shrinks the font as the text grows, never below a readable size", () => {
    const sizes = ["Hi!", "x".repeat(60), "x".repeat(120), "x".repeat(STYLED_POST_MAX_CHARS)].map(
      (t) => styledPostTextSize(t).fontSizeRem,
    );
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeLessThan(sizes[i - 1]);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(1.125);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(2);
  });

  it("counts line breaks as extra length, and ignores surrounding whitespace", () => {
    expect(styledPostTextSize("a\nb\nc\nd").fontSizeRem).toBeLessThan(styledPostTextSize("abcd").fontSizeRem);
    expect(styledPostTextSize(`   ${"x".repeat(30)}   \n\n`)).toEqual(styledPostTextSize("x".repeat(30)));
  });

  it("gives smaller text more lines before the feed clamps it", () => {
    const short = styledPostTextSize("Hello");
    const long = styledPostTextSize("x".repeat(200));
    expect(long.maxLines).toBeGreaterThan(short.maxLines);
  });
});

describe("styledPostRefusal", () => {
  const ok = { mediaType: "NONE", hasEvent: false, isRepostOrShare: false, content: "Good morning ☀️" };

  it("allows a short text-only post", () => {
    expect(styledPostRefusal(ok)).toBeNull();
    expect(styledPostRefusal({ ...ok, content: "x".repeat(STYLED_POST_MAX_CHARS) })).toBeNull();
    expect(styledPostRefusal({ ...ok, content: `  ${"x".repeat(STYLED_POST_MAX_CHARS)}  ` })).toBeNull();
  });

  it("refuses text over the cap", () => {
    expect(styledPostRefusal({ ...ok, content: "x".repeat(STYLED_POST_MAX_CHARS + 1) })).toBe("background_too_long");
  });

  it.each(["IMAGE", "EMBED", "LINK", "GIF"])("refuses a %s post", (mediaType) => {
    expect(styledPostRefusal({ ...ok, mediaType })).toBe("background_not_allowed");
  });

  it("allows a colored frame on an uploaded video, with a caption of any length or none", () => {
    expect(styledPostRefusal({ ...ok, mediaType: "VIDEO" })).toBeNull();
    expect(styledPostRefusal({ ...ok, mediaType: "VIDEO", content: "" })).toBeNull();
    expect(styledPostRefusal({ ...ok, mediaType: "VIDEO", content: "x".repeat(STYLED_POST_MAX_CHARS * 10) })).toBeNull();
  });

  it("refuses a frame on a video event, repost or share", () => {
    expect(styledPostRefusal({ ...ok, mediaType: "VIDEO", hasEvent: true })).toBe("background_not_allowed");
    expect(styledPostRefusal({ ...ok, mediaType: "VIDEO", isRepostOrShare: true })).toBe("background_not_allowed");
  });

  it("knows a framed video only by its own uploaded video and a catalogue key", () => {
    expect(isFramedVideo({ mediaType: "VIDEO", backgroundStyle: "sunset" })).toBe(true);
    expect(isFramedVideo({ mediaType: "VIDEO", backgroundStyle: null })).toBe(false);
    expect(isFramedVideo({ mediaType: "VIDEO", backgroundStyle: "removed-later" })).toBe(false);
    expect(isFramedVideo({ mediaType: "EMBED", backgroundStyle: "sunset" })).toBe(false);
    expect(isFramedVideo({ mediaType: "NONE", backgroundStyle: "sunset" })).toBe(false);
  });

  it("refuses an event, a repost or share, and an empty post", () => {
    expect(styledPostRefusal({ ...ok, hasEvent: true })).toBe("background_not_allowed");
    expect(styledPostRefusal({ ...ok, isRepostOrShare: true })).toBe("background_not_allowed");
    expect(styledPostRefusal({ ...ok, content: "   " })).toBe("background_not_allowed");
  });
});
