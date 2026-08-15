import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { UNRESOLVED_LOGIN_ISSUE_CLEAR_AFTER_MS } from "@/lib/login-issues";
import { isCronAuthorized } from "@/lib/cron-auth";

/**
 * Triggered on a schedule (Netlify Scheduled Function), not by a user
 * request — protected by a shared secret, same pattern as the
 * expire-stories/event-reminders crons.
 *
 * The admin "Login issues" queue (src/app/admin/moderation/page.tsx) isn't a
 * stored queue — it's computed live from User auth fields. So "delete from
 * the queue after 48h unresolved" means clearing that underlying state:
 *  - Failed-attempts-only accounts (never actually locked): reset the
 *    streak so the account is no longer flagged.
 *  - Locked accounts: lockedUntil already self-expires within 24h, so this
 *    is mostly a safety net.
 *  - Stuck-unverified accounts: dismissed into "recently resolved" via
 *    loginIssueResolvedAt, WITHOUT setting emailVerified — auto-verifying
 *    an email would bypass a real security check, so this only stops
 *    nagging the moderation queue, it doesn't grant sign-in access.
 */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - UNRESOLVED_LOGIN_ISSUE_CLEAR_AFTER_MS);

  const cleared = await prisma.user.updateMany({
    where: {
      status: { in: ["ACTIVE", "DEACTIVATED"] },
      OR: [
        { failedLoginAttempts: { gt: 0 }, failedLoginAt: { lt: cutoff } },
        { lockedUntil: { lt: cutoff } },
      ],
    },
    data: { failedLoginAttempts: 0, lockedUntil: null, failedLoginAt: null },
  });

  const dismissed = await prisma.user.updateMany({
    where: {
      status: { in: ["ACTIVE", "DEACTIVATED"] },
      emailVerified: null,
      createdAt: { lt: cutoff },
      loginIssueResolvedAt: null,
    },
    data: { loginIssueResolvedAt: new Date() },
  });

  return NextResponse.json({ error: null, clearedCount: cleared.count, dismissedCount: dismissed.count });
}
