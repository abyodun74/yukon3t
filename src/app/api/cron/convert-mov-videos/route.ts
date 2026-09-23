import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isCronAuthorized } from "@/lib/cron-auth";
import { isStreamConfigured } from "@/lib/cloudflare-stream";
import { isStorageConfigured } from "@/lib/storage";
import { advanceConversion } from "@/lib/video-convert";
import { findMovSources, findMuseVideoSources, productionConversionDeps } from "@/lib/video-convert-db";

// Same platform ceiling and shape as moderate-long-videos: one tick can hold a
// few conversions open, polling Cloudflare, and anything still unfinished at
// the end is simply resumed by the next tick (state lives in VideoConversion).
export const maxDuration = 300;

const BATCH_SIZE = 3;
const POLL_BUDGET_MS = 250_000;
const POLL_INTERVAL_MS = 5_000;
// A claim older than this is treated as abandoned (the tick that took it was killed).
const CLAIM_STALE_MS = 10 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Drives one conversion until it finishes, fails for good, or the tick's time
 * budget runs out — persisting progress after every step, so a killed tick loses
 * at most one poll interval of work.
 */
async function driveConversion(id: string, sourceUrl: string, deadline: number): Promise<"done" | "failed" | "pending"> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, deadline - Date.now()));
  const deps = productionConversionDeps(controller.signal);
  try {
    let row = await prisma.videoConversion.findUniqueOrThrow({ where: { id } });
    while (Date.now() < deadline) {
      const step = await advanceConversion({ sourceUrl, streamUid: row.streamUid, attempts: row.attempts }, deps);

      if (step.kind === "done") {
        await prisma.videoConversion.update({
          where: { id },
          data: { status: "DONE", outputUrl: step.outputUrl, streamUid: null, claimedAt: null, lastError: null },
        });
        return "done";
      }
      if (step.kind === "failed") {
        row = await prisma.videoConversion.update({
          where: { id },
          data: {
            ...step.patch,
            lastError: step.reason.slice(0, 200),
            status: step.terminal ? "FAILED" : "PENDING",
            // Release the claim on a retryable failure so the next tick can try again.
            claimedAt: null,
          },
        });
        if (step.terminal) {
          // The original .mov stays as it was: it plays wherever it always did.
          console.error(`[convert-mov-videos] giving up on ${sourceUrl}: ${step.reason}`);
          return "failed";
        }
        return "pending";
      }
      if (Object.keys(step.patch).length > 0) {
        row = await prisma.videoConversion.update({ where: { id }, data: step.patch });
      }
      await sleep(POLL_INTERVAL_MS);
    }
    return "pending";
  } catch (err) {
    console.error(`[convert-mov-videos] ${sourceUrl} threw`, err);
    await prisma.videoConversion.update({ where: { id }, data: { claimedAt: null } }).catch(() => {});
    return "pending";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Triggered every minute (Netlify Scheduled Function). Finds stored .mov
 * videos and every Muse video regardless of format, and re-encodes each
 * through Cloudflare Stream to a broadly playable H.264 MP4 with its
 * orientation correctly baked in — see src/lib/video-convert.ts for the
 * whole story (two different reasons a video ends up here, one pipeline).
 * Does nothing until Cloudflare Stream and R2 are configured.
 */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isStreamConfigured() || !isStorageConfigured()) {
    return NextResponse.json({ skipped: "not_configured" });
  }

  // 1. Register any candidate we haven't seen — .mov uploads (compatibility)
  // and every Muse video (orientation) — skipping ones already given up on.
  // Deduplicated before insert: a .mov Muse video can appear in both lists,
  // and one re-encode through this same pipeline satisfies both reasons at
  // once.
  const givenUp = (await prisma.videoConversion.findMany({ where: { status: "FAILED" }, select: { sourceUrl: true } })).map((r) => r.sourceUrl);
  const [movSources, museSources] = await Promise.all([
    findMovSources(BATCH_SIZE * 4, givenUp),
    findMuseVideoSources(BATCH_SIZE * 4, givenUp),
  ]);
  const sources = [...new Set([...movSources, ...museSources])];
  if (sources.length > 0) {
    await prisma.videoConversion.createMany({ data: sources.map((sourceUrl) => ({ sourceUrl })), skipDuplicates: true });
  }

  // 2. Claim a few PENDING ones (one at a time so two overlapping ticks never take the same one).
  //
  // Deliberately NOT filtered to `sources` above — that list only drives
  // step 1's registration (what's new since last tick) and, for a Muse
  // candidate specifically, findMuseVideoSources excludes any URL already
  // registered (that's what stops it being registered twice), including
  // ones still PENDING. Reusing `sources` here would starve exactly that
  // case: a still-in-progress Muse conversion (a transient Stream failure,
  // or one that didn't finish inside a single tick's POLL_BUDGET_MS) would
  // never reappear in `sources` on a later tick, so it could never be
  // reclaimed and would sit PENDING forever. A .mov row didn't hit this —
  // findMovSources re-derives its list from the live table every tick, so
  // an unfinished .mov conversion (still ending in .mov) always reappears
  // — but that's exactly the kind of live signal a Muse candidate has none
  // of. Querying PENDING rows directly, independent of `sources`, is
  // correct for both: a row already exists in the table the moment it's
  // claimable, whether or not this tick's registration pass happened to
  // rediscover its URL.
  const staleBefore = new Date(Date.now() - CLAIM_STALE_MS);
  const claimable = { OR: [{ claimedAt: null }, { claimedAt: { lt: staleBefore } }] };
  const candidates = await prisma.videoConversion.findMany({
    where: { status: "PENDING", ...claimable },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
    select: { id: true, sourceUrl: true },
  });
  const claimed: { id: string; sourceUrl: string }[] = [];
  for (const c of candidates) {
    const won = await prisma.videoConversion.updateMany({ where: { id: c.id, status: "PENDING", ...claimable }, data: { claimedAt: new Date() } });
    if (won.count > 0) claimed.push(c);
  }
  if (claimed.length === 0) return NextResponse.json({ claimed: 0 });

  // 3. Work them in parallel until done or out of time.
  const deadline = Date.now() + POLL_BUDGET_MS;
  const results = await Promise.all(claimed.map((c) => driveConversion(c.id, c.sourceUrl, deadline)));
  const tally = { done: 0, failed: 0, pending: 0 };
  for (const r of results) tally[r] += 1;
  return NextResponse.json({ claimed: claimed.length, ...tally });
}
