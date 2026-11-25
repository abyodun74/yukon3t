"use client";

import { Component, Fragment, useCallback, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { GiftArt } from "@/components/gift-art";
import { GiftLottie } from "@/components/gift-lottie";
import { resolveGiftAnimation } from "@/lib/gift-assets";
import { giftRenderer, resolveGiftModel } from "@/lib/gift-3d-assets";
import { giftEffectPlan, isLowEndDevice, sparkleSpots } from "@/lib/gift-effect-plan";
import { hasWebGL } from "@/lib/gift-render-capability";
import type { GiftTierName } from "@/lib/gift-market";

// The richer renderers are separate chunks, fetched only when a reveal actually renders one (never on the server, never
// in the grid's compact cards): three.js + React Three Fiber for Epic / Legendary.
const GiftScene3D = dynamic(() => import("@/components/gift-scene-3d"), { ssr: false, loading: () => null });

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
 * tiers"), no flashing, no sound, no network assets. A gift with a Lottie animation plays it (lottie-web's light
 * build, loaded only now, gift-lottie.tsx); until it is ready, and if it fails, the static art is shown.
 *
 * With reduce motion on, every layer is drawn in its final pose and the art only fades in (the Lottie shows its poster
 * frame); on a low-end device the plan drops to fewer sparkles, one ring and no cinematic bars. `compact` is the
 * grid's small card: halo only, nothing moves. Decorative: the name next to it is what screen readers get. `playKey`
 * restarts the whole sequence (Replay).
 *
 * Epic and Legendary gifts with a model (src/lib/gift-3d-assets.ts) play a small 3D scene over the stage's layers
 * instead of the flat art, only with full motion (giftRenderer: never with reduce motion or on a low-end device),
 * only where the browser has WebGL and never in a compact card.
 * The static art stays underneath as the poster until the scene is ready, and is what remains if it fails or the
 * WebGL context is lost. Replay restarts the scene without recreating its canvas.
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
  className,
}: {
  tier: GiftTierName;
  items: { slug: string; assetKey: string }[];
  name: string;
  size: number;
  playKey?: number;
  reduce: boolean;
  /** false: never load the Lottie player (the grid's small cards); the static art only. */
  playAnimation?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const lowEnd = useLowEndDevice();
  const plan = giftEffectPlan(tier, { reduce, lowEnd });
  const single = items.length === 1 ? items[0] : null;
  const rich = !compact;
  const model = rich && playAnimation ? resolveGiftModel(items) : null;
  const webgl = useSyncExternalStore(noopSubscribe, () => model !== null && plan.motion === "full" && hasWebGL(), () => false);
  const [failed, setFailed] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const onSceneReady = useCallback(() => setSceneReady(true), []);
  const onSceneFailed = useCallback(() => {
    setFailed(true);
    setSceneReady(false);
  }, []);
  const renderer = failed
    ? "stage"
    : giftRenderer({ tier, motion: plan.motion, webgl, hasModel: model !== null });
  const animated = renderer === "stage" && playAnimation && single && resolveGiftAnimation(single.assetKey) ? single : null;
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
        <span
          className={`gift-stage-art flex flex-wrap items-center justify-center gap-2 transition-opacity duration-300 ${sceneReady && renderer !== "stage" ? "opacity-0" : ""}`}
        >
          <span className={`gift-fx-tilt flex flex-wrap items-center justify-center gap-2 ${rich && plan.depthLayers > 0 ? "gift-fx-tilt-on" : ""}`}>
            {animated ? (
              <GiftLottie assetKey={animated.assetKey} name={name} size={size} reduce={reduce} />
            ) : (
              items.map((item, i) => (
                <GiftArt key={`${item.slug}-${i}`} assetKey={item.assetKey} name={name} size={items.length > 1 ? Math.round(size / 2) : size} eager />
              ))
            )}
          </span>
        </span>
      </Fragment>
      {renderer === "three" && model && (
        <span className="gift-stage-scene">
          <RendererBoundary onError={onSceneFailed}>
            <GiftScene3D
              src={model.src}
              tier={tier}
              durationMs={plan.durationMs}
              playKey={playKey}
              lowEnd={lowEnd}
              onReady={onSceneReady}
              onFallback={onSceneFailed}
            />
          </RendererBoundary>
        </span>
      )}
    </div>
  );
}
