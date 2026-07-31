import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // camera/microphone allow self (in-browser recording) and let the
  // Daily.co call iframe's own `allow` attribute delegate access to it —
  // an empty allowlist here would override that delegation entirely,
  // blocking calls regardless of the iframe's own permissions request.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
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
