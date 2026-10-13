// The languages the app is written in, and how a request's language is chosen. <html> carries the reader's language
// and direction. Translated: the nav and footer and the overlays any screen opens; the landing page and the account
// screens and their emails; Home (posts, the composer, sharing, stories, the live strip), a post's page, Search,
// Discover, Connections, Notifications and What's new; everything under /messages; comments, recorders and pickers,
// dictation, reactions and the report sheet; profiles (/u), Settings, the invite page and the Advertise pages;
// Circles and Collab Boards (/circles, /collab); the two FAQ entries about languages. The fixed lists people pick
// from (countries, languages, interests, a Circle's general categories, collaboration types) are shown translated
// and stored in English (country-names.ts, language-names.ts, the vocab area); job titles are shown as stored.
// Still English, each behind an EnglishOnly wrapper (src/components/english-only.tsx): Muse, the live room, calls
// (the call overlays, the call button and Muse composer a profile opens, and the call frame of a Circle's voice
// room), the FAQ, and legal and admin (which stay English). So is every notification written for someone else,
// whose language isn't stored.
// Pure and client-safe: the half that reads next/headers is in server.ts.

export const SUPPORTED_LOCALES = ["en", "es", "fr", "pt", "ar"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_COOKIE = "yukon3t.locale";
export const LOCALE_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/** Each language under its own name, for the picker. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  es: "Español",
  fr: "Français",
  pt: "Português",
  ar: "العربية",
};

/** The `dir` for anything written in `locale`. Goes on the same element as `lang` (<html>, or a block inside an English part). */
export function localeDirection(locale: Locale): "ltr" | "rtl" {
  return locale === "ar" ? "rtl" : "ltr";
}

export function isLocale(value: unknown): value is Locale {
  return (SUPPORTED_LOCALES as readonly unknown[]).includes(value);
}

/**
 * The language for a request: the picker's cookie when it names a supported language, otherwise the best supported
 * match in Accept-Language (highest q first, header order between equals; a region subtag such as pt-BR, es-419 or
 * fr-CA counts as its base language), otherwise English.
 */
export function resolveLocale(cookieValue: string | null | undefined, acceptLanguage: string | null | undefined): Locale {
  if (isLocale(cookieValue)) return cookieValue;

  const ranked = (acceptLanguage ?? "")
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const quality = q === undefined ? 1 : Number(q.slice(2));
      return { base: tag.trim().toLowerCase().split("-")[0], quality: Number.isNaN(quality) ? 0 : quality, index };
    })
    .filter((entry) => entry.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);

  for (const { base } of ranked) {
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

/** Same choice, for code handed a Request rather than running inside one (Auth.js's sendVerificationRequest). */
export function localeFromRequest(request: Request): Locale {
  const cookie = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((pair) => pair.trim())
    .find((pair) => pair.startsWith(`${LOCALE_COOKIE}=`));
  return resolveLocale(cookie?.slice(LOCALE_COOKIE.length + 1), request.headers.get("accept-language"));
}

/** Fills `{name}` placeholders; one with no value given is left as written. */
export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : placeholder,
  );
}

/**
 * The tag to hand Intl (dates, plural rules) for wording in `locale`. English gets none, so dates keep the device's
 * own regional format as they always have; Arabic asks for Western digits, the way ar.ts writes every number.
 */
export function intlLocale(locale: Locale): string | undefined {
  if (locale === "en") return undefined;
  return locale === "ar" ? "ar-u-nu-latn" : locale;
}

/**
 * Picks the form of a "one: … | other: …" entry that `count` takes in `locale` and puts the number where "#" is.
 * A category the entry doesn't list falls back to "other".
 */
export function plural(locale: Locale, forms: string, count: number): string {
  const byCategory = new Map(
    forms.split("|").map((part) => {
      const colon = part.indexOf(":");
      return [part.slice(0, colon).trim(), part.slice(colon + 1).trim()] as const;
    }),
  );
  const category = new Intl.PluralRules(locale).select(count);
  return (byCategory.get(category) ?? byCategory.get("other") ?? "").replaceAll("#", String(count));
}

/**
 * A template's wording before and after its `{name}` placeholder, for when the value is rendered as an element of
 * its own (a bold name) rather than filled in as text. Each language puts the name where its grammar wants it.
 */
export function aroundPlaceholder(template: string, name: string): [string, string] {
  const token = `{${name}}`;
  const at = template.indexOf(token);
  return at === -1 ? [template, ""] : [template.slice(0, at), template.slice(at + token.length)];
}

/** The message for an error code among `messages`, or its `other` when the code isn't one of them. */
export function byCode<T extends { other: string }>(messages: T, code: string | null | undefined): string {
  const known: Record<string, unknown> = messages;
  const found = code != null && Object.hasOwn(known, code) ? known[code] : undefined;
  return typeof found === "string" ? found : messages.other;
}
