import { NextRequest, NextResponse } from "next/server";

// Per-request CSP nonce so script-src can stay locked to 'self' + this
// nonce instead of falling back to 'unsafe-inline'. Deliberately has no
// dependency on Prisma/auth — those aren't edge-runtime safe here.
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  // React dev mode uses eval() for debugging stack traces; never in production.
  // The three Daily domains are for live streams' call-object bundle (see
  // live-video-frame.tsx's createCallObject({ dailyConfig: { avoidEval: true } })
  // — without avoidEval, Daily's default code path needs 'unsafe-eval'
  // instead, which this app deliberately never allows in production; with
  // it, the bundle loads via a plain <script> tag from these domains). Only
  // needed for the call-object path — Prebuilt (regular calls, CallFrame)
  // runs inside Daily's own cross-origin iframe with its own separate CSP.
  const dailyScriptSrc = "https://*.daily.co https://*.dailywebrtc.com https://*.dailywebrtc.net";
  const scriptSrc =
    process.env.NODE_ENV === "production"
      ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${dailyScriptSrc}`
      : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval' ${dailyScriptSrc}`;

  // R2 public URL host powers <img>/<video> playback and (via connect-src)
  // fetch()-ing a post's own media back as a Blob; the R2 S3 API host is
  // needed for the browser's direct-to-R2 presigned PUT upload. Both are
  // only added once configured, so connect-src stays locked to 'self' until
  // media uploads are actually set up.
  const r2PublicHost = (() => {
    try {
      return process.env.R2_PUBLIC_URL ? new URL(process.env.R2_PUBLIC_URL).origin : null;
    } catch {
      return null;
    }
  })();
  const r2ApiHost = process.env.R2_ACCOUNT_ID
    ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    : null;

  const csp = [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    // blob: is needed for client-side <img>/<video> previews of files the
    // user just picked, before they've been uploaded anywhere.
    `img-src 'self' data: blob: https:${r2PublicHost ? ` ${r2PublicHost}` : ""}`,
    `media-src 'self' blob:${r2PublicHost ? ` ${r2PublicHost}` : ""}`,
    "font-src 'self' data:",
    // r2PublicHost is also needed here (not just img-src/media-src) so the
    // browser can fetch() a post's own media as a Blob — used by the
    // native-share "attach the actual photo/video" path in share-modal.tsx,
    // which img-src/media-src alone don't cover since those only govern
    // passive <img>/<video> loads, not script-initiated fetch().
    // Prebuilt (regular calls, CallFrame) embeds Daily's call UI in an
    // iframe on Daily's own subdomain (frame-src below) — everything inside
    // that runs under Daily's own CSP, not ours. Live streams
    // (live-video-frame.tsx) use daily-js's call-object mode instead, which
    // has no iframe at all — its WebRTC signaling/media runs directly in
    // this page, so it needs its own connect-src entries (per Daily's own
    // CSP guide) or it just hangs on "Connecting…" with no visible error,
    // since a blocked connect-src fetch/WebSocket doesn't throw. wss: is
    // scheme-only (not host-scoped) because Daily's signaling/TURN relay
    // hosts are dynamically assigned, not a fixed domain.
    `connect-src 'self' https://*.daily.co https://*.dailywebrtc.com https://*.dailywebrtc.net wss:${r2ApiHost ? ` ${r2ApiHost}` : ""}${r2PublicHost ? ` ${r2PublicHost}` : ""}`,
    // blob: is call-object mode's echo-cancellation/audio-processing worker
    // bundle (also per Daily's CSP guide) — with no worker-src at all this
    // falls back to default-src 'self', which doesn't include blob:.
    "worker-src 'self' blob:",
    // Same reasoning as YouTube/Vimeo post embeds: the linked-video iframe
    // (see src/lib/video-embed.ts) only ever points at these two exact
    // origins, never an attacker-controlled one.
    "frame-src 'self' https://*.daily.co https://www.youtube-nocookie.com https://player.vimeo.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
