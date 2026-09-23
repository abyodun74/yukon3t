"use client";

import { getBrandedVideoStatus } from "@/app/actions/branded-video";

const POLL_INTERVAL_MS = 2500;
// Most videos this app shares are short (a Story/Muse clip, a post video) —
// Cloudflare Stream typically encodes those well within this window. A
// longer video that doesn't finish in time still gets shared, just
// unwatermarked (see the fallback below) — the brand-shared-videos cron
// finishes the job in the background regardless, so the *next* time that
// same video is shared it's already branded and this returns instantly.
const MAX_WAIT_MS = 20_000;

/**
 * Best-effort: resolves to a yukon3t-watermarked copy of this video if
 * Cloudflare Stream can produce one within a short bounded wait, otherwise
 * the original URL unchanged — a share should never be blocked indefinitely,
 * or fail outright, over branding not being ready yet. Never throws.
 */
export async function resolveBrandedVideoUrl(sourceUrl: string): Promise<string> {
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      const result = await getBrandedVideoStatus(sourceUrl);
      if (result.status === "ready") return result.url;
      if (result.status === "failed" || result.status === "unavailable") return sourceUrl;
    } catch {
      return sourceUrl;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return sourceUrl;
}
