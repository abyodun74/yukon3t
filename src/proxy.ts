import { NextRequest, NextResponse } from "next/server";
import { DEVICE_ID_COOKIE, DEVICE_ID_HEADER, DEVICE_ID_MAX_AGE_SECONDS } from "@/lib/device-id-constants";
import { checkRateLimit } from "@/lib/rate-limit";
import { TURNSTILE_ORIGIN } from "@/lib/turnstile-shared";

// Best-effort client IP, matching src/lib/client-ip.ts's own first-hop
// convention — duplicated rather than shared since that file's getClientIp
// is async-headers()-based (Server Action context), while this runs at the
// edge directly against a NextRequest.
function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

// Per-request CSP nonce so script-src can stay locked to 'self' + this
// nonce instead of falling back to 'unsafe-inline'. Deliberately has no
// dependency on Prisma/auth — those aren't edge-runtime safe here. Async
// only for the rate-limit check below (Upstash's REST client, itself
// fetch()-based and edge-safe) — everything else here stays synchronous.
export async function proxy(request: NextRequest) {
  // Coarse, IP-keyed page-level rate limit — every route this proxy runs
  // against (see config.matcher below), not just the individual Server
  // Action limiters already applied per-mutation. See rateLimiters.pageRequest
  // in src/lib/rate-limit.ts for the actual bucket size and reasoning.
  const allowed = await checkRateLimit("pageRequest", clientIp(request));
  if (!allowed) {
    return new NextResponse("Too many requests — slow down and try again shortly.", { status: 429 });
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  // Long-lived per-browser/app-install id, used by src/lib/device-trust.ts
  // to recognize (or challenge) the device behind a sensitive action —
  // minted here rather than in a Server Action because it needs to exist
  // before the very first login this browser/install ever makes. Edge-safe:
  // just a random id, no DB read.
  const existingDeviceId = request.cookies.get(DEVICE_ID_COOKIE)?.value;
  const deviceId = existingDeviceId || crypto.randomUUID();

  // React dev mode uses eval() for debugging stack traces; never in production.
  // The three Daily domains are for live streams' call-object bundle (see
  // live-video-frame.tsx's createCallObject({ dailyConfig: { avoidEval: true } })
  // — without avoidEval, Daily's default code path needs 'unsafe-eval'
  // instead, which this app deliberately never allows in production; with
  // it, the bundle loads via a plain <script> tag from these domains). Only
  // needed for the call-object path — Prebuilt (regular calls, CallFrame)
  // runs inside Daily's own cross-origin iframe with its own separate CSP.
  const dailyScriptSrc = "https://*.daily.co https://*.dailywebrtc.com https://*.dailywebrtc.net";
  // Cloudflare Turnstile (src/lib/turnstile.ts) — its api.js is appended by
  // our own nonced bundle so 'strict-dynamic' already covers loading it, but
  // the widget itself renders in an iframe (frame-src) and talks to its own
  // origin (connect-src), neither of which strict-dynamic helps with. Opened
  // only once the site key is configured, same gating as r2/GTM/Clarity
  // below; the script-src host is redundant under 'strict-dynamic' but keeps
  // older CSP2-only browsers working.
  const turnstileOrigin = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ? ` ${TURNSTILE_ORIGIN}` : "";
  const scriptSrc =
    process.env.NODE_ENV === "production"
      ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${dailyScriptSrc}${turnstileOrigin}`
      : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval' ${dailyScriptSrc}${turnstileOrigin}`;

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

  // GTM/GA's bootstrap snippet is an inline script carrying the nonce (see
  // layout.tsx), so 'strict-dynamic' already lets it load its actual script
  // bundle from any host without a script-src entry here — but connect-src
  // has no 'strict-dynamic' equivalent, so its beacon/fetch endpoints still
  // need to be explicitly opened, and only once actually configured (same
  // gating pattern as r2ApiHost above).
  const gtmConnectSrc = process.env.NEXT_PUBLIC_GTM_ID
    ? " https://www.googletagmanager.com https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com"
    : "";
  // PostHog (src/lib/posthog-client.ts) is a bundled npm package, not an
  // inline snippet, so strict-dynamic doesn't cover it at all — its event
  // capture and session-replay upload calls need an explicit connect-src
  // entry, opened only once both env vars are set (same gating as
  // everything else here). Host is derived from NEXT_PUBLIC_POSTHOG_HOST
  // rather than hardcoded, since that var is itself how a self-hosted (vs.
  // PostHog Cloud US/EU) instance is chosen.
  const posthogHost = (() => {
    try {
      return process.env.NEXT_PUBLIC_POSTHOG_KEY && process.env.NEXT_PUBLIC_POSTHOG_HOST
        ? new URL(process.env.NEXT_PUBLIC_POSTHOG_HOST).origin
        : null;
    } catch {
      return null;
    }
  })();
  const posthogConnectSrc = posthogHost ? ` ${posthogHost}` : "";

  // supabase-js's realtime client does an HTTPS handshake/health-check
  // against the project's own REST host before (and alongside) opening its
  // WebSocket — the WebSocket itself is already covered by connect-src's
  // scheme-only `wss:` below (see that entry's own comment), but this HTTPS
  // origin isn't. Same conditional-once-configured gating as r2PublicHost.
  const supabaseConnectSrc = (() => {
    try {
      return process.env.NEXT_PUBLIC_SUPABASE_URL ? ` ${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin}` : "";
    } catch {
      return "";
    }
  })();

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
    `connect-src 'self' https://*.daily.co https://*.dailywebrtc.com https://*.dailywebrtc.net wss:${r2ApiHost ? ` ${r2ApiHost}` : ""}${r2PublicHost ? ` ${r2PublicHost}` : ""}${gtmConnectSrc}${posthogConnectSrc}${supabaseConnectSrc}${turnstileOrigin}`,
    // blob: is call-object mode's echo-cancellation/audio-processing worker
    // bundle (also per Daily's CSP guide) — with no worker-src at all this
    // falls back to default-src 'self', which doesn't include blob:.
    "worker-src 'self' blob:",
    // Same reasoning for all four: the linked-video iframe (see
    // src/lib/video-embed.ts's embedSrc) only ever points at one of these
    // exact origins per provider, never an attacker-controlled one.
    // TikTok/Dailymotion were missing here despite already being supported
    // EmbedProvider values — confirmed live, a TikTok embed post rendered
    // as a plain blocked/black iframe (CSP silently refusing the frame
    // load) even though video-embed.ts happily built the embed. Not
    // something the "share a video in from another app" feature broke —
    // manually pasting a TikTok/Dailymotion link had exactly the same gap.
    // googletagmanager.com is GTM's no-JS <noscript> fallback iframe
    // (analytics-scripts.tsx) — only opened once NEXT_PUBLIC_GTM_ID is
    // actually set.
    `frame-src 'self' https://*.daily.co https://www.youtube-nocookie.com https://player.vimeo.com https://www.tiktok.com https://www.dailymotion.com https://www.instagram.com https://www.facebook.com${process.env.NEXT_PUBLIC_GTM_ID ? " https://www.googletagmanager.com" : ""}${turnstileOrigin}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  // Same-request fallback for code that reads the device id before the
  // browser has stored and resent the Set-Cookie below (see
  // src/lib/device-id.ts's getDeviceId).
  requestHeaders.set(DEVICE_ID_HEADER, deviceId);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set("Content-Security-Policy", csp);
  if (!existingDeviceId) {
    response.cookies.set(DEVICE_ID_COOKIE, deviceId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: DEVICE_ID_MAX_AGE_SECONDS,
    });
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
