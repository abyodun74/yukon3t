"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  requestSignupPhoneVerification,
  confirmSignupPhoneVerification,
} from "@/app/actions/signup-phone-verification";

const INPUT_CLASS =
  "mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent";

const ERROR_MESSAGES: Record<string, string> = {
  invalid: "Enter a valid phone number with country code (e.g. +14155551234).",
  invalid_code: "That code didn't match — check it and try again.",
  rate_limited: "Too many attempts — try again in a bit.",
  not_configured: "Phone verification isn't set up yet.",
  phone_taken: "That number is already verified on another account.",
  send_failed: "Couldn't send the code — try again in a moment.",
  no_session: "This link expired — please sign up again.",
};

/**
 * Signup counterpart to PhoneVerificationForm (src/components/phone-
 * verification-form.tsx) — same two-step flow, but calls the unauthenticated
 * signup-phone-verification actions. If `initialPhone` is set (the pending-
 * verification cookie already has a number from an earlier visit), skips
 * straight to the code step and auto-fires a fresh send — the "automatic
 * resend when stuck" behavior for the phone path.
 */
export function SignupPhoneVerificationForm({ initialPhone }: { initialPhone: string | null }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState<"phone" | "code">(initialPhone ? "code" : "phone");
  const [pendingPhone, setPendingPhone] = useState(initialPhone ?? "");
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const autoResent = useRef(false);

  useEffect(() => {
    if (!initialPhone || autoResent.current) return;
    autoResent.current = true;
    startTransition(async () => {
      const formData = new FormData();
      formData.set("phone", initialPhone);
      const result = await requestSignupPhoneVerification(formData);
      if (result.error) {
        setError(ERROR_MESSAGES[result.error] ?? "Something went wrong — try again.");
      }
    });
  }, [initialPhone]);

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
              setError(ERROR_MESSAGES[result.error] ?? "Something went wrong — try again.");
              return;
            }
            setVerified(true);
          });
        }}
      >
        <div>
          <label className="block text-sm font-medium">Enter the code we sent you</label>
          <input
            name="code"
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={10}
            className={INPUT_CLASS}
          />
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}
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
              startTransition(async () => {
                const formData = new FormData();
                formData.set("phone", pendingPhone);
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
    );
  }

  return (
    <form
      key="phone"
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const phoneValue = String(formData.get("phone") ?? "").trim();
        setError(null);
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
        <label className="block text-sm font-medium">Phone number</label>
        <input
          name="phone"
          type="tel"
          required
          placeholder="+14155551234"
          className={INPUT_CLASS}
        />
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink disabled:opacity-50"
      >
        Send code
      </button>
    </form>
  );
}
