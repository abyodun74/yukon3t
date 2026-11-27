import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  GIFT_COMPOSED_SCENE_FOR_ITEM,
  GIFT_LEGENDARY_SCENE_FOR_ITEM,
  GIFT_MODEL_FILES,
  GIFT_MODEL_FOR_ITEM,
  GIFT_MODEL_MAX_BYTES,
  acquireGiftCanvas,
  giftCanvasDpr,
  giftCanvasHolder,
  giftRenderer,
  resolveGiftModel,
  resolveGiftScene,
} from "@/lib/gift-3d-assets";
import { GIFT_ART_IMAGES } from "@/lib/gift-art-images";
import { GIFT_JEWELRY_ART_IMAGES } from "@/lib/gift-jewelry-art-images";
import { GIFT_LEGENDARY_ART_IMAGES } from "@/lib/gift-legendary-art-images";
import { GIFT_MARKET, GIFT_PRODUCTS, GIFT_TIERS } from "@/lib/gifts-data";
import { giftSignatureFor } from "@/lib/gift-signature-motion";

// The 3D layer of the gift reveal: which renderer a reveal uses, the one-canvas rule, the DPR cap, every model
// file (small, self-contained, uncompressed so no decoder is ever fetched, marked as a placeholder), and the import
// boundaries that keep three.js, React Three Fiber out of every bundle but their own lazily loaded chunks.

const ROOT = process.cwd();
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const full = { motion: "full" as const, webgl: true, hasScene: true, hasSignature: false };

describe("giftRenderer", () => {
  it("3D only for Epic and Legendary, with a scene and WebGL", () => {
    expect(GIFT_TIERS.map((tier) => giftRenderer({ ...full, tier }))).toEqual(["stage", "stage", "three", "three"]);
    expect(giftRenderer({ ...full, tier: "LEGENDARY", webgl: false })).toBe("stage");
    expect(giftRenderer({ ...full, tier: "LEGENDARY", hasScene: false })).toBe("stage");
  });

  it("the Luxury Red Rose and the Gold Orchid play their legendary scene (Legendary tier, no signature motion)", () => {
    for (const slug of ["luxury-red-rose", "gold-orchid"]) {
      const market = GIFT_MARKET.find((g) => GIFT_PRODUCTS.find((p) => p.sku === g.sku)?.items[0].slug === slug);
      expect(market?.tier, slug).toBe("LEGENDARY");
      const items = [{ slug }];
      expect(giftSignatureFor(items), slug).toBeNull();
      expect(giftRenderer({ ...full, tier: "LEGENDARY", hasScene: resolveGiftScene(items) !== null })).toBe("three");
      for (const motion of ["still", "light"] as const) expect(giftRenderer({ ...full, tier: "LEGENDARY", motion })).toBe("stage");
    }
  });

  it("never for a gift with a signature motion: Birthday Balloons' release from the box replaces its 3D scene", () => {
    for (const tier of GIFT_TIERS) expect(giftRenderer({ ...full, tier, hasSignature: true })).toBe("stage");
    // It keeps its model entry (the poster rule above), the renderer rule is what skips it.
    expect(resolveGiftModel([{ slug: "birthday-balloons" }])).not.toBeNull();
    expect(giftSignatureFor([{ slug: "birthday-balloons" }])).toBe("balloon-release");
  });

  it("never with reduce motion or on a low-end device", () => {
    for (const motion of ["still", "light"] as const) {
      for (const tier of GIFT_TIERS) {
        expect(giftRenderer({ ...full, tier, motion })).toBe("stage");
      }
    }
  });
});

describe("giftCanvasDpr", () => {
  it("never above 2, 1.25 on a low-end device, never below 1", () => {
    expect(giftCanvasDpr(3, false)).toEqual([1, 2]);
    expect(giftCanvasDpr(1.5, false)).toEqual([1, 1.5]);
    expect(giftCanvasDpr(3, true)).toEqual([1, 1.25]);
    expect(giftCanvasDpr(0.5, false)).toEqual([1, 1]);
    expect(giftCanvasDpr(Number.NaN, false)).toEqual([1, 1]);
  });
});

describe("one canvas at a time", () => {
  it("a second holder is refused until the first gives it back; the same holder may take it again", () => {
    const a = Symbol("a");
    const b = Symbol("b");
    const releaseA = acquireGiftCanvas(a);
    expect(releaseA).not.toBeNull();
    expect(giftCanvasHolder()).toBe(a);
    expect(acquireGiftCanvas(b)).toBeNull();
    expect(acquireGiftCanvas(a)).not.toBeNull();
    releaseA!();
    expect(giftCanvasHolder()).toBeNull();
    const releaseB = acquireGiftCanvas(b);
    expect(releaseB).not.toBeNull();
    releaseA!();
    expect(giftCanvasHolder()).toBe(b);
    releaseB!();
  });
});

describe("the scene registry", () => {
  const slugOf = new Map(GIFT_PRODUCTS.filter((p) => !p.isBox).map((p) => [p.sku, p.items[0].slug]));

  it("every Epic and Legendary marketplace gift has a 3D scene", () => {
    const rich = GIFT_MARKET.filter((g) => g.tier === "EPIC" || g.tier === "LEGENDARY");
    expect(rich.length).toBeGreaterThan(0);
    for (const gift of rich) {
      const slug = slugOf.get(gift.sku);
      expect(slug, gift.sku).toBeDefined();
      expect(resolveGiftScene([{ slug: slug! }]), gift.sku).not.toBeNull();
    }
  });

  it("only single gifts get one", () => {
    expect(resolveGiftModel([{ slug: "fireworks" }, { slug: "fireworks" }])).toBeNull();
    expect(resolveGiftModel([{ slug: "wave" }])).toBeNull();
    expect(resolveGiftScene([{ slug: "luxury-red-rose" }, { slug: "luxury-red-rose" }])).toBeNull();
    expect(resolveGiftScene([{ slug: "wave" }])).toBeNull();
    expect(resolveGiftScene([{ slug: "toString" }])).toBeNull();
  });

  it("the rose, the orchid and the jewelry box get the legendary scene with their own artwork, and no placeholder model", () => {
    expect(GIFT_LEGENDARY_SCENE_FOR_ITEM).toEqual({ "luxury-red-rose": "rose", "gold-orchid": "orchid", "diamond-jewelry-box": "jewelry" });
    expect(resolveGiftScene([{ slug: "diamond-jewelry-box" }])).toEqual({
      kind: "legendary",
      variant: "jewelry",
      artSrc: GIFT_JEWELRY_ART_IMAGES["diamond-jewelry-box"].src,
    });
    expect(resolveGiftScene([{ slug: "luxury-red-rose" }])).toEqual({
      kind: "legendary",
      variant: "rose",
      artSrc: GIFT_LEGENDARY_ART_IMAGES["luxury-red-rose"].src,
    });
    expect(resolveGiftScene([{ slug: "gold-orchid" }])).toEqual({
      kind: "legendary",
      variant: "orchid",
      artSrc: GIFT_LEGENDARY_ART_IMAGES["gold-orchid"].src,
    });
    for (const slug of Object.keys(GIFT_LEGENDARY_SCENE_FOR_ITEM)) {
      expect(GIFT_MODEL_FOR_ITEM[slug], slug).toBeUndefined();
      expect(resolveGiftModel([{ slug }]), slug).toBeNull();
    }
    expect(resolveGiftScene([{ slug: "kindred-spirit" }])).toEqual({ kind: "model", model: GIFT_MODEL_FILES.heart });
  });

  it("the five composed gifts get their own procedural scene (with their own icon where it is placed on the object), and no shared model", () => {
    expect(GIFT_COMPOSED_SCENE_FOR_ITEM).toEqual({
      "keepsake-locket": "gold-heart",
      fireworks: "fireworks-box",
      "level-up": "star-badge",
      "aurora-sweep": "gem-sweep",
      "aurora-frame": "gem-frame",
    });
    expect(resolveGiftScene([{ slug: "keepsake-locket" }])).toEqual({ kind: "composed", variant: "gold-heart", artSrc: null });
    expect(resolveGiftScene([{ slug: "fireworks" }])).toEqual({ kind: "composed", variant: "fireworks-box", artSrc: null });
    expect(resolveGiftScene([{ slug: "level-up" }])).toEqual({ kind: "composed", variant: "star-badge", artSrc: GIFT_ART_IMAGES["level-up"].src });
    expect(resolveGiftScene([{ slug: "aurora-sweep" }])).toEqual({ kind: "composed", variant: "gem-sweep", artSrc: GIFT_ART_IMAGES["aurora-sweep"].src });
    expect(resolveGiftScene([{ slug: "aurora-frame" }])).toEqual({ kind: "composed", variant: "gem-frame", artSrc: GIFT_ART_IMAGES["aurora-frame"].src });
    for (const slug of Object.keys(GIFT_COMPOSED_SCENE_FOR_ITEM)) {
      expect(GIFT_MODEL_FOR_ITEM[slug], slug).toBeUndefined();
      expect(giftSignatureFor([{ slug }]), slug).toBeNull();
    }
    // The gifts that shared those models keep them, unchanged.
    expect(resolveGiftScene([{ slug: "kindred-spirit" }])).toEqual({ kind: "model", model: GIFT_MODEL_FILES.heart });
    expect(resolveGiftScene([{ slug: "supporter-star" }])).toEqual({ kind: "model", model: GIFT_MODEL_FILES.star });
    expect(resolveGiftScene([{ slug: "midnight-crystal-frame" }])).toEqual({ kind: "model", model: GIFT_MODEL_FILES.diamond });
    expect(resolveGiftScene([{ slug: "playful-kitten" }])).toEqual({ kind: "model", model: GIFT_MODEL_FILES["gift-box"] });
  });

  it("every model file is still used by some gift", () => {
    const used = new Set(Object.values(GIFT_MODEL_FOR_ITEM));
    for (const key of Object.keys(GIFT_MODEL_FILES)) expect(used.has(key as keyof typeof GIFT_MODEL_FILES), key).toBe(true);
  });

  it.each(Object.entries(GIFT_MODEL_FILES))("%s.glb: same-origin, small, self-contained, uncompressed, marked", (_key, asset) => {
    expect(asset.src).toMatch(/^\/gifts\/models\/[a-z-]+\.glb$/);
    expect(asset.source).toBeTruthy();
    expect(asset.licence).toBeTruthy();
    const file = path.join(ROOT, "public", asset.src);
    expect(existsSync(file)).toBe(true);
    const bytes = readFileSync(file);
    expect(bytes.byteLength).toBeLessThanOrEqual(GIFT_MODEL_MAX_BYTES);
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("glTF");
    const jsonLength = bytes.readUInt32LE(12);
    expect(bytes.subarray(16, 20).toString("latin1")).toBe("JSON");
    const doc = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8")) as Record<string, unknown>;
    // No textures or external files (nothing else to fetch), no Draco / Meshopt (no decoder from a CDN, no WebAssembly).
    expect(doc.images ?? []).toEqual([]);
    expect(doc.textures ?? []).toEqual([]);
    expect(doc.extensionsUsed ?? []).toEqual([]);
    for (const buffer of (doc.buffers ?? []) as { uri?: string }[]) expect(buffer.uri).toBeUndefined();
    if (asset.placeholder) {
      const scenes = doc.scenes as { extras?: { placeholder?: boolean } }[];
      expect(scenes.some((s) => s.extras?.placeholder === true)).toBe(true);
    }
  });

  it("every mapped item exists in the catalog and every model file is registered", () => {
    const slugs = new Set(GIFT_PRODUCTS.flatMap((p) => p.items.map((i) => i.slug)));
    for (const slug of [...Object.keys(GIFT_MODEL_FOR_ITEM), ...Object.keys(GIFT_LEGENDARY_SCENE_FOR_ITEM), ...Object.keys(GIFT_COMPOSED_SCENE_FOR_ITEM)]) {
      expect(slugs.has(slug), slug).toBe(true);
    }
    const onDisk = readdirSync(path.join(ROOT, "public", "gifts", "models")).filter((f) => f.endsWith(".glb"));
    expect(onDisk.sort()).toEqual(Object.values(GIFT_MODEL_FILES).map((a) => path.basename(a.src)).sort());
  });
});

describe("loading boundaries", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const fullPath = path.join(dir, name);
      if (statSync(fullPath).isDirectory()) {
        if (name !== "generated" && name !== "node_modules") walk(fullPath);
      } else if (/\.(ts|tsx|mts)$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(fullPath);
    }
  };
  walk(path.join(ROOT, "src"));
  const rel = (f: string) => path.relative(ROOT, f).replace(/\\/g, "/");
  const importing = (pattern: RegExp) => files.filter((f) => pattern.test(readFileSync(f, "utf8"))).map(rel).sort();

  it("three.js and React Three Fiber are imported only by the 3D scenes and their shared canvas / graph", () => {
    expect(importing(/from\s*["'](three|@react-three\/[^"']+)["']|import\(\s*["'](three|@react-three)/)).toEqual([
      "src/components/gift-canvas.tsx",
      "src/components/gift-composed-graph.ts",
      "src/components/gift-legendary-graph.ts",
      "src/components/gift-scene-3d.tsx",
      "src/components/gift-scene-composed.tsx",
      "src/components/gift-scene-legendary.tsx",
    ]);
  });

  it.each(["gift-scene-3d", "gift-scene-legendary", "gift-scene-composed"])("%s is only ever loaded dynamically", (name) => {
    const loaders = importing(new RegExp(`@/components/${name}["']`));
    expect(loaders).toEqual(["src/components/gift-stage.tsx", "src/lib/gift-render-capability.ts"]);
    for (const f of loaders) {
      const src = read(f);
      expect(src, f).not.toMatch(new RegExp(`^\\s*import\\s[^(]*["']@/components/${name}["']`, "m"));
    }
    const stage = read("src/components/gift-stage.tsx");
    expect(stage).toContain(`dynamic(() => import("@/components/${name}"), { ssr: false`);
  });

  it("the shared canvas and the legendary graph are reached only through the lazily loaded scenes", () => {
    expect(importing(/@\/components\/gift-canvas["']/)).toEqual([
      "src/components/gift-scene-3d.tsx",
      "src/components/gift-scene-composed.tsx",
      "src/components/gift-scene-legendary.tsx",
    ]);
    expect(importing(/@\/components\/gift-legendary-graph["']/)).toEqual(["src/components/gift-scene-legendary.tsx"]);
    expect(importing(/@\/components\/gift-composed-graph["']/)).toEqual(["src/components/gift-scene-composed.tsx"]);
  });

  it("models load without Draco or Meshopt, and the scenes render on demand with a capped DPR", () => {
    const scene = read("src/components/gift-scene-3d.tsx");
    const calls = [...scene.matchAll(/useGLTF(?:\.preload)?\(([^)]*)\)/g)].map((m) => m[1].replace(/\s/g, ""));
    expect(calls.length).toBeGreaterThan(0);
    for (const args of calls) expect(args).toMatch(/^src,false,false$/);
    const canvas = read("src/components/gift-canvas.tsx");
    expect(canvas).toContain('frameloop="demand"');
    expect(canvas).toContain("giftCanvasDpr(");
    expect(canvas).toContain("acquireGiftCanvas(");
    expect(canvas).toContain("webglcontextlost");
    for (const f of ["src/components/gift-scene-3d.tsx", "src/components/gift-scene-legendary.tsx", "src/components/gift-scene-composed.tsx"]) {
      expect(read(f), f).toContain("<GiftCanvas");
    }
    for (const f of ["gift-canvas.tsx", "gift-scene-3d.tsx", "gift-scene-legendary.tsx", "gift-legendary-graph.ts", "gift-scene-composed.tsx", "gift-composed-graph.ts"]) {
      expect(read(`src/components/${f}`), f).not.toMatch(/https?:\/\/|fetch\(|XMLHttpRequest/);
    }
  });

  it("the legendary scene sets up its texture properly and disposes everything on close", () => {
    const scene = read("src/components/gift-scene-legendary.tsx");
    expect(scene).toContain("colorSpace = SRGBColorSpace");
    expect(scene).toContain("anisotropy = Math.min(MAX_ANISOTROPY");
    expect(scene).toContain("texture?.dispose()");
    expect(scene).toContain("built.dispose()");
    expect(scene).toContain("scene.remove(built.root)");
    expect(scene).toContain('removeEventListener("visibilitychange"');
    expect(scene).toContain("cancelAnimationFrame(frame)");
    expect(scene).toContain("legendarySceneNeedsFrames(");
  });

  it("the composed scene cuts its icon out locally, sets up its textures properly and disposes everything on close", () => {
    const scene = read("src/components/gift-scene-composed.tsx");
    expect(scene).toContain("cutOutGiftArt(");
    expect(scene).toContain("colorSpace = SRGBColorSpace");
    expect(scene).toContain("anisotropy = Math.min(MAX_ANISOTROPY");
    expect(scene).toContain("art?.dispose()");
    expect(scene).toContain("envMap?.dispose()");
    expect(scene).toContain("pmrem.dispose()");
    expect(scene).toContain("room.dispose()");
    expect(scene).toContain("built.dispose()");
    expect(scene).toContain("scene.remove(built.root)");
    expect(scene).toContain('removeEventListener("visibilitychange"');
    expect(scene).toContain("cancelAnimationFrame(frame)");
    expect(scene).toContain("composedSceneNeedsFrames(");
    // The environment is three's own procedural room: no HDR file, nothing downloaded.
    expect(scene).toMatch(/three\/examples\/jsm\/environments\/RoomEnvironment\.js/);
    expect(scene).not.toMatch(/\.hdr|\.exr|RGBELoader|EXRLoader/);
  });

  it("the new libraries are pinned to exact versions", () => {
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    for (const name of ["three", "@react-three/fiber", "@react-three/drei"]) {
      expect(pkg.dependencies[name], name).toMatch(/^\d+\.\d+\.\d+$/);
    }
    expect(pkg.devDependencies["@types/three"]).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
