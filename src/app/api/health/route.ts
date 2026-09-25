import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { captureError } from "@/lib/error-tracking";

/**
 * Deliberately public, no auth — an external uptime monitor (UptimeRobot,
 * Better Uptime, Pingdom, etc.) needs to hit this without credentials on a
 * schedule, from outside this app entirely. That's the whole point: it's
 * the one thing here that can tell you the app is down from the *user's*
 * vantage point (DNS resolves, the platform is up, the function actually
 * runs, the database actually answers) rather than from inside code that
 * might itself be part of what's broken.
 *
 * Checks the one real external dependency this app cannot function
 * without — the database — via the cheapest possible real query (not
 * prisma.user.count() or similar; SELECT 1 touches nothing, holds no lock,
 * costs nothing). Deliberately does NOT report on every third-party
 * integration (R2, Resend, OpenAI moderation, Cloudflare Stream, etc.) —
 * those already fail open/gracefully throughout this app (see SECURITY.md),
 * so a health check flapping red every time one of them has a blip would
 * train whoever's watching this to ignore real outages. If DB connectivity
 * itself is ever not the right single signal, revisit deliberately rather
 * than growing this into a dependency-by-dependency status page.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" });
  } catch (err) {
    // A health check hitting this branch means an uptime monitor is about
    // to page someone anyway — report it to Sentry too, so the on-call
    // person opens straight to a stack trace instead of starting from zero.
    await captureError(err, { route: "/api/health" });
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
