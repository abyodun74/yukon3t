"use client";

import { giftEffectPlan, isLowEndDevice } from "@/lib/gift-effect-plan";
import { giftRenderer, resolveGiftScene } from "@/lib/gift-3d-assets";
import { giftSignatureFor } from "@/lib/gift-signature-motion";
import type { GiftTierName } from "@/lib/gifts-data";

// What this browser can do for a gift reveal, checked once and cached: WebGL for the 3D scene (old Android WebViews may
// have none, or only a software one, which failIfMajorPerformanceCaveat rules out). The check runs only when a gift
// could use it, never at startup.

let webgl: boolean | null = null;

export function hasWebGL(): boolean {
  if (webgl !== null) return webgl;
  try {
    const canvas = document.createElement("canvas");
    const options = { failIfMajorPerformanceCaveat: true } as const;
    const gl =
      (canvas.getContext("webgl2", options) as WebGL2RenderingContext | null) ??
      (canvas.getContext("webgl", options) as WebGLRenderingContext | null);
    webgl = Boolean(gl);
    // Give the probe's context back at once (browsers cap how many can exist).
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    webgl = false;
  }
  return webgl;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

const prefetched = new Set<string>();

/**
 * Warms what a reveal of this gift would load, on intent only (a hover, focus or press on its card): the 3D scene's
 * code and its model (the legendary scene's texture is the poster the reveal loads anyway). Does nothing where the
 * reveal would use the plain stage anyway.
 */
export function prefetchGiftReveal(gift: { tier: GiftTierName; items: readonly { slug: string }[] }): void {
  if (typeof window === "undefined") return;
  const lowEnd = isLowEndDevice(navigator as unknown as Parameters<typeof isLowEndDevice>[0]);
  const { motion } = giftEffectPlan(gift.tier, { reduce: prefersReducedMotion(), lowEnd });
  if (motion !== "full") return;
  const scene = resolveGiftScene(gift.items);
  const renderer = giftRenderer({
    tier: gift.tier,
    motion,
    hasScene: scene !== null,
    hasSignature: giftSignatureFor(gift.items) !== null,
    webgl: scene !== null && hasWebGL(),
  });
  if (renderer !== "three" || !scene) return;
  const key = scene.kind === "model" ? scene.model.src : scene.kind === "composed" ? `composed:${scene.variant}` : scene.artSrc;
  if (prefetched.has(key)) return;
  prefetched.add(key);
  const warm =
    scene.kind === "model"
      ? import("@/components/gift-scene-3d").then((m) => m.preloadGiftModel(scene.model.src))
      : scene.kind === "composed"
        ? import("@/components/gift-scene-composed")
        : import("@/components/gift-scene-legendary");
  warm.catch(() => prefetched.delete(key));
}
