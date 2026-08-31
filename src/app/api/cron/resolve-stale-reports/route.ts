import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { UNRESOLVED_REPORT_CLEAR_AFTER_MS } from "@/lib/report-queue";
import { isCronAuthorized } from "@/lib/cron-auth";

/**
 * Triggered on a schedule (Netlify Scheduled Function), not by a user
 * request — protected by a shared secret, same pattern as the
 * resolve-login-issues cron.
 *
 * Auto-dismisses reports that have sat OPEN/REVIEWING for longer than
 * UNRESOLVED_REPORT_CLEAR_AFTER_MS with no admin action, so a backlog no
 * admin got to doesn't sit in the queue forever. Deliberately takes no
 * enforcement action (no warn/suspend/ban, no content removal) — same
 * restraint resolve-login-issues uses for stuck-unverified accounts, this
 * only clears queue noise. Each dismissal still writes an AuditLog entry
 * when a reportedUser is on record, same as a human dismissal via
 * resolveReport in actions/reports.ts, so it stays explainable/appealable.
 */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - UNRESOLVED_REPORT_CLEAR_AFTER_MS);

  const staleReports = await prisma.report.findMany({
    where: { status: { in: ["OPEN", "REVIEWING"] }, createdAt: { lt: cutoff } },
    select: { id: true, reportedUserId: true },
  });

  for (const report of staleReports) {
    await prisma.$transaction(async (tx) => {
      await tx.report.update({
        where: { id: report.id },
        data: {
          status: "DISMISSED",
          resolutionNote: "Auto-dismissed after 72h with no admin action.",
          resolvedAt: new Date(),
        },
      });

      if (report.reportedUserId) {
        await tx.auditLog.create({
          data: {
            targetId: report.reportedUserId,
            action: "REPORT_DISMISSED",
            reason: "Auto-dismissed after 72h with no admin action.",
            performedBy: "system:resolve-stale-reports",
          },
        });
      }
    });
  }

  return NextResponse.json({ error: null, dismissedCount: staleReports.length });
}
