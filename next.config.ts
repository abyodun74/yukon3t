import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // `*` (any origin), not `(self)`: Permissions-Policy doesn't support
  // wildcard subdomains the way CSP's frame-src does, and the Daily.co
  // call iframe lives on a per-account *.daily.co subdomain — `(self)`
  // silently excludes it, which is exactly what still blocked calls after
  // the first attempt at this fix. CSP's frame-src ('self' and
  // https://*.daily.co only, see src/proxy.ts) is the actual boundary on
  // what can be embedded at all, so broadening this doesn't hand camera
  // access to arbitrary third-party content — nothing else can be framed
  // here regardless of what this header allows. display-capture is the
  // same story for screen share (call-frame.tsx's customTrayButtons
  // screenshare button): without it explicitly allowed here, the browser
  // silently denies getDisplayMedia() inside the cross-origin iframe — no
  // error, the picker just never opens.
  { key: "Permissions-Policy", value: "camera=*, microphone=*, display-capture=*, geolocation=()" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  // Content-Security-Policy is set per-request in src/middleware.ts so it
  // can carry a fresh nonce instead of falling back to 'unsafe-inline'.
];

// Identifies this build to components/stale-build-reload.tsx, inlined into
// both the server (/api/build-id) and client bundles via `env` below. The
// per-deploy id comes first: a redeploy of the same commit (e.g. after a
// NEXT_PUBLIC_* change) still produces new chunk hashes. Written back to
// process.env because next.config can be evaluated more than once per build
// (worker processes inherit the env), and the timestamp fallback must not
// differ between those evaluations.
const appBuildId = (process.env.APP_BUILD_ID ||=
  process.env.DEPLOY_ID ||
  process.env.VERCEL_DEPLOYMENT_ID ||
  process.env.COMMIT_REF ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  `local-${Date.now().toString(36)}`);

const nextConfig: NextConfig = {
  env: {
    APP_BUILD_ID: appBuildId,
  },
  // Already the default, but pinned explicitly: gzip/brotli response
  // compression for anything Next itself serves. Vercel's and Netlify's
  // edges also compress in front of this (see CLAUDE.md's dual-deployment
  // section), so this mainly matters for `next start` / self-hosted runs.
  compress: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
