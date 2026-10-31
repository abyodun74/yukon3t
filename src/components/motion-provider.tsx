"use client";

import { LazyMotion, MotionConfig } from "motion/react";
import type { ReactNode } from "react";

const loadMotionFeatures = () => import("@/lib/motion-features").then((mod) => mod.default);

/**
 * The app's one motion root, mounted by the root layout around everything.
 *
 * - `MotionConfig reducedMotion="user"`: every animation honours the OS "reduce motion" setting.
 * - `LazyMotion`: components animate through the small `m` components (`motion/react-m`), and the animation, gesture
 *   and drag code (~36KB gzipped, src/lib/motion-features.ts) arrives in its own chunk, requested right after
 *   hydration instead of being parsed before first paint on every route. `strict` makes a full `motion.*` component
 *   (which would pull all of it back into the first-load bundle) an error in development.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={loadMotionFeatures} strict>
        {children}
      </LazyMotion>
    </MotionConfig>
  );
}
