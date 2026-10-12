"use client";

import { useState, useTransition } from "react";
import { requestPhoneVerification, confirmPhoneVerification } from "@/app/actions/phone-verification";
import { useTurnstileGate, TURNSTILE_WAIT_MESSAGE } from "@/components/use-turnstile-gate";
import { PhoneNumberField } from "@/components/phone-number-field";
import { PHONE_INVALID_MESSAGE } from "@/lib/phone-number";

const INPUT_CLASS =
  "mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent";

const ERROR_MESSAGES: Record<string, string> = {
  invalid: PHONE_INVALID_MESSAGE,
  invalid_code: "That code didn't match — check it and try again.",
  rate_limited: "Too many attempts — try again in a bit.",
  not_configured: "Phone verification isn't set up yet.",
  phone_taken: "That number is already verified on another account.",
  send_failed: "Couldn't send the code — try again in a moment.",
  captcha: "We couldn't complete the security check — please try again.",
};

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
}: {
  phone: string | null;
  phoneVerifiedAt: Date | null;
  /** The request's geo country, for the country selector's starting choice. */
  defaultCountry: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [pendingPhone, setPendingPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const captcha = useTurnstileGate();

  if (phoneVerifiedAt && phone) {
    return (
      <p className="text-sm">
        Phone verified: <span className="font-medium">•••• {phone.slice(-4)}</span>
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
                setError(
                  ERROR_MESSAGES[result.error === "invalid" ? "invalid_code" : result.error] ??
                    "Something went wrong — try again.",
                );
                return;
              }
              // Verified — re-render will pick up the new phoneVerifiedAt
              // once the parent Settings page revalidates (see the action's
              // revalidatePath("/settings")).
            });
          }}
        >
          <div>
            <label className="block text-sm font-medium">Enter the code we sent you</label>
            <input
              aria-label="Enter the code we sent you"
              name="code"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={10}
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
              Verify
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setError(null);
                const formData = new FormData();
                formData.set("phone", pendingPhone);
                if (!captcha.attach(formData)) {
                  setError(TURNSTILE_WAIT_MESSAGE);
                  return;
                }
                startTransition(async () => {
                  const result = await requestPhoneVerification(formData);
                  if (result.error) {
                    setError(ERROR_MESSAGES[result.error] ?? "Something went wrong — try again.");
                  }
                });
              }}
              className="text-sm text-accent hover:underline disabled:opacity-50"
            >
              Resend code
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
          if (!captcha.attach(formData)) {
            setError(TURNSTILE_WAIT_MESSAGE);
            return;
          }
          startTransition(async () => {
            const result = await requestPhoneVerification(formData);
            if (result.error) {
              setError(ERROR_MESSAGES[result.error] ?? "Something went wrong — try again.");
              return;
            }
            setPendingPhone(result.phone ?? phoneValue);
            setStep("code");
          });
        }}
      >
        <div>
          <label htmlFor="settings-phone-number" className="block text-sm font-medium">
            Phone number
          </label>
          <div className="mt-1">
            <PhoneNumberField id="settings-phone-number" defaultCountry={defaultCountry} />
          </div>
        </div>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-lg border border-line px-4 py-2.5 text-sm font-semibold hover:border-accent hover:text-accent disabled:opacity-50"
        >
          Send code
        </button>
      </form>
      {captcha.widget}
    </div>
  );
}
