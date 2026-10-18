"use client";

import { useState } from "react";
import { isFailedImage } from "@/lib/protected-image";

/**
 * For a profile picture `<img>`: whether to show it, and the props that switch to the caller's fallback (initials,
 * "No photo") once it fails to load — a private avatar after the session expired, a rate-limited, blocked or deleted
 * one — instead of a broken-image icon. Keyed by URL, so a new picture gets a fresh try. The ref covers an `<img>`
 * that failed before hydration attached onError (server-rendered markup).
 */
export function useImageFallback(url: string | null | undefined, onRef?: (el: HTMLImageElement | null) => void) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const show = Boolean(url) && failedUrl !== url;
  const fail = () => setFailedUrl(url ?? null);
  return {
    show,
    imgProps: {
      ref: (el: HTMLImageElement | null) => {
        if (el && isFailedImage(el)) fail();
        else onRef?.(el);
      },
      onError: fail,
    },
  };
}
