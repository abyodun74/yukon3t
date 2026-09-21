"use client";

import { useEffect, useRef } from "react";
import { discardUpload, prefetchUpload } from "@/lib/upload-client";
import type { UploadKind } from "@/lib/storage";

export type EagerUploadItem = { file: File; kind: UploadKind; withThumb?: boolean };

/**
 * Starts uploading each attached file as soon as it appears in `items`, and deletes the upload of any file that
 * disappears again without having been posted (removed, replaced, or the composer closed). `items` must be memoized
 * by the caller so this only re-runs when the attachments actually change.
 *
 * Files a submit already took are left alone — discardUpload ignores them — so it's safe that the composer clears its
 * attachments after a successful post.
 */
export function useEagerUploads(items: EagerUploadItem[]) {
  const previous = useRef<File[]>([]);

  useEffect(() => {
    const current = new Set(items.map((i) => i.file));
    for (const old of previous.current) {
      if (!current.has(old)) discardUpload(old);
    }
    previous.current = items.map((i) => i.file);
    for (const item of items) prefetchUpload(item.file, item.kind, { withThumb: item.withThumb });
  }, [items]);

  // Unmounting with attachments still in the composer means they were abandoned.
  useEffect(() => {
    return () => {
      for (const file of previous.current) discardUpload(file);
      previous.current = [];
    };
  }, []);
}
