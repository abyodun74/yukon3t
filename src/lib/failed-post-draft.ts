"use client";

import { discardUpload, releaseUploads } from "@/lib/upload-client";
import type { RetryAdvice } from "@/lib/post-submit-attempt";

/**
 * A Home/profile post that couldn't be sent, kept so it goes back into the composer instead of being lost. The
 * composer clears itself the moment Post is tapped (the feed shows an optimistic "Posting..." card meanwhile), so on a
 * failure the draft (text, audience, attachments, the uploads already done for them) is parked here: the composer
 * takes it back right away if it is on screen and empty, or when it next mounts (the failed card's Retry opens it).
 * Only one draft is kept; a newer failure replaces an older one, whose uploads are then given up like any abandoned
 * attachment. Plain module state plus listeners, like optimistic-posts-store.ts.
 */
export type FailedPostDraft = {
  /** The optimistic card it belongs to. */
  localId: string;
  content: string;
  visibility: string | null;
  images: File[];
  urlImages: string[];
  video: File | null;
  videoDurationSeconds: number | null;
  nativeVideoUpload: { videoUrl: string; videoThumbnailUrl?: string; videoDurationSeconds?: number; name: string } | null;
  embedUrl: string | null;
  pendingGif: string | null;
  /** The specific sentence to show again in the composer. */
  message: string;
  advice: RetryAdvice;
};

let draft: FailedPostDraft | null = null;
let listeners: Array<() => void> = [];

function emit() {
  listeners.forEach((listener) => listener());
}

function giveUpUploads(d: FailedPostDraft) {
  const files = [...d.images, ...(d.video ? [d.video] : [])];
  releaseUploads(files);
  files.forEach((file) => discardUpload(file));
}

/** Parks a failed draft (replacing, and giving up, any older one). Returns the localId it replaced, if any. */
export function stashFailedPostDraft(next: FailedPostDraft): string | null {
  const replaced = draft && draft.localId !== next.localId ? draft : null;
  if (replaced) giveUpUploads(replaced);
  draft = next;
  emit();
  return replaced?.localId ?? null;
}

/** Hands the parked draft to a composer (and forgets it here). */
export function takeFailedPostDraft(): FailedPostDraft | null {
  const taken = draft;
  draft = null;
  return taken;
}

export function hasFailedPostDraft(localId: string): boolean {
  return draft?.localId === localId;
}

/** The failed card was dismissed: the draft is abandoned, and so are its uploads. */
export function dropFailedPostDraft(localId: string) {
  if (!draft || draft.localId !== localId) return;
  giveUpUploads(draft);
  draft = null;
  emit();
}

export function subscribeFailedPostDraft(listener: () => void): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}
