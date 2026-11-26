import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StyledPostText } from "@/components/styled-post-text";
import { PostBackgroundPicker, nextBackgroundOption } from "@/components/post-background-picker";
import { POST_BACKGROUND_KEYS, postBackgroundStyle, styledPostTextSize } from "@/lib/post-backgrounds";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { SUPPORTED_LOCALES } from "@/lib/i18n/locales";

// The colored-background post as the feed draws it (StyledPostText) and the composer's background picker, rendered on
// the server: colors only from the catalogue, React-escaped text, readable links, the clamp, and an accessible radio
// group named in every language.

function renderStyled(props: Partial<Parameters<typeof StyledPostText>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(StyledPostText, { text: "Hello world", backgroundKey: "sunset", clamp: true, href: "/post/p1", ...props }),
  );
}

describe("StyledPostText", () => {
  it("draws the preset's own background and text color", () => {
    const html = renderStyled();
    const style = postBackgroundStyle("sunset")!;
    expect(html).toContain('data-post-background="sunset"');
    expect(html).toContain(`color:${style.color}`);
    expect(html).toContain("linear-gradient(135deg, #9a3412, #be123c, #7e22ce)");
    expect(html).toContain("Hello world");
  });

  it("escapes the text: nothing in a post renders as HTML", () => {
    const html = renderStyled({ text: '<img src=x onerror="alert(1)"><b>bold</b>' });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;img");
  });

  it("renders nothing for a key the catalogue doesn't have", () => {
    for (const key of ["", "red", "background:url(x)", null, undefined]) {
      expect(renderStyled({ backgroundKey: key as string | null })).toBe("");
    }
  });

  it("links keep the preset's text color (inherited), underlined", () => {
    const html = renderStyled({ text: "see https://example.com/page now" });
    const link = html.match(/<a [^>]*href="https:\/\/example\.com\/page"[^>]*>/)?.[0] ?? "";
    expect(link).toContain('class="underline"');
    expect(link).toContain('rel="noopener noreferrer"');
    expect(link).not.toMatch(/text-(accent|blue|primary)/);
  });

  it("clamps in a list and shows everything on the post's own page", () => {
    const text = "x".repeat(200);
    const { maxLines, fontSizeRem } = styledPostTextSize(text);
    const listed = renderStyled({ text });
    expect(listed).toContain(`-webkit-line-clamp:${maxLines}`);
    expect(listed).toContain("max-h-[28rem]");
    expect(listed).toContain(`font-size:${fontSizeRem}rem`);
    const full = renderStyled({ text, clamp: false });
    expect(full).not.toContain("line-clamp");
    expect(full).not.toContain("max-h-[28rem]");
  });

  it("has a fixed shape (no layout shift) and a reduced-motion-aware entrance", () => {
    const html = renderStyled();
    expect(html).toContain("aspect-square");
    expect(html).toContain("animate-styled-post-in");
    expect(html).toContain('dir="auto"');
  });
});

describe("PostBackgroundPicker", () => {
  const render = (value: (typeof POST_BACKGROUND_KEYS)[number] | null) =>
    renderToStaticMarkup(createElement(PostBackgroundPicker, { value, onChange: () => {} }));

  it("is one named radio group: 'No background' then every preset, with one tab stop on the checked option", () => {
    const html = render("ocean");
    expect(html).toMatch(/role="radiogroup"[^>]*aria-label="Post background"/);
    const radios = html.match(/<button [^>]*role="radio"[^>]*>/g) ?? [];
    expect(radios).toHaveLength(POST_BACKGROUND_KEYS.length + 1);
    expect(radios[0]).toContain('aria-label="No background"');
    expect(radios.filter((r) => r.includes('aria-checked="true"'))).toHaveLength(1);
    expect(radios.filter((r) => r.includes('tabindex="0"'))).toHaveLength(1);
    expect(radios.find((r) => r.includes('aria-checked="true"'))).toContain('aria-label="Ocean"');
    for (const radio of radios) expect(radio).toContain("h-11 w-11");
  });

  it("checks 'No background' when nothing is picked", () => {
    const radios = render(null).match(/<button [^>]*role="radio"[^>]*>/g) ?? [];
    expect(radios[0]).toContain('aria-checked="true"');
  });

  it("moves with the arrow keys, wrapping round, mirrored right to left", () => {
    expect(nextBackgroundOption(null, "ArrowRight", false)).toBe(POST_BACKGROUND_KEYS[0]);
    expect(nextBackgroundOption(null, "ArrowLeft", false)).toBe(POST_BACKGROUND_KEYS.at(-1));
    expect(nextBackgroundOption(POST_BACKGROUND_KEYS[0], "ArrowLeft", false)).toBeNull();
    expect(nextBackgroundOption(null, "ArrowLeft", true)).toBe(POST_BACKGROUND_KEYS[0]);
    expect(nextBackgroundOption(POST_BACKGROUND_KEYS[0], "ArrowRight", true)).toBeNull();
    expect(nextBackgroundOption(POST_BACKGROUND_KEYS[3], "ArrowDown", true)).toBe(POST_BACKGROUND_KEYS[4]);
    expect(nextBackgroundOption(POST_BACKGROUND_KEYS[3], "Home", false)).toBeNull();
    expect(nextBackgroundOption(null, "End", false)).toBe(POST_BACKGROUND_KEYS.at(-1));
    expect(nextBackgroundOption(null, "Enter", false)).toBeUndefined();
  });

  it.each(SUPPORTED_LOCALES)("names every preset in %s", (locale) => {
    const text = DICTIONARIES[locale].feed.composer.background;
    expect(Object.keys(text.names).sort()).toEqual([...POST_BACKGROUND_KEYS].sort());
    for (const key of POST_BACKGROUND_KEYS) expect(text.names[key].trim(), key).not.toBe("");
    expect(text.label.trim()).not.toBe("");
    expect(text.none.trim()).not.toBe("");
  });
});
