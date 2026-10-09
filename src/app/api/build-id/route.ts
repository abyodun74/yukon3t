import { NextResponse } from "next/server";

/**
 * Public, no auth — the stale-build check (components/stale-build-reload.tsx)
 * calls this from any page, signed in or not, but only after a chunk-load
 * error has already fired; nothing polls it. APP_BUILD_ID is inlined at build
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
