"use client";

import { useState } from "react";

/**
 * The sign-up form's "Verify with" choice. Email code needs nothing more (the email is already in the form above);
 * choosing Phone number reveals the phone field, so the whole sign-up — including where the code goes — is one form
 * and one "Create account" tap.
 */
export function VerifyMethodFields({
  defaultMethod = "EMAIL",
  defaultPhone = "",
}: {
  defaultMethod?: "EMAIL" | "PHONE";
  defaultPhone?: string;
}) {
  const [method, setMethod] = useState<"EMAIL" | "PHONE">(defaultMethod);

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

      {method === "EMAIL" ? (
        <p className="mt-2 text-xs text-foreground-soft">We&apos;ll email a 6-digit code to the address above.</p>
      ) : (
        <div className="mt-2">
          <label htmlFor="signup-phone" className="sr-only">
            Phone number
          </label>
          <input
            id="signup-phone"
            type="tel"
            name="phone"
            required
            autoComplete="tel"
            defaultValue={defaultPhone}
            placeholder="+14155551234"
            className="w-full rounded-lg border border-line bg-surface px-4 py-3 text-sm outline-none focus:border-accent"
          />
          <p className="mt-1 text-xs text-foreground-soft">
            Include your country code. We&apos;ll text a code to this number.
          </p>
        </div>
      )}
    </fieldset>
  );
}
