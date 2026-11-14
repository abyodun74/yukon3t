"use client";

import { LazyMotion, MotionConfig } from "motion/react";
import type { ReactNode } from "react";
import { APP_DEFAULT_TRANSITION } from "@/lib/motion-defaults";

const loadMotionFeatures = () => import("@/lib/motion-features").then((mod) => mod.default);

/**
 * The app's one motion root, mounted by the root layout around everything.
 *
 * - `MotionConfig reducedMotion="user"`: every animation honours the OS "reduce motion" setting.
 * - `transition={APP_DEFAULT_TRANSITION}`: anything animated without its own `transition` gets a 0.2s ease-out tween
 *   instead of motion's default spring for transforms, so nothing bounces by omission (src/lib/motion-defaults.ts).
 *   Don't add a nested MotionConfig with a spring `transition`: it would replace this for everything below it.
 * - `LazyMotion`: components animate through the small `m` components (`motion/react-m`), and the animation, gesture
 *   and drag code (~36KB gzipped, src/lib/motion-features.ts) arrives in its own chunk, requested right after
 *   hydration instead of being parsed before first paint on every route. `strict` makes a full `motion.*` component
 *   (which would pull all of it back into the first-load bundle) an error in development.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={APP_DEFAULT_TRANSITION}>
      <LazyMotion features={loadMotionFeatures} strict>
        {children}
      </LazyMotion>
    </MotionConfig>
  );
}
