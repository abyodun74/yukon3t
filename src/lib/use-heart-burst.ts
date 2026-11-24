"use client";

import { useEffect, useRef, useState } from "react";
import { createHeartBurst, isLowEndDevice, planHearts, type HeartSpec } from "@/lib/heart-burst";

type BurstState = { key: number; hearts: HeartSpec[]; heightPx: number | null; item: string | undefined };

/**
 * `key` is non-null while the hearts show (render the set with it in each key so a restart replays it); `hearts` is
 * its plan and `heightPx` the layer height measured when it started (the CSS rise distance, see globals.css).
 * `show(heightPx)` takes the height of the element the layer covers, read once per burst.
 *
 * `item` (optional) is what is on screen now, in a view that swaps items in place (the Story viewer passes the story
 * id): a heart started for one item is never shown over another (hidden in the same render the item changes, and its
 * timer cleared right after), and `cancel(item)` only hides that item's heart.
 */
export function useHeartBurst(item?: string) {
  const [state, setState] = useState<BurstState | null>(null);
  const ref = useRef<ReturnType<typeof createHeartBurst> | null>(null);
  const nextHeight = useRef<number | null>(null);
  const itemRef = useRef(item);
  useEffect(() => {
    const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const lowEnd = isLowEndDevice(typeof navigator === "undefined" ? undefined : navigator);
    const burst = createHeartBurst({
      onChange: (key, shownFor) => {
        if (key === null) {
          setState(null);
          return;
        }
        const heightPx = nextHeight.current;
        setState({
          key,
          heightPx,
          item: typeof shownFor === "string" ? shownFor : undefined,
          hearts: planHearts(Math.random, reduced(), { lowEnd, heightPx: heightPx ?? undefined }),
        });
      },
      reducedMotion: reduced,
    });
    ref.current = burst;
    return () => {
      burst.dispose();
      ref.current = null;
    };
  }, []);
  // After the burst above exists (effects run in order), so the first item never finds it missing.
  useEffect(() => {
    itemRef.current = item;
    ref.current?.itemChanged(item);
  }, [item]);
  const [api] = useState(() => ({
    show: (heightPx?: number | null) => {
      nextHeight.current = typeof heightPx === "number" && heightPx > 0 ? heightPx : null;
      ref.current?.show(itemRef.current);
    },
    cancel: (forItem?: string) => ref.current?.cancel(forItem),
  }));
  const visible = state !== null && state.item === item;
  return {
    key: visible ? state.key : null,
    hearts: visible ? state.hearts : [],
    heightPx: visible ? state.heightPx : null,
    show: api.show,
    cancel: api.cancel,
  };
}
