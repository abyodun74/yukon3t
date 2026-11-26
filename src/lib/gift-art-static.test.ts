import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GiftArt } from "@/components/gift-art";
import { GIFT_SVG_ASSET_KEYS } from "@/lib/gift-assets";

// Gift art is static: every in-repo SVG stays within its 8 KB budget with no SMIL animation, and the picker's universe
// ornaments never animate. (The two hand-made Lottie gifts were removed 2026-11-25: every gift's picture is its static
// art, and the reveal's motion comes from the tier effects, the stage and the 3D layer.)

const ROOT = process.cwd();

describe("in-repo SVG art", () => {
  it.each(GIFT_SVG_ASSET_KEYS.map((k) => [k]))("%s stays within 8 KB and is static (no SMIL animation)", (key) => {
    const html = renderToStaticMarkup(createElement(GiftArt, { assetKey: key, name: key, size: 64 }));
    expect(html.startsWith("<svg")).toBe(true);
    expect(Buffer.byteLength(html, "utf8")).toBeLessThanOrEqual(8 * 1024);
    expect(html).not.toMatch(/<animate|<set\b|<script/);
  });
});

describe("the picker's universe styles", () => {
  it("never animate: the ornaments are static, so nothing moves when the picker opens (owner decision 2026-11-13)", () => {
    const css = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
    const start = css.indexOf("Gift universes (Phase A");
    expect(start).toBeGreaterThan(0);
    const section = css.slice(start);
    expect(section).not.toMatch(/\banimation(-name)?\s*:/);
    expect(section).not.toMatch(/@keyframes/);
  });
});

describe("the signature motions' styles", () => {
  it("sit above the universes' section and hold only final poses (the motion is the plan's, via the Web Animations API)", () => {
    const css = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
    const start = css.indexOf("Gift signature motions (");
    const end = css.indexOf("The hearts that float up", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(start).toBeLessThan(css.indexOf("Gift universes (Phase A"));
    const section = css.slice(start, end);
    expect(section).not.toMatch(/\banimation(-name)?\s*:/);
    expect(section).not.toMatch(/@keyframes|will-change\s*:|\bfilter\s*:/);
  });
});

describe("gift animation players", () => {
  it("ships no Lottie player or Lottie files (removed 2026-11-25)", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["lottie-web"]).toBeUndefined();
  });

  it("needs no 'unsafe-eval' in production: the production script-src doesn't allow it", () => {
    const proxy = readFileSync(path.join(ROOT, "src/proxy.ts"), "utf8");
    const production = proxy.match(/process\.env\.NODE_ENV === "production"\s*\?\s*`([^`]*)`/);
    expect(production).not.toBeNull();
    expect(production![1]).not.toMatch(/unsafe-eval|wasm-unsafe-eval/);
  });
});
