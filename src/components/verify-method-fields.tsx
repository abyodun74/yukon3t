"use client";

import { useState } from "react";
import { PhoneNumberField } from "@/components/phone-number-field";
import type { Dictionary } from "@/lib/i18n/en";
import type { Locale } from "@/lib/i18n/locales";

/**
 * The sign-up form's "Verify with" choice. Email code needs nothing more (the email is already in the form above);
 * choosing Phone number reveals the phone field, so the whole sign-up — including where the code goes — is one form
 * and one "Create account" tap. The phone field stays mounted while Email code is chosen, so a number already typed
 * is still there after switching back.
 */
export function VerifyMethodFields({
  defaultCountry,
  phoneError,
  locale,
  t,
  phoneLabels,
}: {
  defaultCountry?: string | null;
  /** Why the submitted number was refused, shown under the field. */
  phoneError?: string | null;
  locale: Locale;
  t: Pick<Dictionary["signUp"]["form"], "verifyWith" | "emailCode" | "emailCodeHint" | "phoneNumber" | "phoneHint">;
  phoneLabels: Dictionary["shared"]["phoneField"];
}) {
  const [method, setMethod] = useState<"EMAIL" | "PHONE">("EMAIL");

  return (
    <fieldset>
      <legend className="block text-xs font-medium text-foreground-soft">{t.verifyWith}</legend>
      <div className="mt-1 flex gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="verificationMethod"
            value="EMAIL"
            checked={method === "EMAIL"}
            onChange={() => setMethod("EMAIL")}
          />
          {t.emailCode}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="verificationMethod"
            value="PHONE"
            checked={method === "PHONE"}
            onChange={() => setMethod("PHONE")}
          />
          {t.phoneNumber}
        </label>
      </div>

      {method === "EMAIL" && (
        <p className="mt-2 text-xs text-foreground-soft">{t.emailCodeHint}</p>
      )}
      <div className="mt-2" hidden={method !== "PHONE"}>
        <label htmlFor="signup-phone" className="sr-only">
          {t.phoneNumber}
        </label>
        <PhoneNumberField
          id="signup-phone"
          defaultCountry={defaultCountry}
          required={method === "PHONE"}
          invalid={Boolean(phoneError)}
          describedBy={phoneError ? "signup-phone-error" : "signup-phone-hint"}
          controlClassName="py-3"
          locale={locale}
          labels={phoneLabels}
        />
        {phoneError ? (
          <p id="signup-phone-error" className="mt-1 text-xs text-danger">
            {phoneError}
          </p>
        ) : (
          <p id="signup-phone-hint" className="mt-1 text-xs text-foreground-soft">
            {t.phoneHint}
          </p>
        )}
      </div>
    </fieldset>
  );
}
