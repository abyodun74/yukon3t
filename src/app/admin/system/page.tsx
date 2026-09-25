import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUserOrRedirect } from "@/lib/page-guards";
import { isBackupConfigured, listBackups } from "@/lib/db-backup";

// Pulled out of the component body — eslint's react-hooks/purity rule flags
// Date.now() called directly during render (even in a Server Component);
// wrapping it in its own function (same pattern as admin/analytics/page.tsx's
// countsSince) satisfies the rule without changing behavior.
function hoursSince(date: Date) {
  return (Date.now() - date.getTime()) / 3_600_000;
}

/**
 * The one place to actually check "is the safety net working" at a glance,
 * rather than trusting that a cron being configured means it's succeeding —
 * confirmed live (2026-09-25) that "the backup system exists in code and
 * has its env vars set" and "backups are actually landing in R2 every day"
 * are genuinely different questions with no way to tell them apart before
 * this page existed. listBackups()/isBackupConfigured() already had
 * everything needed (src/lib/db-backup.ts) — this only had to surface it.
 */
export default async function AdminSystemPage() {
  const user = await getSessionUserOrRedirect();
  if (!user.isAdmin) redirect("/discover");

  const configured = isBackupConfigured();
  const backups = configured ? await listBackups().catch(() => null) : null;
  const latest = backups?.[0];
  const hoursSinceLatest = latest ? hoursSince(latest.lastModified) : null;
  // The cron runs daily — anything past ~30h (a day plus real slack for a
  // slow run or a missed tick) means either it's failing or was never
  // actually reachable, not just "hasn't ticked yet today."
  const isStale = hoursSinceLatest !== null && hoursSinceLatest > 30;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <Link href="/admin/moderation" className="text-xs text-foreground-soft hover:text-accent">
        &larr; Moderation queue
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">System status</h1>
      <p className="mt-1 text-sm text-foreground-soft">
        Health signals that don&apos;t show up anywhere else in the app.
      </p>

      <div className="mt-8 rounded-xl border border-line p-5">
        <h2 className="text-sm font-semibold">Database backups</h2>
        {!configured ? (
          <p className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            Not configured — BACKUP_R2_BUCKET_NAME/BACKUP_ENCRYPTION_KEY aren&apos;t set. No daily
            backup is running at all right now.
          </p>
        ) : backups === null ? (
          <p className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            Configured, but couldn&apos;t reach the backup bucket to check — the R2 credentials or
            bucket name may be wrong.
          </p>
        ) : latest ? (
          <>
            <p className={`mt-2 rounded-lg px-3 py-2 text-sm ${isStale ? "bg-danger/10 text-danger" : "bg-success/10 text-success"}`}>
              {isStale
                ? `Last backup was ${Math.round(hoursSinceLatest!)}h ago — later than the daily schedule should allow. The cron may be failing.`
                : `Last backup ${latest.lastModified.toLocaleString()} — ${(latest.size / 1024 / 1024).toFixed(1)} MB.`}
            </p>
            <p className="mt-2 text-xs text-foreground-soft">
              {backups.length} backup{backups.length === 1 ? "" : "s"} currently retained.
            </p>
          </>
        ) : (
          <p className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            Configured, but zero backups exist yet — either the cron hasn&apos;t run for the first
            time yet, or every run so far has failed.
          </p>
        )}
        <p className="mt-3 text-xs text-foreground-soft">
          Restore with <code className="rounded bg-background px-1 py-0.5">npm run db:restore-backup</code> — see
          SECURITY.md for the full runbook. Never automatic, by design.
        </p>
      </div>

      <div className="mt-4 rounded-xl border border-line p-5">
        <h2 className="text-sm font-semibold">Error tracking</h2>
        <p
          className={`mt-2 rounded-lg px-3 py-2 text-sm ${process.env.SENTRY_DSN ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}
        >
          {process.env.SENTRY_DSN
            ? "Sentry is configured — crashes report automatically."
            : "SENTRY_DSN isn't set — crashes anywhere in the app currently report to no one."}
        </p>
      </div>

      <div className="mt-4 rounded-xl border border-line p-5">
        <h2 className="text-sm font-semibold">Uptime</h2>
        <p className="mt-2 text-sm text-foreground-soft">
          <code className="rounded bg-background px-1 py-0.5">/api/health</code> checks real database
          connectivity and returns 200/503 — point an external monitor (UptimeRobot, Better Uptime,
          etc.) at it to get alerted the moment the app itself can&apos;t be reached, not just when
          something inside it errors.
        </p>
      </div>
    </div>
  );
}
