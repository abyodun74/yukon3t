import { cache } from "react";
import { cookies, headers } from "next/headers";
import { dictionaryFor } from "@/lib/i18n/dictionaries";
import { LOCALE_COOKIE, isLocale, resolveLocale, type Locale } from "@/lib/i18n/locales";
import { SEO_LOCALE_HEADER } from "@/lib/seo-locale";

// The request-reading half of the i18n layer: Server Components, Server Actions and route handlers only. Reading
// cookies() here is also what keeps every page that calls it dynamically rendered, never cached across visitors.

/**
 * The language a `?lang=` address of a public page asked for (src/lib/seo-locale.ts), or null. Only src/proxy.ts sets
 * the header, and only for those pages; it strips any copy a client sends.
 */
export const getSeoLocaleOverride = cache(async (): Promise<Locale | null> => {
  const value = (await headers()).get(SEO_LOCALE_HEADER);
  return isLocale(value) ? value : null;
});

/**
 * The language of the person making this request: a public page's `?lang=` address, else the picker's cookie, else
 * Accept-Language, else English.
 */
export const getLocale = cache(async () =>
  resolveLocale(
    (await getSeoLocaleOverride()) ?? (await cookies()).get(LOCALE_COOKIE)?.value,
    (await headers()).get("accept-language"),
  ),
);

export const getDictionary = cache(async () => dictionaryFor(await getLocale()));
