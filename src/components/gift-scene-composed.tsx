"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useThree } from "@react-three/fiber";
import { CanvasTexture, NoColorSpace, PMREMGenerator, RepeatWrapping, SRGBColorSpace, type Texture } from "three";
import { GiftCanvas } from "@/components/gift-canvas";
import { STAR_ENGRAVE_HALF } from "@/components/gift-composed-objects";
import { STUDIO_FOR_VARIANT, buildComposedGraph, buildStudioEnvironment, type ComposedAssets, type ComposedGraph, type HeightField } from "@/components/gift-composed-graph";
import {
  CUTOUT_PRESETS,
  CUTOUT_UPSCALE,
  LEVEL_UP_SILHOUETTE,
  MIDNIGHT_CRYSTAL_GROUND_Y,
  MIDNIGHT_CRYSTAL_SILHOUETTE,
  SUPPORTER_STAR_OUTLINE,
  cutOutGiftArt,
  scaledCutout,
  type CutoutPreset,
} from "@/lib/gift-art-cutout";
import {
  COMPOSED_CUTOUT,
  COMPOSED_USES_ART,
  CRYSTAL_UNDERFILL_PX,
  ENGRAVE_MOTIF_RADIUS,
  ENGRAVE_TEXTURE_SIZE,
  STAR_FACE_CENTRE,
  SUPPORTER_STAR_ICON,
  composedScenePlan,
  composedSceneNeedsFrames,
  type ComposedScenePlan,
  type ComposedVariant,
} from "@/lib/gift-composed-plan";
import { engraveMaps } from "@/lib/gift-engrave";
import { POSTCARD_LID_SIZE, POSTCARD_WRAP_REPEAT, POSTCARD_WRAP_SIZE, carveMaps, drawPostcardLid, drawPostcardWrap } from "@/lib/gift-postcard-wrap";

// The composed 3D reveals (Keepsake Locket, Fireworks, Level Up, Aurora Sweep, Aurora Frame, Trophy Frame, Playful
// Kitten, Kindred Spirit, Supporter Star, Midnight Crystal, Sunset Postcard): a procedural object with the gift's own
// icon or effect placed on, engraved into or wrapped round it (plan: src/lib/gift-composed-plan.ts; objects:
// gift-composed-graph.ts).
// Only GiftStage loads this file, through next/dynamic (ssr: false), and only while one of those gifts' reveal is open
// and giftRenderer chose "three"; intent prefetch (gift-render-capability.ts) imports it early.
//
// The icon (where the variant uses one) is the same same-origin 384px WebP the stage shows as its poster (already in
// the browser's cache), drawn into a canvas and prepared there (prepareArt): cut out of its navy backdrop
// (gift-art-cutout.ts; the Level Up badge by its hand-traced outline), turned into engraving maps (the Supporter Star,
// gift-engrave.ts); the Sunset Postcard's sunset is drawn from code and carved round its box (gift-postcard-wrap.ts). Then uploaded
// as textures with mipmaps (colour maps sRGB, relief / roughness / tone maps as data). The reflections come from a studio
// per kind of material (buildStudioEnvironment), prefiltered once (PMREM) per open reveal. The shared GiftCanvas gives the one-canvas slot, frameloop "demand", the DPR cap and the
// context-loss fallback; an icon that fails to load hands back to the stage too. Frames are drawn only while the plan
// says something moves (composedSceneNeedsFrames: always, for the trophy and the postcard box, which keep turning) and
// never while the page is hidden; Replay restarts the timeline on
// the same canvas and graph. On close the graph's geometries and materials, every texture made here and the environment map
// are disposed, then React Three Fiber disposes the renderer and releases the context. Reduce motion never reaches it.

/** Anisotropic filtering for the icon when the object turns off-axis. */
const MAX_ANISOTROPY = 4;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("icon failed to load"));
    image.src = src;
  });
}

function canvas2d(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("no 2d context");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  return { canvas, context };
}

function canvasFrom(data: Uint8ClampedArray, width: number, height: number): HTMLCanvasElement {
  const { canvas, context } = canvas2d(width, height);
  const image = context.createImageData(width, height);
  image.data.set(data);
  context.putImageData(image, 0, 0);
  return canvas;
}

/** The icon cut out of its backdrop, at CUTOUT_UPSCALE x its size (smoothly upscaled first, for a finer cut edge). */
function cutOut(image: HTMLImageElement, preset: CutoutPreset): HTMLCanvasElement {
  const { canvas, context } = canvas2d(image.naturalWidth * CUTOUT_UPSCALE, image.naturalHeight * CUTOUT_UPSCALE);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  cutOutGiftArt(pixels.data, canvas.width, canvas.height, scaledCutout(CUTOUT_PRESETS[preset], CUTOUT_UPSCALE));
  context.putImageData(pixels, 0, 0);
  return canvas;
}

/**
 * The icon kept only inside a hand-traced outline (an anti-aliased fill of the path): the Level Up badge, or the
 * Midnight Crystal's whole cluster. For the crystal the outline is grown by `grow` icon px (so the crystals' own dark
 * outline comes along), and its rock bed's flat underside is cut hard on the ground line, with the bed's bottom row
 * continued CRYSTAL_UNDERFILL_PX below it (that strip sits inside the gem at rest, under the table).
 */
function silhouetteCut(
  image: HTMLImageElement,
  outline: readonly (readonly [number, number])[],
  options: { grow: number; ground?: { y: number; underfill: number } } = { grow: 0 },
): HTMLCanvasElement {
  const scale = CUTOUT_UPSCALE * (image.naturalWidth / 384);
  const { canvas, context } = canvas2d(image.naturalWidth * CUTOUT_UPSCALE, image.naturalHeight * CUTOUT_UPSCALE);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const ground = options.ground ? Math.round(options.ground.y * scale) : null;
  const underfill = options.ground ? Math.round(options.ground.underfill * scale) : 0;
  if (ground !== null && underfill > 0) {
    // The bed's last painted row, repeated downwards.
    context.drawImage(canvas, 0, ground - 1, canvas.width, 1, 0, ground, canvas.width, underfill);
  }
  const { canvas: maskCanvas, context: mask } = canvas2d(canvas.width, canvas.height);
  const path = new Path2D();
  outline.forEach(([x, y], i) => {
    const py = ground !== null && y * scale >= ground - 0.5 ? ground + underfill : y * scale;
    if (i === 0) path.moveTo(x * scale, py);
    else path.lineTo(x * scale, py);
  });
  path.closePath();
  mask.fillStyle = "#fff";
  mask.fill(path);
  if (options.grow > 0) {
    mask.strokeStyle = "#fff";
    mask.lineJoin = "round";
    mask.lineWidth = 2 * options.grow * scale;
    mask.stroke(path);
  }
  if (ground !== null) mask.clearRect(0, ground + underfill, canvas.width, canvas.height);
  context.globalCompositeOperation = "destination-in";
  context.drawImage(maskCanvas, 0, 0);
  context.globalCompositeOperation = "source-over";
  return canvas;
}

/**
 * The Supporter Star's engraving maps: the icon cut out, laid on the star's face (its star centred on the 3D star's own
 * centre, top point up, the icon's star at ENGRAVE_MOTIF_RADIUS of the star's), then turned into colour, relief and
 * roughness maps (gift-engrave.ts).
 */
function engravingCanvases(image: HTMLImageElement): { color: HTMLCanvasElement; normal: HTMLCanvasElement; roughness: HTMLCanvasElement } {
  const size = ENGRAVE_TEXTURE_SIZE;
  const { context } = canvas2d(size, size);
  // Texture space: the star's face x/y in [-STAR_ENGRAVE_HALF, STAR_ENGRAVE_HALF] -> 0..size (y down on the canvas).
  // `iconPx` canvas px per icon px (the icon's 384 px grid), placing the icon's star on the 3D star's centre.
  const unitsToPx = size / (2 * STAR_ENGRAVE_HALF);
  const iconPx = (ENGRAVE_MOTIF_RADIUS * unitsToPx) / SUPPORTER_STAR_ICON.radius;
  const ox = size / 2 + STAR_FACE_CENTRE.x * unitsToPx - SUPPORTER_STAR_ICON.x * iconPx;
  const oy = size / 2 - STAR_FACE_CENTRE.y * unitsToPx - SUPPORTER_STAR_ICON.y * iconPx;
  context.drawImage(image, ox, oy, 384 * iconPx, 384 * iconPx);
  // Only the star itself is cut in: keep what is inside its traced outline (anti-aliased).
  const outline = new Path2D();
  SUPPORTER_STAR_OUTLINE.forEach(([x, y], i) => (i === 0 ? outline.moveTo(ox + x * iconPx, oy + y * iconPx) : outline.lineTo(ox + x * iconPx, oy + y * iconPx)));
  outline.closePath();
  context.globalCompositeOperation = "destination-in";
  context.fill(outline);
  context.globalCompositeOperation = "source-over";
  const pixels = context.getImageData(0, 0, size, size);
  const maps = engraveMaps(pixels.data, size, size);
  return { color: canvasFrom(maps.color, size, size), normal: canvasFrom(maps.normal, size, size), roughness: canvasFrom(maps.roughness, size, size) };
}

/** One pass of a carved drawing (colour or height) into a fresh canvas, read back as RGBA. */
function drawn(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): Uint8ClampedArray {
  const { context } = canvas2d(width, height);
  draw(context);
  return context.getImageData(0, 0, width, height).data;
}

/** Hands the main thread back for a moment (the postcard's carving is prepared in steps, between frames). */
const yieldToFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * The Sunset Postcard carved round its box (gift-postcard-wrap.ts): the scene and the lid's top, each drawn in colour
 * and as height, turned into the shaded colour map, the normal map and the height field that displaces the geometry.
 * About half a second of work on a desktop (headless Chrome), done in steps with the main thread handed back between
 * them so the opening reveal keeps animating.
 */
async function postcardCarving(): Promise<{
  wrap: HTMLCanvasElement;
  wrapNormal: HTMLCanvasElement;
  lidTop: HTMLCanvasElement;
  lidTopNormal: HTMLCanvasElement;
  sides: HeightField;
  lid: HeightField;
}> {
  const { width: W, height: H } = POSTCARD_WRAP_SIZE;
  const color = drawn(W, H, (ctx) => drawPostcardWrap(ctx, "color"));
  await yieldToFrame();
  const height = drawn(W, H, (ctx) => drawPostcardWrap(ctx, "height"));
  await yieldToFrame();
  const sides = carveMaps(color, height, W, H, true);
  await yieldToFrame();
  const L = POSTCARD_LID_SIZE;
  const lid = carveMaps(
    drawn(L, L, (ctx) => drawPostcardLid(ctx, "color")),
    drawn(L, L, (ctx) => drawPostcardLid(ctx, "height")),
    L,
    L,
    false,
  );
  return {
    wrap: canvasFrom(sides.color, W, H),
    wrapNormal: canvasFrom(sides.normal, W, H),
    lidTop: canvasFrom(lid.color, L, L),
    lidTopNormal: canvasFrom(lid.normal, L, L),
    sides: { data: sides.height, width: W, height: H },
    lid: { data: lid.height, width: L, height: L },
  };
}

type PreparedArt = { art: Texture | null; maps: NonNullable<ComposedAssets["maps"]>; carving?: ComposedAssets["carving"]; textures: Texture[] };

/** Everything a variant draws from its icon (or, for the postcard, its carving), as textures, or nothing. */
async function prepareArt(variant: ComposedVariant, src: string | null, maxAnisotropy: number): Promise<PreparedArt | null> {
  const textures: Texture[] = [];
  const texture = (canvas: HTMLCanvasElement, kind: "color" | "data", wrap = false) => {
    const t = new CanvasTexture(canvas);
    t.colorSpace = kind === "color" ? SRGBColorSpace : NoColorSpace;
    t.anisotropy = maxAnisotropy;
    if (wrap) {
      t.wrapS = RepeatWrapping;
      t.repeat.set(POSTCARD_WRAP_REPEAT, 1);
    }
    textures.push(t);
    return t;
  };
  const prep = COMPOSED_CUTOUT[variant];
  if (prep === "postcard") {
    // Drawn from code (the owner's postcard, redrawn at full resolution as a carving), so it needs no icon.
    const c = await postcardCarving();
    return {
      art: texture(c.wrap, "color", true),
      maps: { normal: texture(c.wrapNormal, "data", true), lidTop: texture(c.lidTop, "color"), lidTopNormal: texture(c.lidTopNormal, "data") },
      carving: { sides: c.sides, lid: c.lid },
      textures,
    };
  }
  if (!COMPOSED_USES_ART[variant]) return { art: null, maps: {}, textures };
  if (!src) return null;
  const image = await loadImage(src);
  if (variant === "star-engraved") {
    const maps = engravingCanvases(image);
    return { art: texture(maps.color, "data"), maps: { normal: texture(maps.normal, "data"), roughness: texture(maps.roughness, "data") }, textures };
  }
  const canvas =
    prep === "level-up-outline"
      ? silhouetteCut(image, LEVEL_UP_SILHOUETTE)
      : prep === "crystal-outline"
        ? silhouetteCut(image, MIDNIGHT_CRYSTAL_SILHOUETTE, { grow: 1.25, ground: { y: MIDNIGHT_CRYSTAL_GROUND_Y, underfill: CRYSTAL_UNDERFILL_PX } })
        : cutOut(image, prep);
  return { art: texture(canvas, "color"), maps: {}, textures };
}

function ComposedContent({
  plan,
  artSrc,
  playKey,
  playStartRef,
  onReady,
  onFallback,
}: {
  plan: ComposedScenePlan;
  artSrc: string | null;
  playKey: number;
  playStartRef: RefObject<number>;
  onReady: () => void;
  onFallback: () => void;
}) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);
  const height = useThree((state) => state.size.height);
  const [graph, setGraph] = useState<ComposedGraph | null>(null);
  const callbacks = useRef({ onReady, onFallback });
  useEffect(() => {
    callbacks.current = { onReady, onFallback };
  });
  const wakeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    let textures: Texture[] = [];
    let envMap: Texture | null = null;
    let built: ComposedGraph | null = null;
    prepareArt(plan.variant, artSrc, Math.min(MAX_ANISOTROPY, gl.capabilities.getMaxAnisotropy())).then(
      (prepared) => {
        if (prepared) textures = prepared.textures;
        if (cancelled) {
          for (const t of textures) t.dispose();
          return;
        }
        if (!prepared) {
          callbacks.current.onFallback();
          return;
        }
        const pmrem = new PMREMGenerator(gl);
        const kind = STUDIO_FOR_VARIANT[plan.variant];
        const studio = buildStudioEnvironment(kind);
        envMap = pmrem.fromScene(studio.scene, kind === "room" ? 0.04 : 0.02).texture;
        studio.dispose();
        pmrem.dispose();
        built = buildComposedGraph(plan, { art: prepared.art, envMap, maps: prepared.maps, carving: prepared.carving });
        scene.add(built.root);
        setGraph(built);
      },
      () => {
        if (!cancelled) callbacks.current.onFallback();
      },
    );
    return () => {
      cancelled = true;
      if (built) {
        scene.remove(built.root);
        built.dispose();
      }
      for (const t of textures) t.dispose();
      envMap?.dispose();
      setGraph(null);
    };
  }, [artSrc, plan, gl, scene]);

  // The timeline: one requestAnimationFrame loop while something moves, paused while the page is hidden.
  useEffect(() => {
    if (!graph) return undefined;
    let frame = 0;
    let hiddenFor = 0;
    let hiddenAt: number | null = null;
    let readySent = false;
    const now = () => Math.max(0, performance.now() - playStartRef.current - hiddenFor);
    const tick = () => {
      frame = 0;
      const t = now();
      graph.update(t, { pixelRatio: gl.getPixelRatio() });
      invalidate();
      if (!readySent) {
        readySent = true;
        requestAnimationFrame(() => callbacks.current.onReady());
      }
      if (composedSceneNeedsFrames(plan, t)) frame = requestAnimationFrame(tick);
    };
    const wake = () => {
      if (!frame && hiddenAt === null) frame = requestAnimationFrame(tick);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (hiddenAt === null) hiddenAt = performance.now();
        cancelAnimationFrame(frame);
        frame = 0;
      } else if (hiddenAt !== null) {
        hiddenFor += performance.now() - hiddenAt;
        hiddenAt = null;
        wake();
      }
    };
    wakeRef.current = wake;
    document.addEventListener("visibilitychange", onVisibility);
    if (document.visibilityState === "hidden") hiddenAt = performance.now();
    else wake();
    return () => {
      wakeRef.current = null;
      document.removeEventListener("visibilitychange", onVisibility);
      cancelAnimationFrame(frame);
    };
  }, [graph, plan, playKey, playStartRef, gl, invalidate]);

  // A resized stage: redraw the current pose once (the loop may have stopped).
  useEffect(() => {
    wakeRef.current?.();
  }, [height]);

  return null;
}

export default function GiftSceneComposed({
  variant,
  artSrc,
  playKey,
  playStartRef,
  hitMs,
  lowEnd,
  onReady,
  onFallback,
}: {
  variant: ComposedVariant;
  /** The gift's 384px icon (cut out and placed on the object), or null for a variant that draws none. */
  artSrc: string | null;
  playKey: number;
  /** performance.now() when this play (or Replay) started, set by GiftStage. */
  playStartRef: RefObject<number>;
  /** The reveal's hit (its name step), ms from the start. */
  hitMs: number;
  lowEnd: boolean;
  onReady: () => void;
  onFallback: () => void;
}) {
  const plan = useMemo(() => composedScenePlan(variant, { lowEnd, hitMs }), [variant, lowEnd, hitMs]);
  return (
    <GiftCanvas lowEnd={lowEnd} onFallback={onFallback}>
      <ComposedContent plan={plan} artSrc={artSrc} playKey={playKey} playStartRef={playStartRef} onReady={onReady} onFallback={onFallback} />
    </GiftCanvas>
  );
}
