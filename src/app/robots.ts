import type { MetadataRoute } from "next";
import { absoluteUrl, siteUrl } from "@/lib/seo";

/**
 * Everything under these paths needs a signed-in session (getOnboardedUserOrRedirect, getSessionUserOrRedirect, see
 * src/lib/page-guards.ts) or is a one-time account step reached from an email or a sign-in (check-email, verify,
 * reset): a crawler would only ever get a redirect, so disallowing them keeps crawl budget on the public pages.
 * robots.test.ts fails when a guarded page isn't covered here, or a sitemap URL is. The public pages (/, /faq,
 * /advertise, /sign-up, /sign-in, /legal/*, /try) stay crawlable, `?lang=` addresses included.
 */
const DISALLOWED_PATHS = [
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
  "/muse",
  "/post",
  "/search",
  "/birthdays",
  "/gift-marketplace",
  "/onboarding",
  "/invite",
  "/u/",
  "/whats-new",
  "/verify-email",
  "/forgot-password",
  "/reset-password",
  "/advertise/success",
  "/sign-in/check-email",
  "/sign-in/verify-device",
  "/sign-up/verify-phone",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: DISALLOWED_PATHS,
    },
    sitemap: absoluteUrl("/sitemap.xml", siteUrl()),
  };
}
