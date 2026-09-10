import type { MetadataRoute } from "next";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://yukon3t.com";

/**
 * Everything under these paths requires at least a signed-in session (most
 * via getOnboardedUserOrRedirect, /whats-new via the lighter
 * getSessionUserOrRedirect — see src/lib/page-guards.ts) — search engines
 * would only ever hit a sign-in redirect anyway, so disallowing them keeps
 * crawl budget on the actual public/marketing pages instead.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/admin",
        "/home",
        "/messages",
        "/notifications",
        "/settings",
        "/connections",
        "/discover",
        "/circles",
        "/collab",
        "/live",
        "/post",
        "/search",
        "/onboarding",
        "/invite",
        "/u/",
        "/verify-email",
        "/sign-up/verify-phone",
        "/whats-new",
      ],
    },
    sitemap: `${appUrl}/sitemap.xml`,
  };
}
