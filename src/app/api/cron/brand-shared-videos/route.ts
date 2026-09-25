import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isCronAuthorized } from "@/lib/cron-auth";
import { isBrandingConfigured, getOrAdvanceBrandedVideo } from "@/lib/branded-video-service";
import { captureError } from "@/lib/error-tracking";

// Same platform ceiling/shape as convert-mov-videos: one tick can hold a few
// brandings open, polling Cloudflare, and anything still unfinished at the
// end is simply resumed by the next tick (state lives in BrandedVideoRendition).
export const maxDuration = 300;

const BATCH_SIZE = 3;
const POLL_BUDGET_MS = 250_000;
const POLL_INTERVAL_MS = 5_000;
// A claim older than this is treated as abandoned (the tick that took it was killed).
const CLAIM_STALE_MS = 10 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Drives one branding job until it finishes, fails for good, or the tick's
 * time budget runs out. Unlike convert-mov-videos' driveConversion, this
 * doesn't need to reload the row every loop iteration to read back a
 * `status`/`streamUid` VideoConversion-side patch shape — getOrAdvanceBrandedVideo
 * already does one full find-or-create-and-advance-one-step cycle per call,
 * so this just calls it in a loop until it stops returning "pending".
 */
async function driveBranding(sourceUrl: string, deadline: number): Promise<"done" | "failed" | "pending"> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, deadline - Date.now()));
  try {
    while (Date.now() < deadline) {
      const result = await getOrAdvanceBrandedVideo(sourceUrl, controller.signal);
      if (result.status === "ready") return "done";
      if (result.status === "failed" || result.status === "unavailable") return "failed";
      await sleep(POLL_INTERVAL_MS);
    }
    return "pending";
  } catch (err) {
    console.error(`[brand-shared-videos] ${sourceUrl} threw`, err);
    await captureError(err, { route: "cron/brand-shared-videos", sourceUrl });
    return "pending";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Triggered every minute (Netlify Scheduled Function). A BrandedVideoRendition
 * row only ever exists because a native-share attempt already created one
 * on-demand (src/app/actions/branded-video.ts) — this cron doesn't discover
 * new candidates the way convert-mov-videos does, it's purely the backstop
 * that finishes a job the client's own short poll loop didn't stick around
 * long enough to see through (the app was backgrounded/closed mid-share,
 * a longer video needed more encode time than the poll window allows, etc.).
 */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isBrandingConfigured()) {
    return NextResponse.json({ skipped: "not_configured" });
  }

  const staleBefore = new Date(Date.now() - CLAIM_STALE_MS);
  const claimable = { OR: [{ claimedAt: null }, { claimedAt: { lt: staleBefore } }] };
  const candidates = await prisma.brandedVideoRendition.findMany({
    where: { status: "PENDING", ...claimable },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
    select: { id: true, sourceUrl: true },
  });
  const claimed: { id: string; sourceUrl: string }[] = [];
  for (const c of candidates) {
    const won = await prisma.brandedVideoRendition.updateMany({ where: { id: c.id, status: "PENDING", ...claimable }, data: { claimedAt: new Date() } });
    if (won.count > 0) claimed.push(c);
  }
  if (claimed.length === 0) return NextResponse.json({ claimed: 0 });

  const deadline = Date.now() + POLL_BUDGET_MS;
  const results = await Promise.all(claimed.map((c) => driveBranding(c.sourceUrl, deadline)));
  // Release every claim regardless of outcome — getOrAdvanceBrandedVideo
  // already persisted status/streamUid itself; this only clears the lock so
  // a still-PENDING row (a "pending" result below) is claimable again next tick.
  await prisma.brandedVideoRendition.updateMany({ where: { id: { in: claimed.map((c) => c.id) } }, data: { claimedAt: null } });

  const tally = { done: 0, failed: 0, pending: 0 };
  for (const r of results) tally[r] += 1;
  return NextResponse.json({ claimed: claimed.length, ...tally });
}
