import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * The public ad slot's impression and click counters (AdSlot / AdClickTracker). They are shown to admins and
 * advertisers, so a script must not be able to inflate them:
 * - only an id shaped like a campaign id, and only a currently ACTIVE campaign, is ever counted;
 * - each viewer (client IP) counts at most once per campaign per window: `adImpression` (30 min) and `adClick`
 *   (10 min), keyed `<ip>:<campaignId>`. Both fail open (a Redis outage counts normally, nothing breaks).
 * Impressions are recorded only from the server while AdSlot renders (this module is not a Server Action), so the
 * browser can't call it at all; clicks have to come from the browser and go through recordAdClick (actions/ads.ts).
 */

const campaignIdSchema = z.string().cuid();

type AdCounter = "impressionCount" | "clickCount";

async function bumpAdCounter(counter: AdCounter, campaignId: unknown, ip: string) {
  const parsed = campaignIdSchema.safeParse(campaignId);
  if (!parsed.success) return false;
  const limiter = counter === "impressionCount" ? "adImpression" : "adClick";
  if (!(await checkRateLimit(limiter, `${ip}:${parsed.data}`))) return false;
  const { count } = await prisma.adCampaign.updateMany({
    where: { id: parsed.data, status: "ACTIVE" },
    data: { [counter]: { increment: 1 } },
  });
  return count > 0;
}

/** One impression for the viewer at `ip` (AdSlot, server-side only). True when it was counted. */
export function recordAdImpressionFor(campaignId: string, ip: string) {
  return bumpAdCounter("impressionCount", campaignId, ip);
}

/** One click for the viewer at `ip` (recordAdClick). True when it was counted. */
export function recordAdClickFor(campaignId: unknown, ip: string) {
  return bumpAdCounter("clickCount", campaignId, ip);
}
