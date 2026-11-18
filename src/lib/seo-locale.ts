// A crawlable address for each language of the public pages that are written in every language (the landing page and
// the FAQ). The app has no per-language URLs: a request's language comes from the picker's cookie, else
// Accept-Language, else English (resolveLocale in src/lib/i18n/locales.ts), and a crawler sends neither, so without
// this every search engine only ever sees English. `/?lang=es` and `/faq?lang=es` are the Spanish versions of those two
// pages: src/proxy.ts turns the parameter into SEO_LOCALE_HEADER for that one request, and getLocale
// (src/lib/i18n/server.ts) lets it win over the cookie and Accept-Language. Nothing is stored (no cookie is set), so a
// person who follows such a link and then moves on gets their own language back on the next page.
//
// Deliberately narrow: only LOCALIZED_SEO_PATHS, only one well-formed `lang` value, only a supported language.
// Anything else is ignored and the request resolves its language exactly as before. Pure and edge-safe (the proxy
// imports it): no next/headers, no Node APIs.

import { isLocale, type Locale } from "@/lib/i18n/locales";

export const SEO_LANG_PARAM = "lang";

/** Set by src/proxy.ts only (any copy a client sends is removed there first); read by getLocale. */
export const SEO_LOCALE_HEADER = "x-yukon3t-seo-locale";

/** The pages whose whole text is translated and that a signed-out visitor (or crawler) can read. */
export const LOCALIZED_SEO_PATHS = ["/", "/faq"] as const;
export type LocalizedSeoPath = (typeof LOCALIZED_SEO_PATHS)[number];

export function isLocalizedSeoPath(pathname: string): pathname is LocalizedSeoPath {
  return (LOCALIZED_SEO_PATHS as readonly string[]).includes(pathname);
}

/** The language a `?lang=` address asks for, or null when it doesn't apply (other page, missing, repeated, unknown). */
export function seoLocaleFromUrl(pathname: string, search: URLSearchParams): Locale | null {
  if (!isLocalizedSeoPath(pathname)) return null;
  const values = search.getAll(SEO_LANG_PARAM);
  if (values.length !== 1) return null;
  return isLocale(values[0]) ? values[0] : null;
}

/** The path of `path` in `locale` ("/faq?lang=es"), or the plain path (the language-adaptive version) for null. */
export function localizedSeoPath(path: LocalizedSeoPath, locale: Locale | null): string {
  return locale ? `${path}?${SEO_LANG_PARAM}=${locale}` : path;
}
