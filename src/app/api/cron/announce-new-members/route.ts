import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { captureError } from "@/lib/error-tracking";
import { announceNewMembers } from "@/lib/new-member-alerts-data";

export const maxDuration = 60;

/**
 * "New on YuKon3t" alerts (NEW_MEMBER_JOINED): announces people who recently finished joining to people who use
 * Discover. Scheduled every 15 minutes by netlify/functions/announce-new-members.mts, the same pattern as
 * event-reminders. All rules (who is announced, who hears, coalescing, push cooldown) are in src/lib/new-member-alerts.ts.
 */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await announceNewMembers());
  } catch (err) {
    console.error("[announce-new-members] run failed", err);
    await captureError(err, { action: "announce-new-members cron" });
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
