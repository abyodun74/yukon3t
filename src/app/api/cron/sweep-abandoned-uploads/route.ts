import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { isStorageConfigured, deleteObject } from "@/lib/storage";
import { sweepAbandonedUploads } from "@/lib/upload-records";

export const maxDuration = 120;

// Uploads younger than this are never touched — far longer than any real "pick a file, then post it" gap (and than
// the multi-hour window a huge video can spend uploading), so a post still being written is never at risk.
const DEFAULT_MIN_AGE_HOURS = 48;
const LIMIT_PER_RUN = 200;

/**
 * Triggered hourly (Netlify Scheduled Function). Deletes uploads that were handed out but that nothing ever
 * referenced — see src/lib/upload-records.ts for the safeguards. It only LOGS what it would delete until
 * UPLOAD_SWEEP_DELETE=1 is set on the deploy, so its findings can be reviewed before it removes anything.
 */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isStorageConfigured()) {
    return NextResponse.json({ skipped: "not_configured" });
  }

  const hours = Number(process.env.UPLOAD_SWEEP_MIN_AGE_HOURS ?? DEFAULT_MIN_AGE_HOURS);
  const result = await sweepAbandonedUploads({
    dryRun: process.env.UPLOAD_SWEEP_DELETE !== "1",
    minAgeMs: Math.max(24, Number.isFinite(hours) ? hours : DEFAULT_MIN_AGE_HOURS) * 60 * 60 * 1000,
    limit: LIMIT_PER_RUN,
    publicBaseUrl: process.env.R2_PUBLIC_URL,
    deleteObject,
  });
  if (result.unreferenced > 0 || result.aborted) console.log("[upload-sweep]", JSON.stringify(result));
  return NextResponse.json(result);
}
