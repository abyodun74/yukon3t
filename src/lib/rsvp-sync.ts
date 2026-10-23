"use client";

import { useEffect, useRef } from "react";
import type { RsvpStatus } from "@/lib/rsvp";

/**
 * Keeps every RSVP button for one event on the page in step: a Circle page shows an upcoming event both in "Coming up"
 * and as its post in the channel feed, each with its own optimistic state, so a tap on one announces the server's
 * answer and the other updates instead of showing the old count. Same tab only; nothing leaves the page.
 */

const EVENT_NAME = "yk:rsvp-changed";

/** The caller's reply after a change, and the event's fresh Going / Maybe counts (from setRsvp). */
export type RsvpChange = {
  postId: string;
  status: RsvpStatus | null;
  rsvpCount: number;
  maybeCount: number;
  source: symbol;
};

export function announceRsvp(change: RsvpChange) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<RsvpChange>(EVENT_NAME, { detail: change }));
}

/** Calls `onChange` for changes to `postId` announced by any other button (`source` identifies the caller's own). */
export function useRsvpSync(postId: string, source: symbol, onChange: (change: RsvpChange) => void) {
  const handler = useRef(onChange);
  useEffect(() => {
    handler.current = onChange;
  });
  useEffect(() => {
    function listener(e: Event) {
      const change = (e as CustomEvent<RsvpChange>).detail;
      if (change && change.postId === postId && change.source !== source) handler.current(change);
    }
    window.addEventListener(EVENT_NAME, listener);
    return () => window.removeEventListener(EVENT_NAME, listener);
  }, [postId, source]);
}
