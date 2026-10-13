"use client";

import { useState, useSyncExternalStore } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  assembleE164,
  detectInternational,
  phoneCountryFlag,
  phoneCountryOptions,
  phoneDialCode,
  resolvePhoneCountry,
  splitE164,
  type PhoneCountryOption,
} from "@/lib/phone-number";
import { sharedEn } from "@/lib/i18n/en/shared";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locales";

const CONTROL_CLASS = "rounded-lg border border-line bg-surface text-sm";

const countryOptions = new Map<Locale, PhoneCountryOption[]>();
function getCountryOptions(locale: Locale) {
  let options = countryOptions.get(locale);
  if (!options) {
    options = phoneCountryOptions(locale);
    countryOptions.set(locale, options);
  }
  return options;
}

const subscribeToNothing = () => () => {};

/**
 * Phone entry as two parts — a country selector (flag and dial code; the list reads "United States +1") next to the
 * national number — submitted as one E.164 value under `name`, so every action keeps receiving what it always did.
 * The server still decides whether the number is valid (validPhoneSchema); this never blocks a submit itself.
 *
 * - The selector is a real <select> stretched invisibly over the flag/dial-code chip: native pickers are the one
 *   thing that behaves in both WKWebView and Android WebView, and the chip (which leaves the country's name out
 *   below the `sm` breakpoint) keeps the row narrow enough for 320px.
 * - Typing or pasting a full international number ("+44 7400 123456") picks its country and leaves the national part.
 * - `defaultValue` (an E.164 number entered earlier) is taken apart the same way; `defaultCountry` is the server's
 *   guess from the request's geo header (src/lib/request-country.ts) and falls back to the US.
 * - The country names come from the browser's own Intl data, which can differ from the server's, so the full list is
 *   only rendered after hydration; until then the select holds just the current country.
 * - `locale` and `labels` are passed by the screens that are in the reader's language (country names and the field's
 *   own wording): the account screens, Settings and the invite panel. Left out, the field is English.
 */
export function PhoneNumberField({
  id,
  name = "phone",
  defaultValue = "",
  defaultCountry,
  required = true,
  invalid = false,
  describedBy,
  controlClassName = "py-2.5",
  onValueChange,
  locale = DEFAULT_LOCALE,
  labels = sharedEn.phoneField,
}: {
  /** Goes on the national-number input: point the field's <label htmlFor> at it. */
  id: string;
  name?: string;
  defaultValue?: string;
  defaultCountry?: string | null;
  required?: boolean;
  invalid?: boolean;
  describedBy?: string;
  /** Vertical padding, to match the inputs around it. */
  controlClassName?: string;
  /** For a caller with no <form> to read the value from (invite-panel.tsx): the E.164 value after every change. */
  onValueChange?: (e164: string) => void;
  locale?: Locale;
  labels?: typeof sharedEn.phoneField;
}) {
  const [{ country, national }, setPartsState] = useState(
    () =>
      splitE164(defaultValue, defaultCountry ?? undefined) ?? {
        country: resolvePhoneCountry(defaultCountry),
        national: defaultValue.trim(),
      },
  );
  function setParts(next: { country: string; national: string }) {
    setPartsState(next);
    onValueChange?.(assembleE164(next.country, next.national));
  }
  const hydrated = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
  const options = hydrated ? getCountryOptions(locale) : null;
  const dialCode = phoneDialCode(country);
  const countryName = options?.find((o) => o.code === country)?.name;

  return (
    // Always left-to-right, on the Arabic account screens too: "+966 5…" is read country code first.
    <div dir="ltr" className="flex gap-2">
      <div className="relative flex shrink-0">
        <select
          aria-label={labels.countryCode}
          value={country}
          onChange={(e) => setParts({ country: e.target.value, national })}
          className="peer absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
        >
          {options ? (
            options.map((o) => (
              <option key={o.code} value={o.code}>
                {o.name} +{o.dialCode}
              </option>
            ))
          ) : (
            <option value={country}>
              {country} +{dialCode}
            </option>
          )}
        </select>
        <div
          aria-hidden="true"
          className={cn(
            CONTROL_CLASS,
            controlClassName,
            "pointer-events-none flex items-center gap-1.5 px-3 peer-focus:border-accent",
          )}
        >
          <span>{phoneCountryFlag(country)}</span>
          {countryName && <span className="hidden max-w-32 truncate sm:inline">{countryName}</span>}
          <span>+{dialCode}</span>
          <ChevronDown size={14} className="text-foreground-soft" />
        </div>
      </div>
      <input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        required={required}
        value={national}
        onChange={(e) =>
          setParts(detectInternational(e.target.value, country) ?? { country, national: e.target.value })
        }
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        placeholder={labels.placeholder}
        className={cn(
          CONTROL_CLASS,
          controlClassName,
          "min-w-0 flex-1 px-4 outline-none focus:border-accent",
          invalid && "border-danger",
        )}
      />
      <input type="hidden" name={name} value={assembleE164(country, national)} />
    </div>
  );
}
