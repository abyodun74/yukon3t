"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useThree } from "@react-three/fiber";
import { SRGBColorSpace, TextureLoader, type PerspectiveCamera, type Texture } from "three";
import { GIFT_CANVAS_FOV, GiftCanvas } from "@/components/gift-canvas";
import { buildLegendaryGraph, type LegendaryGraph } from "@/components/gift-legendary-graph";
import { legendaryScenePlan, legendarySceneNeedsFrames, type LegendaryScenePlan, type LegendaryVariant } from "@/lib/gift-legendary-plan";

// The cinematic Legendary reveal of the Luxury Red Rose and the Gold Orchid: the owner's artwork on a plane in a dark
// scene, with a slow camera push-in and sway, falling petals, sparkles, an orbiting glow ribbon, a light sweep and a
// pulse ring at the base (plan: src/lib/gift-legendary-plan.ts; objects: gift-legendary-graph.ts). Only GiftStage
// loads this file, through next/dynamic (ssr: false), and only while one of those two gifts' reveal is open and
// giftRenderer chose "three"; intent prefetch (gift-render-capability.ts) imports it early.
//
// The texture is the same same-origin 768px WebP the stage shows as its poster (already in the browser's cache), with
// sRGB colour, mipmaps and a little anisotropy. The shared GiftCanvas gives the one-canvas slot, frameloop "demand",
// the DPR cap and the context-loss fallback; a texture that fails to load hands back to the stage too. Frames are drawn
// only while the plan says something moves (legendarySceneNeedsFrames) and never while the page is hidden; after the
// settle the last frame stays, and a climax cue wakes it for its pulse. Replay restarts the timeline on the same
// canvas, graph and texture. On close the graph's geometries and materials and the texture are disposed, then React
// Three Fiber disposes the renderer and releases the context. Reduce motion never reaches this renderer.

/** Anisotropic filtering for the picture when the camera sways off-axis; more costs bandwidth for no visible gain. */
const MAX_ANISOTROPY = 4;

function LegendaryContent({
  plan,
  artSrc,
  artSize,
  playKey,
  playStartRef,
  climaxCount,
  onReady,
  onFallback,
}: {
  plan: LegendaryScenePlan;
  artSrc: string;
  artSize: number;
  playKey: number;
  playStartRef: RefObject<number>;
  climaxCount: number;
  onReady: () => void;
  onFallback: () => void;
}) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const get = useThree((state) => state.get);
  const invalidate = useThree((state) => state.invalidate);
  const height = useThree((state) => state.size.height);
  const [graph, setGraph] = useState<LegendaryGraph | null>(null);
  const callbacks = useRef({ onReady, onFallback });
  useEffect(() => {
    callbacks.current = { onReady, onFallback };
  });
  const pulsesRef = useRef<number[]>([]);
  const clockRef = useRef<{ now: () => number; wake: () => void } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let texture: Texture | null = null;
    let built: LegendaryGraph | null = null;
    new TextureLoader().load(
      artSrc,
      (loaded) => {
        texture = loaded;
        if (cancelled) {
          loaded.dispose();
          return;
        }
        loaded.colorSpace = SRGBColorSpace;
        loaded.anisotropy = Math.min(MAX_ANISOTROPY, gl.capabilities.getMaxAnisotropy());
        loaded.needsUpdate = true;
        built = buildLegendaryGraph(plan, loaded);
        scene.add(built.root);
        setGraph(built);
      },
      undefined,
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
      texture?.dispose();
      setGraph(null);
    };
  }, [artSrc, plan, gl, scene]);

  // The timeline: one requestAnimationFrame loop while something moves, paused while the page is hidden.
  useEffect(() => {
    if (!graph) return undefined;
    pulsesRef.current = [plan.hitMs];
    let frame = 0;
    let hiddenFor = 0;
    let hiddenAt: number | null = null;
    let readySent = false;
    const now = () => Math.max(0, performance.now() - playStartRef.current - hiddenFor);
    const tick = () => {
      frame = 0;
      const t = now();
      const { camera, size } = get();
      graph.update(t, {
        camera: camera as PerspectiveCamera,
        baseDistance: size.height / (Math.max(1, artSize) * 2 * Math.tan(((GIFT_CANVAS_FOV / 2) * Math.PI) / 180)),
        pixelRatio: gl.getPixelRatio(),
        pulses: pulsesRef.current,
      });
      invalidate();
      if (!readySent) {
        readySent = true;
        requestAnimationFrame(() => callbacks.current.onReady());
      }
      if (legendarySceneNeedsFrames(plan, t, pulsesRef.current)) frame = requestAnimationFrame(tick);
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
    clockRef.current = { now, wake };
    document.addEventListener("visibilitychange", onVisibility);
    if (document.visibilityState === "hidden") hiddenAt = performance.now();
    else wake();
    return () => {
      clockRef.current = null;
      document.removeEventListener("visibilitychange", onVisibility);
      cancelAnimationFrame(frame);
    };
  }, [graph, plan, playKey, playStartRef, artSize, gl, get, invalidate]);

  // The score's climax cue: one more pulse, now.
  useEffect(() => {
    const clock = clockRef.current;
    if (climaxCount === 0 || !clock) return;
    pulsesRef.current = [...pulsesRef.current, clock.now()];
    clock.wake();
  }, [climaxCount]);

  // A resized stage: redraw the current pose once (the loop may have stopped).
  useEffect(() => {
    clockRef.current?.wake();
  }, [height]);

  return null;
}

export default function GiftSceneLegendary({
  variant,
  artSrc,
  artSize,
  playKey,
  playStartRef,
  hitMs,
  climaxCount,
  lowEnd,
  onReady,
  onFallback,
}: {
  variant: LegendaryVariant;
  artSrc: string;
  /** The stage poster's size in CSS px: the picture starts exactly that size, so the hand-over has no jump. */
  artSize: number;
  playKey: number;
  /** performance.now() when this play (or Replay) started, set by GiftStage. */
  playStartRef: RefObject<number>;
  /** The reveal's hit (its name step), ms from the start. */
  hitMs: number;
  /** Climax cues of the tier's score so far. */
  climaxCount: number;
  lowEnd: boolean;
  onReady: () => void;
  onFallback: () => void;
}) {
  const plan = useMemo(() => legendaryScenePlan(variant, { lowEnd, hitMs }), [variant, lowEnd, hitMs]);
  return (
    <GiftCanvas lowEnd={lowEnd} onFallback={onFallback}>
      <LegendaryContent
        plan={plan}
        artSrc={artSrc}
        artSize={artSize}
        playKey={playKey}
        playStartRef={playStartRef}
        climaxCount={climaxCount}
        onReady={onReady}
        onFallback={onFallback}
      />
    </GiftCanvas>
  );
}
