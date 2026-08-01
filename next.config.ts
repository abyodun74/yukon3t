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
  // here regardless of what this header allows.
  { key: "Permissions-Policy", value: "camera=*, microphone=*, geolocation=()" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  // Content-Security-Policy is set per-request in src/middleware.ts so it
  // can carry a fresh nonce instead of falling back to 'unsafe-inline'.
];

const nextConfig: NextConfig = {
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
