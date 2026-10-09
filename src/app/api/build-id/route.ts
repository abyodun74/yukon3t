import { NextResponse } from "next/server";

/**
 * Public, no auth — the stale-build check (lib/stale-build-client.ts) calls
 * this from any page, signed in or not: when the app returns to the
 * foreground (at most once a minute), from an error boundary, or after an
 * error that looks like staleness. No timer polls it. APP_BUILD_ID is inlined at build
 * time (next.config.ts's `env`), so this always reports the build that is
 * actually serving, and no-store keeps a browser or CDN from answering with
 * an earlier deploy's id.
 */
export function GET() {
  return NextResponse.json(
    { buildId: process.env.APP_BUILD_ID },
    { headers: { "Cache-Control": "no-store" } },
  );
}
