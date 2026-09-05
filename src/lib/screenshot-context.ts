"use client";

import { useEffect } from "react";

/**
 * What the user is currently looking at, for attributing an app-wide
 * screenshot event (see global-call-frame.tsx's non-call branch) to a
 * specific post/story/conversation/profile owner. Plain module-level state
 * rather than React context — only ever read at the moment a screenshot
 * fires, never rendered from, so a context provider/re-render on every
 * navigation would be pure overhead for no benefit.
 */
// Deliberately just a type + id, not the owner too — notifyScreenshotTaken
// (actions/screenshot.ts) re-derives the real owner server-side from this id
// rather than trusting a client-supplied one.
export type ScreenshotContext =
  | { type: "post"; id: string }
  | { type: "story"; id: string }
  | { type: "conversation"; id: string }
  | { type: "profile"; id: string };

let current: ScreenshotContext | null = null;

export function getScreenshotContext(): ScreenshotContext | null {
  return current;
}

/** Sets the current viewing context for the lifetime of the calling component, clearing it on unmount. */
export function useScreenshotContext(ctx: ScreenshotContext | null) {
  useEffect(() => {
    current = ctx;
    return () => {
      // Only clear if nothing else has taken over in the meantime (e.g. a
      // fast navigation where the next page's effect already ran first).
      if (current === ctx) current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx && JSON.stringify(ctx)]);
}
