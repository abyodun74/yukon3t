"use client";

import { useEffect, useRef, useState } from "react";
import { createHeartBurst, planHearts, type HeartSpec } from "@/lib/heart-burst";

/** `key` is non-null while the hearts show (render the set with it in each key so a restart replays it); `hearts` is its plan. */
export function useHeartBurst() {
  const [state, setState] = useState<{ key: number; hearts: HeartSpec[] } | null>(null);
  const ref = useRef<ReturnType<typeof createHeartBurst> | null>(null);
  useEffect(() => {
    const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const burst = createHeartBurst({
      onChange: (key) => setState(key === null ? null : { key, hearts: planHearts(Math.random, reduced()) }),
      reducedMotion: reduced,
    });
    ref.current = burst;
    return () => {
      burst.dispose();
      ref.current = null;
    };
  }, []);
  const [api] = useState(() => ({
    show: () => ref.current?.show(),
    cancel: () => ref.current?.cancel(),
  }));
  return { key: state?.key ?? null, hearts: state?.hearts ?? [], show: api.show, cancel: api.cancel };
}
