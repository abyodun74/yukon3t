"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useThree } from "@react-three/fiber";
import { CanvasTexture, NoColorSpace, PMREMGenerator, RepeatWrapping, SRGBColorSpace, type Texture } from "three";
import { GiftCanvas } from "@/components/gift-canvas";
import { STAR_ENGRAVE_HALF } from "@/components/gift-composed-objects";
import { STUDIO_FOR_VARIANT, buildComposedGraph, buildStudioEnvironment, type ComposedAssets, type ComposedGraph } from "@/components/gift-composed-graph";
import { CUTOUT_PRESETS, CUTOUT_UPSCALE, LEVEL_UP_SILHOUETTE, SUPPORTER_STAR_OUTLINE, cutOutGiftArt, scaledCutout, type CutoutPreset } from "@/lib/gift-art-cutout";
import {
  COMPOSED_CUTOUT,
  COMPOSED_USES_ART,
  ENGRAVE_MOTIF_RADIUS,
  ENGRAVE_TEXTURE_SIZE,
  STAR_FACE_CENTRE,
  SUPPORTER_STAR_ICON,
  POSTCARD_WRAP_ASPECT,
  composedScenePlan,
  composedSceneNeedsFrames,
  type ComposedScenePlan,
  type ComposedVariant,
} from "@/lib/gift-composed-plan";
import { engraveMaps } from "@/lib/gift-engrave";
import { POSTCARD_PICTURE_QUAD, POSTCARD_PICTURE_SIZE, lidTopMaps, rectifyQuad, wrapPanorama, wrapReliefNormal } from "@/lib/gift-postcard-wrap";

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
// gift-engrave.ts) or into the seamless wrap round the box (the Sunset Postcard, gift-postcard-wrap.ts), then uploaded
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

/** The Level Up badge: the icon kept only inside its hand-traced outline (an anti-aliased fill of the path). */
function silhouetteCut(image: HTMLImageElement): HTMLCanvasElement {
  const scale = CUTOUT_UPSCALE * (image.naturalWidth / 384);
  const { canvas, context } = canvas2d(image.naturalWidth * CUTOUT_UPSCALE, image.naturalHeight * CUTOUT_UPSCALE);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const path = new Path2D();
  LEVEL_UP_SILHOUETTE.forEach(([x, y], i) => (i === 0 ? path.moveTo(x * scale, y * scale) : path.lineTo(x * scale, y * scale)));
  path.closePath();
  context.globalCompositeOperation = "destination-in";
  context.fill(path);
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

/** The Sunset Postcard's wrap (the picture squared up and made seamless round the box), its relief, and the lid's top. */
function postcardCanvases(image: HTMLImageElement): { wrap: HTMLCanvasElement; wrapNormal: HTMLCanvasElement; lidTop: HTMLCanvasElement; lidTopNormal: HTMLCanvasElement } {
  const { context } = canvas2d(384, 384);
  context.drawImage(image, 0, 0, 384, 384);
  const icon = context.getImageData(0, 0, 384, 384);
  const { width: w, height: h } = POSTCARD_PICTURE_SIZE;
  const picture = rectifyQuad(icon.data, 384, 384, POSTCARD_PICTURE_QUAD, w, h);
  // Two copies end to end make exactly the box's proportions once each join overlaps by this much.
  const overlap = w - (POSTCARD_WRAP_ASPECT * h) / 2;
  const outH = 360;
  const outW = Math.round(outH * POSTCARD_WRAP_ASPECT);
  const wrap = wrapPanorama(picture, w, h, overlap, outW, outH);
  const lid = lidTopMaps(256);
  return {
    wrap: canvasFrom(wrap, outW, outH),
    wrapNormal: canvasFrom(wrapReliefNormal(wrap, outW, outH), outW, outH),
    lidTop: canvasFrom(lid.color, 256, 256),
    lidTopNormal: canvasFrom(lid.normal, 256, 256),
  };
}

type PreparedArt = { art: Texture | null; maps: NonNullable<ComposedAssets["maps"]>; textures: Texture[] };

/** Everything a variant draws from its icon, as textures (sRGB colour, linear data maps), or nothing. */
async function prepareArt(variant: ComposedVariant, src: string | null, maxAnisotropy: number): Promise<PreparedArt | null> {
  if (!COMPOSED_USES_ART[variant]) return { art: null, maps: {}, textures: [] };
  if (!src) return null;
  const image = await loadImage(src);
  const textures: Texture[] = [];
  const texture = (canvas: HTMLCanvasElement, kind: "color" | "data", wrap = false) => {
    const t = new CanvasTexture(canvas);
    t.colorSpace = kind === "color" ? SRGBColorSpace : NoColorSpace;
    t.anisotropy = maxAnisotropy;
    if (wrap) t.wrapS = RepeatWrapping;
    textures.push(t);
    return t;
  };
  const prep = COMPOSED_CUTOUT[variant];
  if (variant === "star-engraved") {
    const maps = engravingCanvases(image);
    return { art: texture(maps.color, "data"), maps: { normal: texture(maps.normal, "data"), roughness: texture(maps.roughness, "data") }, textures };
  }
  if (prep === "postcard") {
    const c = postcardCanvases(image);
    return {
      art: texture(c.wrap, "color", true),
      maps: { normal: texture(c.wrapNormal, "data", true), lidTop: texture(c.lidTop, "color"), lidTopNormal: texture(c.lidTopNormal, "data") },
      textures,
    };
  }
  const canvas = prep === "silhouette" ? silhouetteCut(image) : cutOut(image, prep);
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
        built = buildComposedGraph(plan, { art: prepared.art, envMap, maps: prepared.maps });
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
