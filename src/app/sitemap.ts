import type { MetadataRoute } from "next";
import { SUPPORTED_LOCALES } from "@/lib/i18n/locales";
import { LEGAL_LAST_UPDATED, absoluteUrl, languageAlternates, siteUrl } from "@/lib/seo";
import { LOCALIZED_SEO_PATHS, localizedSeoPath } from "@/lib/seo-locale";

type ChangeFrequency = MetadataRoute.Sitemap[number]["changeFrequency"];

/**
 * Only the public pages a signed-out visitor can read. Everything gated behind a session (getOnboardedUserOrRedirect,
 * getSessionUserOrRedirect: Home, profiles, posts, Muse, Circles, /whats-new...) is disallowed in robots.ts and only
 * ever answers a crawler with the sign-in redirect; a redirecting URL in a sitemap is an error in Search Console.
 * /try is left out too: it is a 404 whenever guest preview is switched off.
 *
 * The landing page and the FAQ are listed once per address: the plain one (x-default, in the visitor's own language)
 * and one `?lang=` address per language (src/lib/seo-locale.ts), each with the full set of hreflang alternates.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const localized: MetadataRoute.Sitemap = LOCALIZED_SEO_PATHS.flatMap((path) => {
    const languages = languageAlternates(path, base);
    const changeFrequency: ChangeFrequency = path === "/" ? "weekly" : "monthly";
    const priority = path === "/" ? 1 : 0.8;
    return [null, ...SUPPORTED_LOCALES].map((locale) => ({
      url: absoluteUrl(localizedSeoPath(path, locale), base),
      changeFrequency,
      priority,
      alternates: { languages },
    }));
  });

  const pages: { path: string; changeFrequency: ChangeFrequency; priority: number }[] = [
    { path: "/sign-up", changeFrequency: "monthly", priority: 0.8 },
    { path: "/advertise", changeFrequency: "monthly", priority: 0.7 },
    { path: "/sign-in", changeFrequency: "monthly", priority: 0.5 },
    { path: "/legal/guidelines", changeFrequency: "monthly", priority: 0.5 },
    { path: "/legal/privacy", changeFrequency: "yearly", priority: 0.3 },
    { path: "/legal/terms", changeFrequency: "yearly", priority: 0.3 },
    { path: "/legal/disclaimer", changeFrequency: "yearly", priority: 0.3 },
    { path: "/legal/delete-account", changeFrequency: "yearly", priority: 0.3 },
  ];

  return [
    ...localized,
    ...pages.map(({ path, changeFrequency, priority }) => ({
      url: absoluteUrl(path, base),
      ...(LEGAL_LAST_UPDATED[path] ? { lastModified: LEGAL_LAST_UPDATED[path] } : {}),
      changeFrequency,
      priority,
    })),
  ];
}
