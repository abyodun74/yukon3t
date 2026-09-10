"use client";

import type { PendingShareMedia } from "@/lib/share-receiver";

// A plain module-level holder plus a tiny subscriber list, not React state —
// ShareTargetGate sets this right before a client-side navigation to
// wherever the user chose ("New post" -> /home, "Send to a friend" ->
// /messages/[id]). The subscription is what actually matters: confirmed
// live that when the destination is a route already mounted (the common
// case for "New post" — the composer lives inline on /home, which is
// where ShareTargetGate itself renders over), router.push() to the same
// URL doesn't remount anything, so a plain "read once on mount" consumer
// never sees it. Subscribers get notified on every set, whether or not
// they happen to already be mounted. One value in flight at a time is the
// only case that can actually happen (a single Share-sheet hand-off), so
// this doesn't need the ceremony of a Context provider.
let pending: PendingShareMedia | null = null;
let listeners: Array<() => void> = [];

export function setPendingShareMedia(media: PendingShareMedia) {
  pending = media;
  listeners.forEach((listener) => listener());
}

/** Reads and clears in the same call, so a given consumer only ever gets a share once even if both its mount check and the subscription below fire for the same one (e.g. mounting fresh right as it's set). */
export function consumePendingShareMedia(): PendingShareMedia | null {
  const value = pending;
  pending = null;
  return value;
}

/** Notified on every setPendingShareMedia() call — call consumePendingShareMedia() from the listener to actually retrieve it. Returns an unsubscribe function. */
export function subscribePendingShareMedia(listener: () => void): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}
