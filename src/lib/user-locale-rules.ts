import { isLocale, resolveLocale, type Locale } from "@/lib/i18n/locales";

// The pure half of src/lib/user-locale.ts: which language, if any, to write onto someone's account from one request.

/**
 * What to store as User.locale given what is stored now and what this request says, or null to leave it alone.
 *
 * - An explicit choice (the picker's cookie on this device) wins and is written whenever it differs.
 * - A language only implied by the device (Accept-Language) is written only when nothing is stored yet. Someone with
 *   a phone in Arabic and a laptop in English, neither ever set by hand, would otherwise flip the stored language (and
 *   write the User row) every time they switched devices.
 */
export function localeToRecord(
  stored: string | null | undefined,
  cookieValue: string | null | undefined,
  acceptLanguage: string | null | undefined,
): Locale | null {
  if (isLocale(cookieValue)) return cookieValue === stored ? null : cookieValue;
  if (isLocale(stored)) return null;
  return resolveLocale(null, acceptLanguage);
}
