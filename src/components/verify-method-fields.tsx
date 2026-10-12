"use client";

import { useState } from "react";
import { PhoneNumberField } from "@/components/phone-number-field";

/**
 * The sign-up form's "Verify with" choice. Email code needs nothing more (the email is already in the form above);
 * choosing Phone number reveals the phone field, so the whole sign-up — including where the code goes — is one form
 * and one "Create account" tap. The phone field stays mounted while Email code is chosen, so a number already typed
 * is still there after switching back.
 */
export function VerifyMethodFields({
  defaultCountry,
  phoneError,
}: {
  defaultCountry?: string | null;
  /** Why the submitted number was refused, shown under the field. */
  phoneError?: string | null;
}) {
  const [method, setMethod] = useState<"EMAIL" | "PHONE">("EMAIL");

  return (
    <fieldset>
      <legend className="block text-xs font-medium text-foreground-soft">Verify with</legend>
      <div className="mt-1 flex gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="verificationMethod"
            value="EMAIL"
            checked={method === "EMAIL"}
            onChange={() => setMethod("EMAIL")}
          />
          Email code
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="verificationMethod"
            value="PHONE"
            checked={method === "PHONE"}
            onChange={() => setMethod("PHONE")}
          />
          Phone number
        </label>
      </div>

      {method === "EMAIL" && (
        <p className="mt-2 text-xs text-foreground-soft">We&apos;ll email a 6-digit code to the address above.</p>
      )}
      <div className="mt-2" hidden={method !== "PHONE"}>
        <label htmlFor="signup-phone" className="sr-only">
          Phone number
        </label>
        <PhoneNumberField
          id="signup-phone"
          defaultCountry={defaultCountry}
          required={method === "PHONE"}
          invalid={Boolean(phoneError)}
          describedBy={phoneError ? "signup-phone-error" : "signup-phone-hint"}
          controlClassName="py-3"
        />
        {phoneError ? (
          <p id="signup-phone-error" className="mt-1 text-xs text-danger">
            {phoneError}
          </p>
        ) : (
          <p id="signup-phone-hint" className="mt-1 text-xs text-foreground-soft">
            We&apos;ll text a code to this number.
          </p>
        )}
      </div>
    </fieldset>
  );
}
