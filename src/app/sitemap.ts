import type { MetadataRoute } from "next";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://yukon3t.com";

/**
 * Only the public, unauthenticated pages — everything gated behind auth
 * (getOnboardedUserOrRedirect, or the lighter getSessionUserOrRedirect that
 * /whats-new uses) is disallowed in robots.ts and has nothing to offer a
 * crawler anyway (it just hits the sign-in redirect). /whats-new was
 * previously listed here despite requiring a session — a submitted sitemap
 * URL that just redirects shows up as an error in Search Console, not an
 * indexed page, so it's excluded until that page is ever made public.
 * Dynamic pages (public post/user pages) aren't included here since those
 * routes currently require auth too — see robots.ts's /u/ and /post/
 * disallow.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const routes: { path: string; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"]; priority: number }[] = [
    { path: "/", changeFrequency: "weekly", priority: 1 },
    { path: "/faq", changeFrequency: "monthly", priority: 0.8 },
    { path: "/advertise", changeFrequency: "monthly", priority: 0.7 },
    { path: "/sign-up", changeFrequency: "monthly", priority: 0.8 },
    { path: "/sign-in", changeFrequency: "monthly", priority: 0.5 },
    { path: "/legal/guidelines", changeFrequency: "monthly", priority: 0.5 },
    { path: "/legal/privacy", changeFrequency: "yearly", priority: 0.3 },
    { path: "/legal/terms", changeFrequency: "yearly", priority: 0.3 },
    { path: "/legal/disclaimer", changeFrequency: "yearly", priority: 0.3 },
    { path: "/legal/delete-account", changeFrequency: "yearly", priority: 0.3 },
  ];

  const lastModified = new Date();
  return routes.map(({ path, changeFrequency, priority }) => ({
    url: `${appUrl}${path}`,
    lastModified,
    changeFrequency,
    priority,
  }));
}
