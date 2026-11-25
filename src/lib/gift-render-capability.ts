"use client";

import { giftEffectPlan, isLowEndDevice } from "@/lib/gift-effect-plan";
import { giftRenderer, resolveGiftModel } from "@/lib/gift-3d-assets";
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
 * code and its model. Does nothing where the reveal would use the plain stage anyway.
 */
export function prefetchGiftReveal(gift: { tier: GiftTierName; items: readonly { slug: string }[] }): void {
  if (typeof window === "undefined") return;
  const lowEnd = isLowEndDevice(navigator as unknown as Parameters<typeof isLowEndDevice>[0]);
  const { motion } = giftEffectPlan(gift.tier, { reduce: prefersReducedMotion(), lowEnd });
  if (motion !== "full") return;
  const model = resolveGiftModel(gift.items);
  const renderer = giftRenderer({
    tier: gift.tier,
    motion,
    hasModel: model !== null,
    webgl: model !== null && hasWebGL(),
  });
  if (renderer === "three" && model && !prefetched.has(model.src)) {
    prefetched.add(model.src);
    import("@/components/gift-scene-3d").then((m) => m.preloadGiftModel(model.src)).catch(() => prefetched.delete(model.src));
  }
}
