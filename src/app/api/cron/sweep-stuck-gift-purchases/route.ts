import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { captureError } from "@/lib/error-tracking";
import { sweepStuckGiftPurchases } from "@/lib/gift-purchase-sweep";

export const maxDuration = 60;

/**
 * Finishes coin-paid gifts left PENDING after their coins were spent (the delivery after the spend failed and the
 * sender never tapped "Try again"): retried while younger than GIFT_PURCHASE_REFUND_AFTER_MS (2 hours), refunded after
 * that or once the recipient's account (and with it the send) is gone. Rules, thresholds and the state machine are in
 * src/lib/gift-purchase-sweep.ts. Every 10 minutes via netlify/functions/sweep-stuck-gift-purchases.mts (on Vercel
 * nothing schedules it, like every cron here). Bounded (50 per run, 30s budget), idempotent, safe to overlap with
 * itself and with the sender's own retry.
 */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await sweepStuckGiftPurchases();
    if (result.due > 0) console.log("[sweep-stuck-gift-purchases]", JSON.stringify(result));
    return NextResponse.json({ error: null, ...result });
  } catch (err) {
    console.error("[sweep-stuck-gift-purchases] run failed", err);
    await captureError(err, { action: "sweep-stuck-gift-purchases cron" });
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
