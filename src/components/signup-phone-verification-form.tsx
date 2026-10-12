"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  requestSignupPhoneVerification,
  confirmSignupPhoneVerification,
} from "@/app/actions/signup-phone-verification";
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
  no_session: "This link expired — please sign up again.",
  captcha: "We couldn't complete the security check — please try again.",
};

/**
 * Signup counterpart to PhoneVerificationForm (src/components/phone-
 * verification-form.tsx) — same two-step flow, but calls the unauthenticated
 * signup-phone-verification actions. If `initialPhone` is set (the pending-
 * verification cookie already has a number from an earlier visit), skips
 * straight to the code step and auto-fires a fresh send — the "automatic
 * resend when stuck" behavior for the phone path. That automatic send waits for
 * the Turnstile token like any other, so it goes out a moment after the page
 * loads rather than instantly.
 *
 * Every SMS send (first send, "Resend code", and the automatic one) carries a
 * Turnstile token — an SMS costs real money per message. Confirming a code
 * doesn't send one and isn't gated.
 */
export function SignupPhoneVerificationForm({
  initialPhone,
  defaultCountry,
}: {
  initialPhone: string | null;
  /** The request's geo country, for the country selector's starting choice. */
  defaultCountry: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState<"phone" | "code">(initialPhone ? "code" : "phone");
  const [pendingPhone, setPendingPhone] = useState(initialPhone ?? "");
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const autoResent = useRef(false);
  const captcha = useTurnstileGate();
  const { attach, ready } = captcha;

  useEffect(() => {
    if (!initialPhone || autoResent.current || !ready) return;
    const formData = new FormData();
    formData.set("phone", initialPhone);
    if (!attach(formData)) return; // token expired in the gap — the Resend button is still there
    autoResent.current = true;
    startTransition(async () => {
      const result = await requestSignupPhoneVerification(formData);
      if (result.error) {
        setError(ERROR_MESSAGES[result.error] ?? "Something went wrong — try again.");
      }
    });
  }, [initialPhone, ready, attach]);

  if (verified) {
    return (
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Phone confirmed</h1>
        <p className="mt-3 text-sm text-foreground-soft">
          Your account is verified. You can now sign in.
        </p>
        <button
          type="button"
          onClick={() => router.push("/sign-in")}
          className="mt-6 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink"
        >
          Sign in
        </button>
      </div>
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
              const result = await confirmSignupPhoneVerification(formData);
              if (result.error) {
                // "invalid" on this step can only be the code's format: the number was accepted when the code was sent.
                setError(
                  ERROR_MESSAGES[result.error === "invalid" ? "invalid_code" : result.error] ??
                    "Something went wrong — try again.",
                );
                return;
              }
              setVerified(true);
            });
          }}
        >
          <div>
            <label htmlFor="signup-phone-code" className="block text-sm font-medium">
              Enter the code we sent you
            </label>
            <input
              id="signup-phone-code"
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
              className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink disabled:opacity-50"
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
                if (!attach(formData)) {
                  setError(TURNSTILE_WAIT_MESSAGE);
                  return;
                }
                startTransition(async () => {
                  const result = await requestSignupPhoneVerification(formData);
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
          if (!attach(formData)) {
            setError(TURNSTILE_WAIT_MESSAGE);
            return;
          }
          startTransition(async () => {
            const result = await requestSignupPhoneVerification(formData);
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
          <label htmlFor="signup-phone-number" className="block text-sm font-medium">
            Phone number
          </label>
          <div className="mt-1">
            <PhoneNumberField id="signup-phone-number" defaultCountry={defaultCountry} />
          </div>
        </div>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink disabled:opacity-50"
        >
          Send code
        </button>
      </form>
      {captcha.widget}
    </div>
  );
}
