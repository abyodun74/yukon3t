import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GiftArt } from "@/components/gift-art";
import { GiftLottie, posterFrame } from "@/components/gift-lottie";
import {
  GIFT_LOTTIE_ASSETS,
  GIFT_LOTTIE_MAX_BYTES,
  GIFT_LOTTIE_POSTER_MARKER,
  GIFT_SVG_ASSET_KEYS,
  resolveGiftAnimation,
} from "@/lib/gift-assets";
import { GIFT_ITEMS } from "@/lib/gifts-data";
import { LIVE_GIFT_EFFECT_MS } from "@/lib/gifts";

// Animated gifts (Phase A): every Lottie file is small, expression-free, self-contained (no image or font assets),
// has a "poster" still, a recorded source and licence, and a live effect is short and never flashes; the player is the
// eval-free light build, loaded only by dynamic import; reduced motion and every list show static art; every in-repo
// SVG stays within its 8 KB budget.

const ROOT = process.cwd();
const LOTTIE_DIR = path.join(ROOT, "public", "gifts", "lottie");

type Json = Record<string, unknown>;
const load = (src: string): Json => JSON.parse(readFileSync(path.join(ROOT, "public", src), "utf8"));

/** Every object in a Lottie document (depth first). */
function* objects(value: unknown): Generator<Json> {
  if (Array.isArray(value)) for (const v of value) yield* objects(v);
  else if (value && typeof value === "object") {
    yield value as Json;
    for (const v of Object.values(value)) yield* objects(v);
  }
}

/** Opacity reversals of more than 50 points per second, worst layer: a flash is a rise and a fall. */
function worstFlashesPerSecond(doc: Json): number {
  const fr = doc.fr as number;
  let worst = 0;
  for (const obj of objects(doc.layers)) {
    const o = (obj.ks as Json | undefined)?.o as { a?: number; k?: { t: number; s: number[] }[] } | undefined;
    if (!o || o.a !== 1 || !Array.isArray(o.k)) continue;
    const frames = o.k;
    let swings = 0;
    for (let i = 1; i < frames.length; i++) {
      if (Math.abs((frames[i].s?.[0] ?? 0) - (frames[i - 1].s?.[0] ?? 0)) > 50) swings += 1;
    }
    const seconds = Math.max(1 / fr, (frames.at(-1)!.t - frames[0].t) / fr);
    worst = Math.max(worst, swings / 2 / seconds);
  }
  return worst;
}

describe("Lottie gift files", () => {
  const entries = Object.entries(GIFT_LOTTIE_ASSETS);

  it("has at least the two pipeline proofs, each also drawn as a still SVG and a real catalog item", () => {
    expect(Object.keys(GIFT_LOTTIE_ASSETS).sort()).toEqual(expect.arrayContaining(["gold-orchid", "level-up"]));
    for (const [key] of entries) {
      expect(GIFT_SVG_ASSET_KEYS as readonly string[], key).toContain(key);
      expect(GIFT_ITEMS.some((i) => i.assetKey === key), key).toBe(true);
    }
    expect(resolveGiftAnimation("rose")).toBeNull();
    expect(resolveGiftAnimation("__proto__")).toBeNull();
  });

  it("has a registry entry (with its source and licence) for every file in public/gifts/lottie", () => {
    const files = readdirSync(LOTTIE_DIR).filter((f) => f.endsWith(".json"));
    expect(files.sort()).toEqual(entries.map(([, a]) => path.basename(a.src)).sort());
    for (const [key, asset] of entries) {
      expect(asset.src, key).toMatch(/^\/gifts\/lottie\/[a-z0-9-]+\.json$/);
      expect(asset.source.trim().length, key).toBeGreaterThan(0);
      expect(asset.licence.trim().length, key).toBeGreaterThan(0);
    }
  });

  it.each(entries)("%s: under the size budget, shapes only, no expressions, a poster marker", (key, asset) => {
    const file = path.join(ROOT, "public", asset.src);
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).size).toBeLessThan(GIFT_LOTTIE_MAX_BYTES);
    const doc = load(asset.src);
    expect(typeof doc.fr).toBe("number");
    expect(doc.op as number).toBeGreaterThan(doc.ip as number);
    // No image / font / audio assets: precomps only (an asset with "layers"), and nothing that points to a file.
    for (const a of (doc.assets as Json[]) ?? []) {
      expect(a.layers, `${key} asset ${String(a.id)}`).toBeDefined();
      expect(a.p, `${key} asset path`).toBeUndefined();
      expect(a.u, `${key} asset url`).toBeUndefined();
    }
    expect(doc.fonts ?? null).toBeNull();
    for (const obj of objects(doc.layers)) {
      // ty 2 image, 5 text, 6 audio layers would need files or fonts.
      if ("ind" in obj && "ks" in obj) expect([2, 5, 6], `${key} layer ${String(obj.nm)}`).not.toContain(obj.ty);
      // An expression is a string "x" on an animated property.
      expect(typeof obj.x === "string", `${key}: expression in ${String(obj.nm ?? "")}`).toBe(false);
    }
    expect(JSON.stringify(doc)).not.toMatch(/https?:|data:|\beval\b|Function\(/);
    const poster = (doc.markers as { cm: string; tm: number }[] | undefined)?.find((m) => m.cm === GIFT_LOTTIE_POSTER_MARKER);
    expect(poster, `${key} needs a "poster" marker`).toBeDefined();
    expect(poster!.tm).toBeGreaterThanOrEqual(doc.ip as number);
    expect(poster!.tm).toBeLessThan(doc.op as number);
    expect(posterFrame(doc as never)).toBe(poster!.tm);
  });

  it("keeps every live effect within LIVE_GIFT_EFFECT_MS and never flashing more than 3 times a second", () => {
    for (const [key, asset] of entries) {
      const doc = load(asset.src);
      expect(worstFlashesPerSecond(doc), key).toBeLessThanOrEqual(3);
      const item = GIFT_ITEMS.find((i) => i.assetKey === key)!;
      if (item.kind === "LIVE_EFFECT") {
        const ms = (((doc.op as number) - (doc.ip as number)) / (doc.fr as number)) * 1000;
        expect(ms, key).toBeLessThanOrEqual(LIVE_GIFT_EFFECT_MS);
        expect(asset.loop, key).toBe(false);
      }
    }
  });
});

describe("the Lottie player", () => {
  it("is lottie-web's light build: no eval, no new Function, no WebAssembly", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["lottie-web"]).toMatch(/^\d+\.\d+\.\d+$/);
    const light = readFileSync(path.join(ROOT, "node_modules/lottie-web/build/player/lottie_light.js"), "utf8");
    expect(light).not.toMatch(/\beval\(|new Function\(|WebAssembly/);
  });

  it("is imported only by gift-lottie.tsx, only dynamically, only the light build", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
          if (name !== "generated" && name !== "node_modules") walk(full);
        } else if (/\.(ts|tsx|mts)$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(full);
      }
    };
    walk(path.join(ROOT, "src"));
    const importers = files.filter((f) =>
      /from\s*["']lottie-web|import\(\s*["']lottie-web|require\(\s*["']lottie-web|import\s*["']lottie-web/.test(readFileSync(f, "utf8")),
    );
    expect(importers.map((f) => path.relative(ROOT, f).replace(/\\/g, "/"))).toEqual(["src/components/gift-lottie.tsx"]);
    const src = readFileSync(importers[0], "utf8");
    expect(src).not.toMatch(/^\s*import\s[^(]*["']lottie-web/m);
    expect(src).not.toMatch(/require\(\s*["']lottie-web/);
    expect([...src.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1])).toEqual(["lottie-web/build/player/lottie_light"]);
  });

  it("needs no 'unsafe-eval' in production: the production script-src doesn't allow it", () => {
    const proxy = readFileSync(path.join(ROOT, "src/proxy.ts"), "utf8");
    const production = proxy.match(/process\.env\.NODE_ENV === "production"\s*\?\s*`([^`]*)`/);
    expect(production).not.toBeNull();
    expect(production![1]).not.toMatch(/unsafe-eval|wasm-unsafe-eval/);
  });

  it("renders the still art (the poster) until the animation is ready, and with reduce motion", () => {
    for (const reduce of [false, true]) {
      const html = renderToStaticMarkup(createElement(GiftLottie, { assetKey: "gold-orchid", name: "Gold Orchid", size: 160, reduce }));
      expect(html).toContain('role="img"');
      expect(html).toContain('aria-label="Gold Orchid"');
      expect(html).toContain("<svg");
    }
  });
});

describe("in-repo SVG art", () => {
  it.each(GIFT_SVG_ASSET_KEYS.map((k) => [k]))("%s stays within 8 KB and is static (no SMIL animation)", (key) => {
    const html = renderToStaticMarkup(createElement(GiftArt, { assetKey: key, name: key, size: 64 }));
    expect(html.startsWith("<svg")).toBe(true);
    expect(Buffer.byteLength(html, "utf8")).toBeLessThanOrEqual(8 * 1024);
    expect(html).not.toMatch(/<animate|<set\b|<script/);
  });
});

describe("reduced motion in the picker's universe styles", () => {
  it("animates universe ornaments only under prefers-reduced-motion: no-preference, slowly, without flashing", () => {
    const css = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
    const section = css.slice(css.indexOf("Gift universes (Phase A"));
    expect(section.length).toBeGreaterThan(0);
    const [before, after] = section.split("@media (prefers-reduced-motion: no-preference)");
    expect(before).not.toMatch(/animation:/);
    expect(after).toMatch(/animation:/);
    // No ornament keyframe toggles opacity (no flashing).
    const keyframes = after.slice(after.indexOf("@keyframes gift-bloom"));
    expect(keyframes).not.toMatch(/opacity/);
  });
});
