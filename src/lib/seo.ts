// Search-engine metadata and structured data for the public pages. Pure (no next/headers): pages pass in the locale
// and whether this request came through a `?lang=` address (src/lib/seo-locale.ts), and get back plain objects.
//
// What is claimed here must be true of the app: no ratings, reviews, prices or download counts are invented, and a
// store link appears only when it is known (Android's from the package id; iOS's only once IOS_APP_STORE_ID is set).

import type { Metadata } from "next";
import { CANONICAL_ORIGIN } from "@/lib/app-links";
import { APP_PACKAGE_ID } from "@/lib/app-version";
import { SUPPORTED_LOCALES, type Locale } from "@/lib/i18n/locales";
import { localizedSeoPath, type LocalizedSeoPath } from "@/lib/seo-locale";

export const SITE_NAME = "YuKon3t";
export const PARENT_ORGANIZATION = { name: "Motiff Core Holdings", url: "https://motiffcoreholdings.com" } as const;
export const SHARE_IMAGE = { path: "/icons/icon-512.png", width: 512, height: 512 } as const;

/** Google Play listing, from the Android applicationId (android/app/build.gradle). */
export const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${APP_PACKAGE_ID}`;

/**
 * The address canonical links, the sitemap and structured data use. In production always https://yukon3t.com (the
 * same origin every shared link uses, src/lib/app-links.ts), so a mirror deployment never presents itself as the
 * original; elsewhere NEXT_PUBLIC_APP_URL, so a local build points at itself.
 */
export function siteUrl(env: Partial<Record<string, string | undefined>> = process.env): string {
  if (env.NODE_ENV === "production") return CANONICAL_ORIGIN;
  return (env.NEXT_PUBLIC_APP_URL || CANONICAL_ORIGIN).replace(/\/+$/, "");
}

export function absoluteUrl(path: string, base = siteUrl()): string {
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/** The App Store listing, once its numeric id is configured (IOS_APP_STORE_ID, digits only); null until then. */
export function appStoreUrl(env: Partial<Record<string, string | undefined>> = process.env): string | null {
  const id = env.IOS_APP_STORE_ID?.trim();
  return id && /^\d{6,12}$/.test(id) ? `https://apps.apple.com/app/id${id}` : null;
}

/** og:locale for each language (language_TERRITORY, as Open Graph expects). */
export const OPEN_GRAPH_LOCALE: Record<Locale, string> = {
  en: "en_US",
  es: "es_ES",
  fr: "fr_FR",
  pt: "pt_BR",
  ar: "ar_AR",
  de: "de_DE",
  it: "it_IT",
  hi: "hi_IN",
  sw: "sw_KE",
};

/**
 * hreflang alternates of a localized page: x-default is the plain address (it follows the visitor's own language),
 * each language its `?lang=` address. Every version lists all of them, itself included, as Google requires.
 */
export function languageAlternates(path: LocalizedSeoPath, base = siteUrl()): Record<string, string> {
  const alternates: Record<string, string> = { "x-default": absoluteUrl(path, base) };
  for (const locale of SUPPORTED_LOCALES) alternates[locale] = absoluteUrl(localizedSeoPath(path, locale), base);
  return alternates;
}

/**
 * The date each legal page shows as "Last updated" (sitemap.test.ts reads the pages and fails when one changes
 * without this). Other pages have no reliable date, so they carry none rather than a made-up "now".
 */
export const LEGAL_LAST_UPDATED: Record<string, string> = {
  "/legal/guidelines": "2026-11-24",
  "/legal/privacy": "2026-11-24",
  "/legal/terms": "2026-11-24",
  "/legal/disclaimer": "2026-08-08",
  "/legal/delete-account": "2026-08-08",
};

export type PageSeoText = { title: string; description: string };

/**
 * Metadata for a public page in the language it is being served in. `path` is the page; `seoLocale` is the language
 * of the `?lang=` address this request came through (null for the plain address). The canonical link names the
 * address that was asked for, so each language version is its own page to a search engine (canonicalising them all
 * to the plain address would tell Google to drop them). Titles are absolute: each already carries the brand.
 */
export function localizedPageMetadata({
  path,
  locale,
  seoLocale,
  text,
  base = siteUrl(),
}: {
  path: LocalizedSeoPath;
  locale: Locale;
  seoLocale: Locale | null;
  text: PageSeoText;
  base?: string;
}): Metadata {
  const canonical = absoluteUrl(localizedSeoPath(path, seoLocale), base);
  return {
    title: { absolute: text.title },
    description: text.description,
    alternates: { canonical, languages: languageAlternates(path, base) },
    openGraph: {
      type: "website",
      url: canonical,
      siteName: SITE_NAME,
      title: text.title,
      description: text.description,
      locale: OPEN_GRAPH_LOCALE[locale],
      alternateLocale: SUPPORTED_LOCALES.filter((other) => other !== locale).map((other) => OPEN_GRAPH_LOCALE[other]),
      images: [{ url: absoluteUrl(SHARE_IMAGE.path, base), width: SHARE_IMAGE.width, height: SHARE_IMAGE.height }],
    },
    twitter: {
      card: "summary",
      title: text.title,
      description: text.description,
      images: [absoluteUrl(SHARE_IMAGE.path, base)],
    },
  };
}

/**
 * JSON for a <script type="application/ld+json">. JSON.stringify alone would let a "</script>" (or "<!--") inside a
 * string end the element early, so every <, > and & is written as its \u escape, which JSON parses back to the same
 * text; U+2028/U+2029 are escaped too.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

type JsonLdNode = Record<string, unknown>;

/** The landing page's structured data: who runs the site, the site itself, and the apps that exist today. */
export function landingJsonLd({
  locale,
  description,
  base = siteUrl(),
  iosUrl = appStoreUrl(),
}: {
  locale: Locale;
  description: string;
  base?: string;
  iosUrl?: string | null;
}): JsonLdNode {
  const home = absoluteUrl("/", base);
  const organizationId = `${home}#organization`;
  const app = (operatingSystem: string, url: string): JsonLdNode => ({
    "@type": "MobileApplication",
    name: SITE_NAME,
    operatingSystem,
    applicationCategory: "SocialNetworkingApplication",
    url,
    installUrl: url,
    isAccessibleForFree: true,
    publisher: { "@id": organizationId },
  });
  const graph: JsonLdNode[] = [
    {
      "@type": "Organization",
      "@id": organizationId,
      name: SITE_NAME,
      url: home,
      logo: absoluteUrl(SHARE_IMAGE.path, base),
      parentOrganization: { "@type": "Organization", name: PARENT_ORGANIZATION.name, url: PARENT_ORGANIZATION.url },
    },
    {
      "@type": "WebSite",
      "@id": `${home}#website`,
      url: home,
      name: SITE_NAME,
      description,
      inLanguage: [...SUPPORTED_LOCALES],
      publisher: { "@id": organizationId },
    },
    {
      "@type": "WebPage",
      "@id": `${home}#webpage`,
      url: home,
      name: SITE_NAME,
      description,
      inLanguage: locale,
      isPartOf: { "@id": `${home}#website` },
      about: { "@id": organizationId },
    },
    app("Android", PLAY_STORE_URL),
  ];
  if (iosUrl) graph.push(app("iOS", iosUrl));
  return { "@context": "https://schema.org", "@graph": graph };
}

export type FaqJsonLdEntry = { question: string; answer: string };

/**
 * At most this many questions, and this much answer text, go into the FAQ page's structured data. The page holds
 * over 170 long answers; marking up every one would add a few hundred KB to each FAQ load for no extra benefit. The
 * entries are whole (never a cut-off answer), in page order, and only ones the page shows.
 */
export const FAQ_JSON_LD_MAX_ENTRIES = 47;
export const FAQ_JSON_LD_MAX_CHARS = 40_000;

export function faqPageJsonLd({
  url,
  locale,
  entries,
}: {
  url: string;
  locale: Locale;
  entries: FaqJsonLdEntry[];
}): JsonLdNode {
  const kept: FaqJsonLdEntry[] = [];
  let chars = 0;
  for (const entry of entries) {
    const question = entry.question.trim();
    const answer = entry.answer.trim();
    if (!question || !answer) continue;
    if (kept.length >= FAQ_JSON_LD_MAX_ENTRIES || chars + question.length + answer.length > FAQ_JSON_LD_MAX_CHARS) break;
    kept.push({ question, answer });
    chars += question.length + answer.length;
  }
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    url,
    inLanguage: locale,
    mainEntity: kept.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };
}
