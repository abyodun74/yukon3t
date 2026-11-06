import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { captureError } from "@/lib/error-tracking";
import { sendBirthdayReminders } from "@/lib/birthdays-data";

export const maxDuration = 60;

/**
 * Birthday reminders (BIRTHDAY_TODAY): tells people, in their own morning, that someone sharing their birthday with
 * them has a birthday today. Scheduled every 15 minutes by netlify/functions/birthday-reminders.mts, the same pattern
 * as event-reminders. Idempotent (the BirthdayReminder unique key): a repeated run sends nothing twice. All the rules
 * are in src/lib/birthdays.ts.
 */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ error: null, ...(await sendBirthdayReminders()) });
  } catch (err) {
    console.error("[birthday-reminders] run failed", err);
    await captureError(err, { action: "birthday-reminders cron" });
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
