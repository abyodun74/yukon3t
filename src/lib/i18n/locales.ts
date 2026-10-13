// The languages the translated parts of the app are written in, and how a request's language is chosen. Translated:
// the landing page and the account screens (sign in, sign up, verify, password recovery, onboarding, sign out) and
// their emails; everything under /messages; and the components src/components/ui-text.tsx serves wherever they are
// mounted (comments, recorders and pickers, dictation, reactions, the report sheet); the Language block of Settings
// and the two FAQ entries about languages. The rest of the app, and every
// notification written for someone else (whose language isn't stored), is English.
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

/** The `dir` for anything written in `locale`. Goes on the same element as `lang`: the page shell around it is English. */
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
