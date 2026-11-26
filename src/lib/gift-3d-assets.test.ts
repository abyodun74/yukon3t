import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  GIFT_MODEL_FILES,
  GIFT_MODEL_FOR_ITEM,
  GIFT_MODEL_MAX_BYTES,
  acquireGiftCanvas,
  giftCanvasDpr,
  giftCanvasHolder,
  giftRenderer,
  resolveGiftModel,
} from "@/lib/gift-3d-assets";
import { GIFT_MARKET, GIFT_PRODUCTS, GIFT_TIERS } from "@/lib/gifts-data";
import { giftSignatureFor } from "@/lib/gift-signature-motion";

// The 3D layer of the gift reveal: which renderer a reveal uses, the one-canvas rule, the DPR cap, every model
// file (small, self-contained, uncompressed so no decoder is ever fetched, marked as a placeholder), and the import
// boundaries that keep three.js, React Three Fiber out of every bundle but their own lazily loaded chunks.

const ROOT = process.cwd();
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const full = { motion: "full" as const, webgl: true, hasModel: true, hasSignature: false };

describe("giftRenderer", () => {
  it("3D only for Epic and Legendary, with a model and WebGL", () => {
    expect(GIFT_TIERS.map((tier) => giftRenderer({ ...full, tier }))).toEqual(["stage", "stage", "three", "three"]);
    expect(giftRenderer({ ...full, tier: "LEGENDARY", webgl: false })).toBe("stage");
    expect(giftRenderer({ ...full, tier: "LEGENDARY", hasModel: false })).toBe("stage");
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

describe("the model registry", () => {
  const slugOf = new Map(GIFT_PRODUCTS.filter((p) => !p.isBox).map((p) => [p.sku, p.items[0].slug]));

  it("every Epic and Legendary marketplace gift has a model", () => {
    const rich = GIFT_MARKET.filter((g) => g.tier === "EPIC" || g.tier === "LEGENDARY");
    expect(rich.length).toBeGreaterThan(0);
    for (const gift of rich) {
      const slug = slugOf.get(gift.sku);
      expect(slug, gift.sku).toBeDefined();
      expect(resolveGiftModel([{ slug: slug! }]), gift.sku).not.toBeNull();
    }
  });

  it("only single gifts get one", () => {
    expect(resolveGiftModel([{ slug: "fireworks" }, { slug: "fireworks" }])).toBeNull();
    expect(resolveGiftModel([{ slug: "wave" }])).toBeNull();
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
    for (const slug of Object.keys(GIFT_MODEL_FOR_ITEM)) expect(slugs.has(slug), slug).toBe(true);
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

  it("three.js and React Three Fiber are imported only by the 3D scene", () => {
    expect(importing(/from\s*["'](three|@react-three\/[^"']+)["']|import\(\s*["'](three|@react-three)/)).toEqual([
      "src/components/gift-scene-3d.tsx",
    ]);
  });

  it("the scene is only ever loaded dynamically", () => {
    const loaders = importing(/@\/components\/gift-scene-3d["']/);
    expect(loaders).toEqual(["src/components/gift-stage.tsx", "src/lib/gift-render-capability.ts"]);
    for (const f of loaders) {
      const src = read(f);
      expect(src, f).not.toMatch(/^\s*import\s[^(]*["']@\/components\/gift-scene-3d["']/m);
    }
    const stage = read("src/components/gift-stage.tsx");
    expect(stage).toMatch(/dynamic\(\(\) => import\("@\/components\/gift-scene-3d"\), \{ ssr: false/);
  });

  it("models load without Draco or Meshopt, and the scene renders on demand with a capped DPR", () => {
    const scene = read("src/components/gift-scene-3d.tsx");
    const calls = [...scene.matchAll(/useGLTF(?:\.preload)?\(([^)]*)\)/g)].map((m) => m[1].replace(/\s/g, ""));
    expect(calls.length).toBeGreaterThan(0);
    for (const args of calls) expect(args).toMatch(/^src,false,false$/);
    expect(scene).toContain('frameloop="demand"');
    expect(scene).toContain("giftCanvasDpr(");
    expect(scene).toContain("acquireGiftCanvas(");
    expect(scene).toContain("webglcontextlost");
    expect(scene).not.toMatch(/https?:\/\//);
  });

  it("the new libraries are pinned to exact versions", () => {
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    for (const name of ["three", "@react-three/fiber", "@react-three/drei"]) {
      expect(pkg.dependencies[name], name).toMatch(/^\d+\.\d+\.\d+$/);
    }
    expect(pkg.devDependencies["@types/three"]).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
