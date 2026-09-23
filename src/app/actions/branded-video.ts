"use server";

import { requireVerifiedUser } from "@/lib/auth-guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { getOrAdvanceBrandedVideo, isBrandingConfigured, type BrandedVideoResult } from "@/lib/branded-video-service";

// Bounds a single call's own Cloudflare Stream round-trip — the client's own
// poll loop (src/lib/branded-video-client.ts) is what provides the overall
// wait, this only stops one call from hanging the request indefinitely.
const REQUEST_TIMEOUT_MS = 12_000;

/**
 * On-demand entry point for branding a video before a native share attaches
 * it — see branded-video-service.ts's own doc comment for the full picture.
 * Called repeatedly by the client's short poll loop while "Share via
 * device" shows "Preparing…"; each call both checks and opportunistically
 * advances the underlying job by one step, so the very first call already
 * starts the Cloudflare Stream copy rather than waiting for the next
 * brand-shared-videos cron tick.
 */
export async function getBrandedVideoStatus(sourceUrl: string): Promise<BrandedVideoResult> {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("brandedVideo", user.id);
  if (!allowed) return { status: "pending" };

  if (!isBrandingConfigured()) return { status: "unavailable" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await getOrAdvanceBrandedVideo(sourceUrl, controller.signal);
  } catch (err) {
    console.error("[getBrandedVideoStatus] failed", err);
    return { status: "pending" };
  } finally {
    clearTimeout(timeout);
  }
}
