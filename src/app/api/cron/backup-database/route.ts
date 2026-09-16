import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { isBackupConfigured, runDatabaseBackup } from "@/lib/db-backup";

// A full logical dump of every table can take a while on a larger database
// — same platform ceiling moderate-long-videos already uses.
export const maxDuration = 300;

/**
 * Triggered on a schedule (Netlify Scheduled Function), same pattern as the
 * other src/app/api/cron/* routes — protected by CRON_SECRET.
 *
 * Runs a full encrypted logical backup of every table to a dedicated
 * private R2 bucket (see src/lib/db-backup.ts for the full design/threat
 * model) and prunes anything past BACKUP_RETENTION_DAYS. Deliberately a
 * no-op (503, not a crash) until the BACKUP_R2_ and BACKUP_ENCRYPTION_KEY
 * env vars are actually configured — this must never silently run against
 * a misconfigured or absent bucket.
 */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isBackupConfigured()) {
    console.error(
      "[backup-database] BACKUP_R2_BUCKET_NAME/BACKUP_ENCRYPTION_KEY (and BACKUP_R2_ACCOUNT_ID/ACCESS_KEY_ID/SECRET_ACCESS_KEY or their R2_* fallback) are not set — skipping run.",
    );
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  try {
    const result = await runDatabaseBackup();
    console.log(
      `[backup-database] wrote ${result.key} (${result.tableCount} tables, ${result.totalRows} rows, ${result.bytes} bytes); pruned ${result.prunedCount} old backup(s)`,
    );
    return NextResponse.json({ error: null, ...result });
  } catch (err) {
    console.error("[backup-database] backup run failed", err);
    return NextResponse.json({ error: "backup_failed" }, { status: 500 });
  }
}
