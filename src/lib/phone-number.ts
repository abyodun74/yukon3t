import {
  getCountries,
  getCountryCallingCode,
  isSupportedCountry,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js/min";
import { phoneSchema } from "@/lib/validations";

// Pure helpers behind PhoneNumberField (country selector + national number) and the server-side validity check.
// Client-safe. libphonenumber is imported here rather than in validations.ts on purpose: that file is bundled into
// many client pages, and the metadata would ride along into every one of them.

export const DEFAULT_PHONE_COUNTRY = "US";

export const PHONE_INVALID_MESSAGE = "That number isn't valid for the selected country — check the country and the digits.";

export type PhoneCountryOption = { code: string; name: string; dialCode: string; flag: string };

/** A supported ISO 3166-1 alpha-2 code, upper-cased; anything else (unknown, empty, a header we couldn't read) is the default. */
export function resolvePhoneCountry(country: string | null | undefined): string {
  const code = (country ?? "").trim().toUpperCase();
  return isSupportedCountry(code) ? code : DEFAULT_PHONE_COUNTRY;
}

export function phoneDialCode(country: string): string {
  return getCountryCallingCode(resolvePhoneCountry(country) as CountryCode);
}

/** The flag emoji for a country code (two regional-indicator letters); shows as the plain letters where a platform has no flag glyphs. */
export function phoneCountryFlag(country: string): string {
  return String.fromCodePoint(...[...country.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** Every country libphonenumber knows, named in `locale` (the bare code where Intl has no name for it), sorted by name. */
export function phoneCountryOptions(locale = "en"): PhoneCountryOption[] {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([locale], { type: "region" });
  } catch {
    names = null;
  }
  const nameOf = (code: string) => {
    try {
      return names?.of(code) || code;
    } catch {
      return code;
    }
  };
  return getCountries()
    .map((code) => ({ code, name: nameOf(code), dialCode: getCountryCallingCode(code), flag: phoneCountryFlag(code) }))
    .sort((a, b) => a.name.localeCompare(b.name, names ? locale : undefined));
}

/**
 * The E.164 number for what was typed next to a chosen country, e.g. ("GB", "07400 123456") → "+447400123456" (the
 * trunk "0" is dropped). Text that starts with "+" is read as a full international number whatever country is chosen.
 * Not a validity check: something unparseable still comes back as "+<dial code><digits>" so the server, which is the
 * one that decides, sees what was entered. Empty when there are no digits at all.
 */
export function assembleE164(country: string, national: string): string {
  const text = national.trim();
  if (!text) return "";
  const parsed = text.startsWith("+")
    ? parsePhoneNumberFromString(text)
    : parsePhoneNumberFromString(text, resolvePhoneCountry(country) as CountryCode);
  if (parsed) return parsed.number;
  const digits = text.replace(/\D/g, "");
  if (!digits) return "";
  return text.startsWith("+") ? `+${digits}` : `+${phoneDialCode(country)}${digits}`;
}

/**
 * Splits a full international number into the selector's two parts: its country and the number in that country's
 * national format. Null when it isn't a "+" number or no country can be told from it. `preferredCountry` settles a
 * calling code shared by several countries when the digits alone don't.
 */
export function splitE164(value: string, preferredCountry?: string): { country: string; national: string } | null {
  const text = value.trim();
  if (!text.startsWith("+")) return null;
  const parsed = parsePhoneNumberFromString(text);
  if (!parsed) return null;
  const preferred = preferredCountry ? resolvePhoneCountry(preferredCountry) : null;
  const country =
    parsed.country ??
    (preferred && phoneDialCode(preferred) === parsed.countryCallingCode ? preferred : parsed.getPossibleCountries()[0]);
  if (!country) return null;
  return { country, national: parsed.formatNational() };
}

/** Same split, but only for a complete, valid number: what a pasted or typed "+…" must be before the field takes it apart. */
export function detectInternational(text: string, preferredCountry?: string): { country: string; national: string } | null {
  if (!text.trim().startsWith("+")) return null;
  const parsed = parsePhoneNumberFromString(text.trim());
  if (!parsed || !parsed.isValid()) return null;
  return splitE164(parsed.number, preferredCountry);
}

/** Exactly E.164 (phoneSchema's shape) and a number that exists in some country's numbering plan. */
export function isValidE164(value: string): boolean {
  if (!phoneSchema.safeParse(value).success) return false;
  const parsed = parsePhoneNumberFromString(value);
  return Boolean(parsed && parsed.isValid() && parsed.number === value);
}

/**
 * phoneSchema plus libphonenumber's validity check, for the actions that are about to text a code to the number
 * (sign-up, the two "send code" actions, switching to phone). Confirming a code keeps the plain shape check.
 */
export const validPhoneSchema = phoneSchema.refine(isValidE164, "Enter a valid phone number.");
