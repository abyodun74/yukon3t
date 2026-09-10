"use client";

import type { PendingShareMedia } from "@/lib/share-receiver";

// A plain module-level holder, not React state — ShareTargetGate sets this
// right before a client-side navigation to wherever the user chose ("New
// Post" -> /home, "Send Message" -> /messages/new), and the destination
// component reads it once on mount. One value in flight at a time is the
// only case that can actually happen (a single Share-sheet hand-off), so
// this doesn't need the ceremony of a Context provider.
let pending: PendingShareMedia | null = null;

export function setPendingShareMedia(media: PendingShareMedia) {
  pending = media;
}

/** Reads and clears in the same call, so the destination component only ever consumes it once even if it re-mounts (e.g. a fast-refresh in dev, or React StrictMode's double-invoke). */
export function consumePendingShareMedia(): PendingShareMedia | null {
  const value = pending;
  pending = null;
  return value;
}
