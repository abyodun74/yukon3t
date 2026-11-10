import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { captureError } from "@/lib/error-tracking";
import { sendHolidayReminders } from "@/lib/holidays-data";

export const maxDuration = 60;

/**
 * Public-holiday reminders (HOLIDAY_TODAY): "Today is Independence Day in Nigeria", quietly, from 08:00 in each
 * person's own time zone on a public holiday of the country on their profile. Scheduled every 15 minutes by
 * netlify/functions/holiday-reminders.mts, the same pattern as birthday-reminders. Idempotent (the HolidayReminder
 * unique key): a repeated run sends nothing twice. All the rules are in src/lib/holidays.ts.
 */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ error: null, ...(await sendHolidayReminders()) });
  } catch (err) {
    console.error("[holiday-reminders] run failed", err);
    await captureError(err, { action: "holiday-reminders cron" });
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
