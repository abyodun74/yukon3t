"use client";

import { useSyncExternalStore } from "react";

/**
 * One post PostComposer has submitted but hasn't heard back from the server
 * about yet (or that failed). Deliberately not a full PostCardData — most of
 * that (engagement status, reaction aggregation, connection status) only
 * exists server-side and isn't worth a round trip just to show a "Posting…"
 * placeholder for a few seconds. previewUrl is this store's own
 * URL.createObjectURL(...), independent of the composer's own preview blob
 * URLs (which the composer revokes the moment it resets its fields, right
 * after handing off to this store) — revoked here, by removeOptimisticPost,
 * once this entry's real post has appeared via the normal realtime refetch.
 */
export type OptimisticPost = {
  localId: string;
  content: string;
  previewUrl: string | null;
  previewKind: "image" | "video" | "none";
  authorName: string;
  authorAvatarUrl: string | null;
  createdAt: Date;
  status: "sending" | "error";
  errorMessage?: string;
};

// Same plain-module-state-plus-listeners shape as share-target-store.ts —
// this doesn't need Context ceremony either: PostFeedSection and
// ProfilePostsList both just want "whatever's currently pending," and
// there's realistically only ever one or two of these in flight for a
// single signed-in user in one browser tab.
let posts: OptimisticPost[] = [];
let listeners: Array<() => void> = [];

function emit() {
  listeners.forEach((listener) => listener());
}

export function addOptimisticPost(post: OptimisticPost) {
  posts = [post, ...posts];
  emit();
}

/** Called once the real post exists (success) — revokes this entry's own preview blob URL, its job done. */
export function removeOptimisticPost(localId: string) {
  const entry = posts.find((p) => p.localId === localId);
  if (entry?.previewUrl) URL.revokeObjectURL(entry.previewUrl);
  posts = posts.filter((p) => p.localId !== localId);
  emit();
}

export function markOptimisticPostError(localId: string, message: string) {
  posts = posts.map((p) => (p.localId === localId ? { ...p, status: "error", errorMessage: message } : p));
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

/** Server-render-safe: no pending posts exist before hydration, same as any other purely-client, in-memory state. */
export function useOptimisticPosts(): OptimisticPost[] {
  return useSyncExternalStore(subscribe, () => posts, () => []);
}
