"use client";

import { Suspense, useEffect, useLayoutEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei/core/Gltf";
import type { Group, Material, Mesh, Object3D, Texture } from "three";
import { GiftCanvas } from "@/components/gift-canvas";
import type { GiftTierName } from "@/lib/gifts-data";

// The Epic / Legendary 3D reveal: one small React Three Fiber scene with a self-hosted GLB (src/lib/gift-3d-assets.ts).
// Only GiftStage loads this file, through next/dynamic (ssr: false), and only while a reveal is open and giftRenderer
// chose "three"; intent prefetch (gift-render-capability.ts) imports it early. Nothing in the grid ever mounts it.
//
// Budget rules: the shared GiftCanvas (one canvas app-wide, frameloop "demand": a frame is drawn only when the entrance
// or the short idle turn asks for one, and never while the page is hidden, DPR capped at 2, 1.25 on a low-end device),
// no Draco / Meshopt (useGLTF(src, false, false): no decoder from a CDN, no WebAssembly). On close the model's
// geometries, materials and textures are disposed and it is dropped from the loader cache; React Three Fiber then
// disposes the renderer and releases the WebGL context. A lost context, a failed load or a render error hands back to
// the CSS stage through onFallback. Motion: eased tweens only, nothing overshoots; there is no reduced-motion
// branch because reduce motion never reaches this renderer.

const TIER_LIGHT: Record<GiftTierName, string> = {
  COMMON: "#8a9a92",
  RARE: "#4fa3ff",
  EPIC: "#b26bff",
  LEGENDARY: "#e1a928",
};
/** After the entrance, a slow turn for this long, then the frame stays still (no endless render loop). */
const IDLE_TURN_MS = 6000;
const IDLE_TURN_RAD_PER_S = 0.5;

const easeOutCubic = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

/** Warm the model into the loader cache (intent prefetch). */
export function preloadGiftModel(src: string): void {
  useGLTF.preload(src, false, false);
}

function disposeObject(root: Object3D) {
  root.traverse((node) => {
    const mesh = node as Mesh;
    mesh.geometry?.dispose();
    const materials = (Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []) as Material[];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value && typeof value === "object" && (value as Texture).isTexture) (value as Texture).dispose();
      }
      material.dispose();
    }
  });
}

function Model({ src, durationMs, playKey, onReady }: { src: string; durationMs: number; playKey: number; onReady: () => void }) {
  const { scene } = useGLTF(src, false, false);
  const invalidate = useThree((state) => state.invalidate);
  const group = useRef<Group>(null);

  useEffect(() => {
    onReady();
  }, [onReady]);

  useEffect(
    () => () => {
      disposeObject(scene);
      useGLTF.clear(src);
    },
    [scene, src],
  );

  // Entrance, then a short idle turn. Frames are requested only while something moves and the page is visible.
  useLayoutEffect(() => {
    const node = group.current;
    if (!node) return;
    let frame = 0;
    let start = performance.now();
    let hiddenAt: number | null = null;
    const entranceMs = Math.max(600, durationMs);
    const tick = (now: number) => {
      const elapsed = now - start;
      const t = easeOutCubic(elapsed / entranceMs);
      node.position.y = -0.7 * (1 - t);
      node.scale.setScalar(0.55 + 0.45 * t);
      const idle = Math.max(0, Math.min(elapsed - entranceMs, IDLE_TURN_MS)) / 1000;
      node.rotation.y = -Math.PI * (1 - t) + idle * IDLE_TURN_RAD_PER_S;
      invalidate();
      if (elapsed < entranceMs + IDLE_TURN_MS) frame = requestAnimationFrame(tick);
      else frame = 0;
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = performance.now();
        cancelAnimationFrame(frame);
        frame = 0;
      } else if (hiddenAt !== null) {
        start += performance.now() - hiddenAt;
        hiddenAt = null;
        if (!frame) frame = requestAnimationFrame(tick);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    if (document.visibilityState !== "hidden") frame = requestAnimationFrame(tick);
    else hiddenAt = performance.now();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      cancelAnimationFrame(frame);
    };
  }, [durationMs, playKey, invalidate]);

  return (
    <group ref={group}>
      <primitive object={scene} dispose={null} />
    </group>
  );
}

export default function GiftScene3D({
  src,
  tier,
  durationMs,
  playKey,
  lowEnd,
  onReady,
  onFallback,
}: {
  src: string;
  tier: GiftTierName;
  durationMs: number;
  playKey: number;
  lowEnd: boolean;
  onReady: () => void;
  onFallback: () => void;
}) {
  return (
    <GiftCanvas lowEnd={lowEnd} onFallback={onFallback}>
      <ambientLight intensity={0.65} />
      <directionalLight position={[2.5, 3, 4]} intensity={1.6} />
      <pointLight position={[-2, -1, 2.5]} intensity={18} color={TIER_LIGHT[tier]} />
      <Suspense fallback={null}>
        <Model src={src} durationMs={durationMs} playKey={playKey} onReady={onReady} />
      </Suspense>
    </GiftCanvas>
  );
}
