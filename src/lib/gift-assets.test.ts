import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GiftArt } from "@/components/gift-art";
import { GIFT_IMAGE_ASSETS, GIFT_SVG_ASSET_KEYS, resolveGiftArt } from "@/lib/gift-assets";
import { GIFT_ITEMS } from "@/lib/gifts-data";
import { giftItemName } from "@/lib/gift-names";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { SUPPORTED_LOCALES } from "@/lib/i18n/locales";

/** Width and height from a WebP file's header (lossy "VP8 " or extended "VP8X"; sharp writes one of these). */
function webpSize(file: Buffer): { width: number; height: number } {
  expect(file.toString("ascii", 0, 4)).toBe("RIFF");
  expect(file.toString("ascii", 8, 12)).toBe("WEBP");
  const chunk = file.toString("ascii", 12, 16);
  if (chunk === "VP8X") {
    return { width: 1 + file.readUIntLE(24, 3), height: 1 + file.readUIntLE(27, 3) };
  }
  expect(chunk).toBe("VP8 ");
  return { width: file.readUInt16LE(26) & 0x3fff, height: file.readUInt16LE(28) & 0x3fff };
}

const publicFile = (src: string) => path.join(process.cwd(), "public", src);

describe("gift art resolution", () => {
  it("resolves the Luxury Red Rose to its raster picture, with both sizes in srcSet", () => {
    const art = resolveGiftArt("luxury-red-rose");
    expect(art).toMatchObject({
      type: "image",
      src: "/gifts/luxury-red-rose.webp",
      thumbSrc: "/gifts/luxury-red-rose-256.webp",
      width: 768,
      height: 768,
      srcSet: "/gifts/luxury-red-rose-256.webp 256w, /gifts/luxury-red-rose.webp 768w",
    });
  });

  it("resolves the drawn gifts to their SVG, and anything unknown to the sparkle", () => {
    expect(resolveGiftArt("rose")).toEqual({ type: "svg", key: "rose" });
    expect(resolveGiftArt("aurora-frame")).toEqual({ type: "svg", key: "aurora-frame" });
    expect(resolveGiftArt("not-a-gift")).toEqual({ type: "svg", key: "sparkle" });
    expect(resolveGiftArt("toString")).toEqual({ type: "svg", key: "sparkle" });
    expect(resolveGiftArt("__proto__")).toEqual({ type: "svg", key: "sparkle" });
  });

  it("has art for every catalog item (none falls back to the sparkle), and no key is both kinds", () => {
    for (const item of GIFT_ITEMS) {
      const art = resolveGiftArt(item.assetKey);
      if (art.type === "svg") expect(art.key, item.slug).toBe(item.assetKey);
    }
    for (const key of Object.keys(GIFT_IMAGE_ASSETS)) {
      expect(GIFT_SVG_ASSET_KEYS as readonly string[]).not.toContain(key);
    }
  });

  it.each(Object.entries(GIFT_IMAGE_ASSETS))("ships web-ready files for %s, same-origin, within budget", (_key, asset) => {
    for (const src of [asset.src, asset.thumbSrc]) expect(src).toMatch(/^\/gifts\/[a-z0-9-]+\.webp$/);
    const large = readFileSync(publicFile(asset.src));
    const thumb = readFileSync(publicFile(asset.thumbSrc));
    expect(webpSize(large)).toEqual({ width: asset.width, height: asset.height });
    expect(webpSize(thumb)).toEqual({ width: asset.thumbWidth, height: asset.thumbHeight });
    expect(statSync(publicFile(asset.src)).size).toBeLessThan(120 * 1024);
    expect(statSync(publicFile(asset.thumbSrc)).size).toBeLessThan(25 * 1024);
  });
});

describe("GiftArt", () => {
  it("renders a raster gift as a lazy, sized <img> with the localized name as alt text, in a rounded card", () => {
    const html = renderToStaticMarkup(createElement(GiftArt, { assetKey: "luxury-red-rose", name: "Rosa roja de lujo", size: 44 }));
    expect(html).toContain('alt="Rosa roja de lujo"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('width="44"');
    expect(html).toContain('height="44"');
    expect(html).toContain('sizes="44px"');
    expect(html).toContain('src="/gifts/luxury-red-rose-256.webp"');
    expect(html).toContain("object-cover");
    expect(html).toContain("rounded-[22%]");
    expect(html).not.toContain("<svg");
  });

  it("loads eagerly when asked (art on screen as soon as it mounts, e.g. the open-gift overlay)", () => {
    const html = renderToStaticMarkup(createElement(GiftArt, { assetKey: "luxury-red-rose", name: "x", size: 160, eager: true }));
    expect(html).toContain('loading="eager"');
  });

  it("still draws the SVG gifts, decorative and unchanged", () => {
    const html = renderToStaticMarkup(createElement(GiftArt, { assetKey: "rose", name: "Rose", size: 48 }));
    expect(html).toMatch(/^<svg/);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("<img");
  });
});

describe("Luxury Red Rose names", () => {
  const expected: Record<string, string> = {
    en: "Luxury Red Rose",
    es: "Rosa roja de lujo",
    fr: "Rose rouge de luxe",
    pt: "Rosa vermelha de luxo",
  };
  it.each(SUPPORTED_LOCALES)("is named and described in %s", (locale) => {
    const t = DICTIONARIES[locale].gifts;
    const name = giftItemName(t, "luxury-red-rose");
    expect(name).not.toBe("luxury-red-rose");
    if (expected[locale]) expect(name).toBe(expected[locale]);
    expect(t.items["luxury-red-rose"].description.length).toBeGreaterThan(0);
  });
});
