"use client";

import { useState, useTransition } from "react";
import { requestPhoneVerification, confirmPhoneVerification } from "@/app/actions/phone-verification";

const INPUT_CLASS =
  "mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent";

const ERROR_MESSAGES: Record<string, string> = {
  invalid: "Enter a valid phone number with country code (e.g. +14155551234).",
  invalid_code: "That code didn't match — check it and try again.",
  rate_limited: "Too many attempts — try again in a bit.",
  not_configured: "Phone verification isn't set up yet.",
  phone_taken: "That number is already verified on another account.",
  send_failed: "Couldn't send the code — try again in a moment.",
};

/**
 * Two-step inline flow (send code → enter code), same useTransition +
 * plain-object-return shape as AdminSendResetButton — this isn't a
 * full-page-navigation form like setPassword's, so both server actions
 * return {error} instead of redirecting.
 */
export function PhoneVerificationForm({
  phone,
  phoneVerifiedAt,
}: {
  phone: string | null;
  phoneVerifiedAt: Date | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [pendingPhone, setPendingPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (phoneVerifiedAt && phone) {
    return (
      <p className="text-sm">
        Phone verified: <span className="font-medium">•••• {phone.slice(-4)}</span>
      </p>
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
            const result = await confirmPhoneVerification(formData);
            if (result.error) {
              setError(ERROR_MESSAGES[result.error] ?? "Something went wrong — try again.");
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
            className="rounded-lg border border-line px-4 py-2 text-sm font-semibold hover:border-accent hover:text-accent disabled:opacity-50"
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
        className="w-full rounded-lg border border-line px-4 py-2.5 text-sm font-semibold hover:border-accent hover:text-accent disabled:opacity-50"
      >
        Send code
      </button>
    </form>
  );
}
