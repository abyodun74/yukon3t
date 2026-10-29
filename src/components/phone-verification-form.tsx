"use client";

import { useState, useTransition } from "react";
import { requestPhoneVerification, confirmPhoneVerification } from "@/app/actions/phone-verification";
import { useTurnstileGate } from "@/components/use-turnstile-gate";
import { PhoneNumberField } from "@/components/phone-number-field";
import type { Dictionary } from "@/lib/i18n/en";
import { aroundPlaceholder, type Locale } from "@/lib/i18n/locales";

const INPUT_CLASS =
  "mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent";

// The same wording as the sign-up phone step (verifyPhone.form): the actions answer with the same error codes.
type Strings = Dictionary["verifyPhone"]["form"];

function errorText(t: Strings, code: string) {
  return (t.errors as Record<string, string>)[code] ?? t.somethingWentWrong;
}

/**
 * Two-step inline flow (send code → enter code), same useTransition +
 * plain-object-return shape as AdminSendResetButton — this isn't a
 * full-page-navigation form like setPassword's, so both server actions
 * return {error} instead of redirecting.
 *
 * Every SMS send (first send and "Resend code" alike) carries a Cloudflare
 * Turnstile token: an SMS costs real money per message, so a script hammering
 * this is the expensive kind of abuse. The code-entry step doesn't send an SMS
 * and isn't gated.
 */
export function PhoneVerificationForm({
  phone,
  phoneVerifiedAt,
  defaultCountry,
  locale,
  t,
  shared,
  verifiedLabel,
}: {
  phone: string | null;
  phoneVerifiedAt: Date | null;
  /** The request's geo country, for the country selector's starting choice. */
  defaultCountry: string | null;
  locale: Locale;
  t: Strings;
  shared: Dictionary["shared"];
  /** "Phone verified: {number}", from the Settings wording. */
  verifiedLabel: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [pendingPhone, setPendingPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const captcha = useTurnstileGate(locale, shared.turnstile);

  if (phoneVerifiedAt && phone) {
    const [before, after] = aroundPlaceholder(verifiedLabel, "number");
    return (
      <p className="text-sm">
        {before}
        <bdi className="font-medium">•••• {phone.slice(-4)}</bdi>
        {after}
      </p>
    );
  }

  if (step === "code") {
    return (
      <div>
        <form
          key="code"
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            formData.set("phone", pendingPhone);
            setError(null);
            startTransition(async () => {
              const result = await confirmPhoneVerification(formData);
              if (result.error) {
                // "invalid" on this step can only be the code's format: the number was accepted when the code was sent.
                setError(errorText(t, result.error === "invalid" ? "invalid_code" : result.error));
                return;
              }
              // Verified — re-render will pick up the new phoneVerifiedAt
              // once the parent Settings page revalidates (see the action's
              // revalidatePath("/settings")).
            });
          }}
        >
          <div>
            <label className="block text-sm font-medium">{t.codeLabel}</label>
            <input
              aria-label={t.codeLabel}
              name="code"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={10}
              dir="ltr"
              className={INPUT_CLASS}
            />
          </div>
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-lg border border-line px-4 py-2 text-sm font-semibold hover:border-accent hover:text-accent disabled:opacity-50"
            >
              {t.verify}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setError(null);
                const formData = new FormData();
                formData.set("phone", pendingPhone);
                startTransition(async () => {
                  if (!(await captcha.attach(formData))) {
                    setError(captcha.holdMessage());
                    return;
                  }
                  const result = await requestPhoneVerification(formData);
                  if (result.error) {
                    setError(errorText(t, result.error));
                  }
                });
              }}
              className="text-sm text-accent hover:underline disabled:opacity-50"
            >
              {t.resendCode}
            </button>
          </div>
        </form>
        {captcha.widget}
      </div>
    );
  }

  return (
    <div>
      <form
        key="phone"
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const formData = new FormData(e.currentTarget);
          const phoneValue = String(formData.get("phone") ?? "").trim();
          setError(null);
          startTransition(async () => {
            if (!(await captcha.attach(formData))) {
              setError(captcha.holdMessage());
              return;
            }
            const result = await requestPhoneVerification(formData);
            if (result.error) {
              setError(errorText(t, result.error));
              return;
            }
            setPendingPhone(result.phone ?? phoneValue);
            setStep("code");
          });
        }}
      >
        <div>
          <label htmlFor="settings-phone-number" className="block text-sm font-medium">
            {t.phoneLabel}
          </label>
          <div className="mt-1">
            <PhoneNumberField
              id="settings-phone-number"
              defaultCountry={defaultCountry}
              locale={locale}
              labels={shared.phoneField}
            />
          </div>
        </div>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-lg border border-line px-4 py-2.5 text-sm font-semibold hover:border-accent hover:text-accent disabled:opacity-50"
        >
          {t.sendCode}
        </button>
      </form>
      {captcha.widget}
    </div>
  );
}
