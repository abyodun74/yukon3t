"use client";

import { useScreenshotContext, type ScreenshotContext } from "@/lib/screenshot-context";

/** Drop into any page that should attribute an app-wide screenshot (see screenshot-guard.tsx) to itself while mounted. */
export function ScreenshotContextTracker({ context }: { context: ScreenshotContext }) {
  useScreenshotContext(context);
  return null;
}
