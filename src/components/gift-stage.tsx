"use client";

import { Component, Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { GiftArt } from "@/components/gift-art";
import { GiftSignatureMotion } from "@/components/gift-signature-motion";
import { giftRenderer, resolveGiftScene } from "@/lib/gift-3d-assets";
import { giftEffectPlan, isLowEndDevice, sparkleSpots } from "@/lib/gift-effect-plan";
import { legendaryHitMs } from "@/lib/gift-legendary-plan";
import { hasWebGL } from "@/lib/gift-render-capability";
import { giftSignatureFor } from "@/lib/gift-signature-motion";
import type { GiftTierName } from "@/lib/gift-market";

// The richer renderers are separate chunks, fetched only when a reveal actually renders one (never on the server, never
// in the grid's compact cards): three.js + React Three Fiber for Epic / Legendary, a GLB model or, for the Luxury Red
// Rose and the Gold Orchid, the cinematic scene around their artwork.
const GiftScene3D = dynamic(() => import("@/components/gift-scene-3d"), { ssr: false, loading: () => null });
const GiftSceneLegendary = dynamic(() => import("@/components/gift-scene-legendary"), { ssr: false, loading: () => null });

/** A renderer that throws (a chunk that failed to load, a broken model) hands back to the plain stage. */
class RendererBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

type NavigatorHints = Parameters<typeof isLowEndDevice>[0];
const noopSubscribe = () => () => {};
const readLowEnd = () => isLowEndDevice(navigator as unknown as NavigatorHints);

/** True on a device that is likely to struggle (see isLowEndDevice); false while rendering on the server. */
export function useLowEndDevice(): boolean {
  return useSyncExternalStore(noopSubscribe, readLowEnd, () => false);
}

/**
 * THE gift reveal: the one component both the marketplace Preview and the recipient's open screen (gift-open-overlay)
 * render, so a buyer sees exactly what the recipient will. What it plays is decided by giftEffectPlan
 * (src/lib/gift-effect-plan.ts, unit-tested) from the rarity tier: Common the art rising in; Rare adds a halo and
 * sparkles; Epic adds layered depth (rings, floor shadow, slow tilt); Legendary adds a cinematic sequence (letterbox
 * bars, one soft light bloom, rotating rays, then the art). Transform and opacity only (globals.css "Gift marketplace
 * tiers"), no flashing, no sound, no network assets. The art is the gift's static picture (GiftArt).
 *
 * With reduce motion on, every layer is drawn in its final pose and the art only fades in; on a low-end device the plan drops to fewer sparkles, one ring and no cinematic bars. `compact` is the
 * grid's small card: halo only, nothing moves. Decorative: the name next to it is what screen readers get. `playKey`
 * restarts the whole sequence (Replay).
 *
 * Epic and Legendary gifts with a 3D scene (src/lib/gift-3d-assets.ts, resolveGiftScene: a GLB model, or for the
 * Luxury Red Rose and the Gold Orchid the cinematic scene around their artwork, gift-scene-legendary.tsx) play it over
 * the stage's layers instead of the flat art, only with full motion (giftRenderer: never with reduce motion or on a
 * low-end device), only where the browser has WebGL and never in a compact card.
 * The static art stays underneath as the poster until the scene is ready, and is what remains if it fails or the
 * WebGL context is lost. Replay restarts the scene without recreating its canvas. `climaxCount` (the reveal's sound
 * climax cues) adds a light pulse to the legendary scene.
 *
 * A single-item gift with a signature motion (src/lib/gift-signature-motion.ts: Wave, High five, Birthday Balloons,
 * Confetti) plays GiftSignatureMotion instead of the art's generic entrance (and never the 3D scene); the tier's
 * halo, sparkles and depth rings stay around it. Replay remounts it, so it starts over.
 */
export function GiftStage({
  tier,
  items,
  name,
  size,
  playKey = 0,
  reduce,
  playAnimation = true,
  compact = false,
  climaxCount = 0,
  className,
}: {
  tier: GiftTierName;
  items: { slug: string; assetKey: string }[];
  name: string;
  size: number;
  playKey?: number;
  reduce: boolean;
  /** false: never load the 3D renderer (the grid's small cards); the static art only. */
  playAnimation?: boolean;
  compact?: boolean;
  /** How many climax cues the reveal's sound has reached (the legendary scene pulses on each). */
  climaxCount?: number;
  className?: string;
}) {
  const lowEnd = useLowEndDevice();
  const plan = giftEffectPlan(tier, { reduce, lowEnd });
  const rich = !compact;
  const signature = rich && playAnimation ? giftSignatureFor(items) : null;
  const scene = rich && playAnimation && !signature ? resolveGiftScene(items) : null;
  const webgl = useSyncExternalStore(noopSubscribe, () => scene !== null && plan.motion === "full" && hasWebGL(), () => false);
  const [failed, setFailed] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const onSceneReady = useCallback(() => setSceneReady(true), []);
  const onSceneFailed = useCallback(() => {
    setFailed(true);
    setSceneReady(false);
  }, []);
  const renderer = failed
    ? "stage"
    : giftRenderer({ tier, motion: plan.motion, webgl, hasScene: scene !== null, hasSignature: signature !== null });
  // When this play (or Replay) started: the legendary scene's clock, so a scene that loads late joins the timeline.
  const playStartRef = useRef(0);
  useEffect(() => {
    playStartRef.current = performance.now();
  }, [playKey]);
  const particles = (tier === "EPIC" || tier === "LEGENDARY") && (compact || plan.motion !== "light");
  const sweep = tier === "LEGENDARY" && (compact || plan.motion !== "light");
  const spots = rich ? sparkleSpots(plan.sparkles) : [];
  const style = { "--fx-ms": `${plan.durationMs}ms` } as CSSProperties;
  return (
    <div
      className={`gift-stage gift-tier-${tier.toLowerCase()} gift-fx-${plan.motion} ${compact ? "gift-stage-still" : ""} ${rich && plan.cinematic ? "gift-fx-cinematic" : ""} flex items-center justify-center ${className ?? ""}`}
      style={style}
      aria-hidden
    >
      <Fragment key={playKey}>
        {plan.halo && <span className="gift-stage-halo" />}
        {particles && <span className="gift-stage-particles" />}
        {sweep && <span className="gift-stage-sweep" />}
        {rich && plan.cinematic && (
          <>
            <span className="gift-fx-rays" />
            <span className="gift-fx-bloom" />
            <span className="gift-fx-bar gift-fx-bar-top" />
            <span className="gift-fx-bar gift-fx-bar-bottom" />
          </>
        )}
        {rich && plan.depthLayers > 0 && (
          <span className="gift-fx-depth">
            {Array.from({ length: plan.depthLayers }, (_, i) => (
              <span key={i} className="gift-fx-ring" style={{ "--i": i } as CSSProperties} />
            ))}
            <span className="gift-fx-floor" />
          </span>
        )}
        {spots.map((s, i) => (
          <span
            key={i}
            className="gift-fx-sparkle"
            style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.size, height: s.size, "--d": `${s.delayMs}ms` } as CSSProperties}
          />
        ))}
        {signature ? (
          <GiftSignatureMotion
            kind={signature}
            tier={tier}
            reduce={reduce}
            lowEnd={lowEnd}
            assetKey={items[0].assetKey}
            name={name}
            size={size}
          />
        ) : (
          <span
            className={`gift-stage-art flex flex-wrap items-center justify-center gap-2 transition-opacity duration-300 ${sceneReady && renderer !== "stage" ? "opacity-0" : ""}`}
          >
            <span className={`gift-fx-tilt flex flex-wrap items-center justify-center gap-2 ${rich && plan.depthLayers > 0 ? "gift-fx-tilt-on" : ""}`}>
              {items.map((item, i) => (
                <GiftArt key={`${item.slug}-${i}`} assetKey={item.assetKey} name={name} size={items.length > 1 ? Math.round(size / 2) : size} eager />
              ))}
            </span>
          </span>
        )}
      </Fragment>
      {renderer === "three" && scene && (
        <span className="gift-stage-scene">
          <RendererBoundary onError={onSceneFailed}>
            {scene.kind === "legendary" ? (
              <GiftSceneLegendary
                variant={scene.variant}
                artSrc={scene.artSrc}
                artSize={size}
                playKey={playKey}
                playStartRef={playStartRef}
                hitMs={legendaryHitMs(plan)}
                climaxCount={climaxCount}
                lowEnd={lowEnd}
                onReady={onSceneReady}
                onFallback={onSceneFailed}
              />
            ) : (
              <GiftScene3D
                src={scene.model.src}
                tier={tier}
                durationMs={plan.durationMs}
                playKey={playKey}
                lowEnd={lowEnd}
                onReady={onSceneReady}
                onFallback={onSceneFailed}
              />
            )}
          </RendererBoundary>
        </span>
      )}
    </div>
  );
}
