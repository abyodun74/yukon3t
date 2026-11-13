"use client";

import { useEffect, useRef, useState } from "react";
import { GiftArt } from "@/components/gift-art";
import { GIFT_LOTTIE_POSTER_MARKER, resolveGiftAnimation } from "@/lib/gift-assets";

// A premium animated gift (Phase A), played with lottie-web's LIGHT build: the SVG renderer without the expression
// engine, so nothing is ever eval'd and the CSP needs no 'unsafe-eval'; web workers stay off (lottie-web's default), so
// no blob: worker either. The library is imported dynamically, only here and only once such a gift actually renders,
// so it never enters any other route's bundle (gift-lottie-bundle.test.ts). The JSON is fetched same-origin
// (connect-src 'self') and handed over as data; it has no image assets, so nothing else is loaded.
//
// Until the animation is ready, and if anything fails, the item's static art (GiftArt, its poster still) is shown. With
// reduce motion on (the OS setting, passed in as `reduce`) the player stops on the "poster" marker: a still frame, no
// movement.

type LottieAnimation = { destroy: () => void; goToAndStop: (value: number, isFrame?: boolean) => void; play: () => void };
type LottieData = { markers?: { cm?: string; tm?: number }[] };

const dataCache = new Map<string, Promise<LottieData>>();

function loadData(src: string): Promise<LottieData> {
  let pending = dataCache.get(src);
  if (!pending) {
    pending = fetch(src, { credentials: "same-origin" }).then((response) => {
      if (!response.ok) throw new Error(`lottie ${response.status}`);
      return response.json() as Promise<LottieData>;
    });
    pending.catch(() => dataCache.delete(src));
    dataCache.set(src, pending);
  }
  return pending;
}

/** The frame of the "poster" marker, or 0. */
export function posterFrame(data: LottieData): number {
  const marker = data.markers?.find((m) => m.cm === GIFT_LOTTIE_POSTER_MARKER);
  return typeof marker?.tm === "number" ? marker.tm : 0;
}

export function GiftLottie({
  assetKey,
  name,
  size,
  reduce,
  onDone,
}: {
  assetKey: string;
  name: string;
  size: number;
  reduce: boolean;
  /** Called once a non-looping animation has finished. */
  onDone?: () => void;
}) {
  const asset = resolveGiftAnimation(assetKey);
  const container = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!asset || !container.current) return;
    let cancelled = false;
    let animation: LottieAnimation | null = null;
    const host = container.current;
    Promise.all([loadData(asset.src), import("lottie-web/build/player/lottie_light")])
      .then(([data, lottieModule]) => {
        if (cancelled) return;
        const lottie = lottieModule.default;
        animation = lottie.loadAnimation({
          container: host,
          renderer: "svg",
          loop: asset.loop && !reduce,
          autoplay: false,
          // A copy: lottie-web annotates the object it is given, and the cached data is shared.
          animationData: structuredClone(data),
          rendererSettings: { preserveAspectRatio: "xMidYMid meet", progressiveLoad: false },
        }) as unknown as LottieAnimation;
        if (reduce) animation.goToAndStop(posterFrame(data), true);
        else {
          (animation as unknown as { addEventListener: (e: string, f: () => void) => void }).addEventListener("complete", () => onDone?.());
          animation.play();
        }
        setReady(true);
      })
      .catch(() => {
        // The still art stays: an animation is decoration, never required.
      });
    return () => {
      cancelled = true;
      animation?.destroy();
    };
    // onDone is a notification only; restarting the animation when the caller re-renders would be wrong.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset, reduce]);

  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }} role="img" aria-label={name}>
      {!ready && <GiftArt assetKey={assetKey} name={name} size={size} eager className="absolute inset-0" />}
      <span ref={container} aria-hidden className="absolute inset-0 block" />
    </span>
  );
}
