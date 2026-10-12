// The languages the account screens (sign in, sign up, verify, password recovery, onboarding, sign out) are written
// in, and how a request's language is chosen. Pure and client-safe: the half that reads next/headers is in server.ts.

export const SUPPORTED_LOCALES = ["en", "es", "fr", "pt"] as const;
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
};

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
