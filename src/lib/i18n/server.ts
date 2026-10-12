import { cache } from "react";
import { cookies, headers } from "next/headers";
import { dictionaryFor } from "@/lib/i18n/dictionaries";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/locales";

// The request-reading half of the i18n layer: Server Components, Server Actions and route handlers only. Reading
// cookies() here is also what keeps every page that calls it dynamically rendered, never cached across visitors.

/** The language of the person making this request: the picker's cookie, else Accept-Language, else English. */
export const getLocale = cache(async () =>
  resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value, (await headers()).get("accept-language")),
);

export const getDictionary = cache(async () => dictionaryFor(await getLocale()));
