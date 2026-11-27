"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useThree } from "@react-three/fiber";
import { CanvasTexture, PMREMGenerator, SRGBColorSpace, type Texture } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GiftCanvas } from "@/components/gift-canvas";
import { buildComposedGraph, type ComposedGraph } from "@/components/gift-composed-graph";
import { cutOutGiftArt } from "@/lib/gift-art-cutout";
import { COMPOSED_USES_ART, composedScenePlan, composedSceneNeedsFrames, type ComposedScenePlan, type ComposedVariant } from "@/lib/gift-composed-plan";

// The composed 3D reveals (Keepsake Locket, Fireworks, Level Up, Aurora Sweep, Aurora Frame): a procedural object with
// the gift's own icon or effect placed on it (plan: src/lib/gift-composed-plan.ts; objects: gift-composed-graph.ts).
// Only GiftStage loads this file, through next/dynamic (ssr: false), and only while one of those gifts' reveal is open
// and giftRenderer chose "three"; intent prefetch (gift-render-capability.ts) imports it early.
//
// The icon (where the variant uses one) is the same same-origin 384px WebP the stage shows as its poster (already in
// the browser's cache), drawn into a canvas and cut out of its navy backdrop (gift-art-cutout.ts), then uploaded as an
// sRGB texture with mipmaps. The metal's reflections come from three's procedural RoomEnvironment, prefiltered once
// (PMREM) per open reveal. The shared GiftCanvas gives the one-canvas slot, frameloop "demand", the DPR cap and the
// context-loss fallback; an icon that fails to load hands back to the stage too. Frames are drawn only while the plan
// says something moves (composedSceneNeedsFrames) and never while the page is hidden; Replay restarts the timeline on
// the same canvas and graph. On close the graph's geometries and materials, the icon texture and the environment map
// are disposed, then React Three Fiber disposes the renderer and releases the context. Reduce motion never reaches it.

/** Anisotropic filtering for the icon when the object turns off-axis. */
const MAX_ANISOTROPY = 4;

function loadCutOut(src: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("no 2d context");
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        cutOutGiftArt(pixels.data, canvas.width, canvas.height);
        context.putImageData(pixels, 0, 0);
        resolve(canvas);
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = () => reject(new Error("icon failed to load"));
    image.src = src;
  });
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
    let art: Texture | null = null;
    let envMap: Texture | null = null;
    let built: ComposedGraph | null = null;
    const needsArt = COMPOSED_USES_ART[plan.variant];
    const icon = needsArt && artSrc ? loadCutOut(artSrc) : Promise.resolve(null);
    icon.then(
      (canvas) => {
        if (cancelled) return;
        if (needsArt && !canvas) {
          callbacks.current.onFallback();
          return;
        }
        if (canvas) {
          const texture = new CanvasTexture(canvas);
          texture.colorSpace = SRGBColorSpace;
          texture.anisotropy = Math.min(MAX_ANISOTROPY, gl.capabilities.getMaxAnisotropy());
          art = texture;
        }
        const pmrem = new PMREMGenerator(gl);
        const room = new RoomEnvironment();
        envMap = pmrem.fromScene(room, 0.04).texture;
        room.dispose();
        pmrem.dispose();
        built = buildComposedGraph(plan, { art, envMap });
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
      art?.dispose();
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
