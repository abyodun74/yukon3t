"use client";

import { GiftArt } from "@/components/gift-art";
import { GiftLottie } from "@/components/gift-lottie";
import { resolveGiftAnimation } from "@/lib/gift-assets";
import type { GiftTierName } from "@/lib/gift-market";

/**
 * A gift shown large, with its rarity tier's treatment (globals.css "Gift marketplace tiers"): a tinted backdrop for
 * every tier, a halo from Rare up, particles from Epic up, a light sweep for Legendary. A gift with a Lottie animation
 * plays it (lottie-web's light build, loaded only now, gift-lottie.tsx); until it is ready, and if it fails, the
 * static art is shown. With reduce motion on, everything is still: the animation's poster frame, no drifting layers.
 * No sound, ever. Decorative: the name next to it is what screen readers get. `playKey` restarts the entrance
 * (Replay). `reduce` also stills the CSS layers (`.gift-stage-still`): the grid passes it always, so only the open
 * preview moves.
 */
export function GiftStage({
  tier,
  items,
  name,
  size,
  playKey = 0,
  reduce,
  playAnimation = true,
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
  className?: string;
}) {
  const single = items.length === 1 ? items[0] : null;
  const animated = playAnimation && single && resolveGiftAnimation(single.assetKey) ? single : null;
  return (
    <div
      className={`gift-stage gift-tier-${tier.toLowerCase()} ${reduce ? "gift-stage-still" : ""} flex items-center justify-center ${className ?? ""}`}
      aria-hidden
    >
      {tier !== "COMMON" && <span className="gift-stage-halo" />}
      {(tier === "EPIC" || tier === "LEGENDARY") && <span className="gift-stage-particles" />}
      {tier === "LEGENDARY" && <span className="gift-stage-sweep" />}
      <span key={playKey} className="gift-stage-art flex flex-wrap items-center justify-center gap-2">
        {animated ? (
          <GiftLottie assetKey={animated.assetKey} name={name} size={size} reduce={reduce} />
        ) : (
          items.map((item, i) => (
            <GiftArt key={`${item.slug}-${i}`} assetKey={item.assetKey} name={name} size={items.length > 1 ? Math.round(size / 2) : size} eager />
          ))
        )}
      </span>
    </div>
  );
}
