"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { acquireGiftCanvas, giftCanvasDpr, giftCanvasHolder, subscribeGiftCanvas } from "@/lib/gift-3d-assets";

// The one WebGL canvas a gift reveal's 3D scene draws into (gift-scene-3d.tsx, gift-scene-legendary.tsx); only those
// lazily loaded chunks import it. Budget rules: one canvas app-wide (acquireGiftCanvas; a second reveal falls back to
// the stage), frameloop "demand" (a frame is drawn only when the scene asks for one, never while the page is hidden),
// DPR capped at 2 (1.25 on a low-end device). On unmount React Three Fiber disposes the renderer and releases the
// WebGL context (that forced context loss is not a failure); any other lost context hands back to the CSS stage
// through onFallback.

export const GIFT_CANVAS_FOV = 35;

export function GiftCanvas({ lowEnd, onFallback, children }: { lowEnd: boolean; onFallback: () => void; children: ReactNode }) {
  const [token] = useState(() => Symbol("gift-canvas"));
  const leased = useSyncExternalStore(subscribeGiftCanvas, () => giftCanvasHolder() === token, () => false);
  const fallbackRef = useRef(onFallback);
  useEffect(() => {
    fallbackRef.current = onFallback;
  });
  const closingRef = useRef(false);

  useEffect(() => {
    closingRef.current = false;
    const release = acquireGiftCanvas(token);
    if (!release) {
      fallbackRef.current();
      return undefined;
    }
    return () => {
      closingRef.current = true;
      release();
    };
  }, [token]);

  if (!leased) return null;
  return (
    <Canvas
      aria-hidden
      frameloop="demand"
      dpr={giftCanvasDpr(window.devicePixelRatio, lowEnd)}
      gl={{ alpha: true, antialias: !lowEnd, powerPreference: "low-power", failIfMajorPerformanceCaveat: true }}
      camera={{ position: [0, 0, 4.2], fov: GIFT_CANVAS_FOV }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener("webglcontextlost", (event) => {
          event.preventDefault();
          // React Three Fiber forces this loss from an insertion-effect cleanup, before our own cleanup marks the
          // canvas as closing: look one task later, once the unmount's cleanups have all run.
          setTimeout(() => {
            if (!closingRef.current) fallbackRef.current();
          }, 0);
        });
      }}
    >
      {children}
    </Canvas>
  );
}
