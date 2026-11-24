"use client";

import { useEffect, useRef, useState } from "react";
import { createHeartBurst, isLowEndDevice, planHearts, type HeartSpec } from "@/lib/heart-burst";

type BurstState = { key: number; hearts: HeartSpec[]; heightPx: number | null };

/**
 * `key` is non-null while the hearts show (render the set with it in each key so a restart replays it); `hearts` is
 * its plan and `heightPx` the layer height measured when it started (the CSS rise distance, see globals.css).
 * `show(heightPx)` takes the height of the element the layer covers, read once per burst.
 */
export function useHeartBurst() {
  const [state, setState] = useState<BurstState | null>(null);
  const ref = useRef<ReturnType<typeof createHeartBurst> | null>(null);
  const nextHeight = useRef<number | null>(null);
  useEffect(() => {
    const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const lowEnd = isLowEndDevice(typeof navigator === "undefined" ? undefined : navigator);
    const burst = createHeartBurst({
      onChange: (key) => {
        if (key === null) {
          setState(null);
          return;
        }
        const heightPx = nextHeight.current;
        setState({ key, heightPx, hearts: planHearts(Math.random, reduced(), { lowEnd, heightPx: heightPx ?? undefined }) });
      },
      reducedMotion: reduced,
    });
    ref.current = burst;
    return () => {
      burst.dispose();
      ref.current = null;
    };
  }, []);
  const [api] = useState(() => ({
    show: (heightPx?: number | null) => {
      nextHeight.current = typeof heightPx === "number" && heightPx > 0 ? heightPx : null;
      ref.current?.show();
    },
    cancel: () => ref.current?.cancel(),
  }));
  return {
    key: state?.key ?? null,
    hearts: state?.hearts ?? [],
    heightPx: state?.heightPx ?? null,
    show: api.show,
    cancel: api.cancel,
  };
}
