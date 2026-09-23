import { prisma } from "@/lib/prisma";
import { isStreamConfigured } from "@/lib/cloudflare-stream";
import { advanceBranding, MAX_BRANDING_ATTEMPTS } from "@/lib/branded-video";
import { productionBrandingDeps } from "@/lib/branded-video-db";

export type BrandedVideoResult =
  | { status: "ready"; url: string }
  | { status: "pending" }
  | { status: "failed" }
  /** Cloudflare Stream or the watermark profile isn't configured — caller should fall back to the unwatermarked original immediately, not poll. */
  | { status: "unavailable" };

/** True once both Cloudflare Stream and a watermark profile are configured — see scripts/upload-cloudflare-watermark.mjs for the one-time profile setup this env var comes from. */
export function isBrandingConfigured(): boolean {
  return isStreamConfigured() && Boolean(process.env.CLOUDFLARE_STREAM_WATERMARK_UID);
}

/**
 * Finds (or creates) this video's BrandedVideoRendition row, advances it by
 * one step, and returns its current status — the single entry point both
 * the on-demand server action (src/app/actions/branded-video.ts, called
 * from a native-share attempt) and the brand-shared-videos cron (the
 * authoritative sweeper for anything a share request didn't finish
 * advancing itself) share, so there's exactly one place this state machine
 * is actually driven from.
 *
 * Deliberately does no row-claiming/locking the way the cron's own
 * `driveConversion` does for VideoConversion — this is a low-stakes,
 * best-effort feature (worst case of a rare double-call race is one wasted
 * extra Cloudflare Stream copy, not a correctness bug, since every step is
 * itself idempotent-safe: creating a second Stream copy for the same source
 * just means the first one's uid gets overwritten and never cleaned up,
 * acceptable for how infrequently this actually happens at this feature's
 * expected volume).
 */
export async function getOrAdvanceBrandedVideo(sourceUrl: string, signal: AbortSignal): Promise<BrandedVideoResult> {
  const watermarkUid = process.env.CLOUDFLARE_STREAM_WATERMARK_UID;
  if (!isStreamConfigured() || !watermarkUid) return { status: "unavailable" };

  let row = await prisma.brandedVideoRendition.findUnique({ where: { sourceUrl } });
  if (!row) {
    try {
      row = await prisma.brandedVideoRendition.create({ data: { sourceUrl } });
    } catch {
      // Lost a create race against a concurrent call for the same video — read back what won.
      row = await prisma.brandedVideoRendition.findUnique({ where: { sourceUrl } });
      if (!row) return { status: "pending" };
    }
  }

  if (row.status === "DONE" && row.outputUrl) return { status: "ready", url: row.outputUrl };
  if (row.status === "FAILED") return { status: "failed" };

  const deps = productionBrandingDeps(signal, watermarkUid);
  const step = await advanceBranding({ sourceUrl, streamUid: row.streamUid, attempts: row.attempts }, deps);

  if (step.kind === "done") {
    await prisma.brandedVideoRendition.update({
      where: { id: row.id },
      data: { status: "DONE", outputUrl: step.outputUrl, streamUid: null, lastError: null },
    });
    return { status: "ready", url: step.outputUrl };
  }
  if (step.kind === "failed") {
    await prisma.brandedVideoRendition.update({
      where: { id: row.id },
      data: { ...step.patch, lastError: step.reason.slice(0, 200), status: step.terminal ? "FAILED" : "PENDING" },
    });
    if (step.terminal) console.error(`[branded-video] giving up on ${sourceUrl} after ${MAX_BRANDING_ATTEMPTS} attempts: ${step.reason}`);
    return step.terminal ? { status: "failed" } : { status: "pending" };
  }
  if (Object.keys(step.patch).length > 0) {
    await prisma.brandedVideoRendition.update({ where: { id: row.id }, data: step.patch });
  }
  return { status: "pending" };
}
