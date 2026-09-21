import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  resendEmailOtp,
  confirmEmailOtp,
  ensureFreshEmailOtp,
  switchToPhoneVerification,
} from "@/app/actions/password-auth";
import { readPendingVerification } from "@/lib/pending-verification";
import { SubmitButton } from "@/components/submit-button";
import { TurnstileWidget } from "@/components/turnstile-widget";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_code: "That code didn't match — check it and try again.",
  expired: "That code expired — we've sent you a new one.",
  too_many_attempts: "Too many wrong attempts — we've sent you a new code.",
  rate_limited: "Too many attempts. Please wait a bit and try again.",
  invalid_phone: "Enter a valid phone number with country code (e.g. +14155551234).",
  phone_taken: "That phone number is already verified on another account.",
  captcha: "We couldn't complete the security check. Wait a moment and try again — if it keeps happening, turn off any content blocker or try another network.",
};

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ verified?: string; sent?: string; error?: string }>;
}) {
  const { verified, sent, error } = await searchParams;

  if (verified === "1") {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <h1 className="text-2xl font-semibold">Email confirmed</h1>
        <p className="mt-3 text-sm text-foreground-soft">
          Your email is verified. You can now sign in with your username and
          password.
        </p>
        <Link
          href="/sign-in"
          className="mt-6 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink"
        >
          Sign in
        </Link>
      </div>
    );
  }

  const pending = await readPendingVerification();
  if (!pending) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <h1 className="text-2xl font-semibold">Nothing to verify here</h1>
        <p className="mt-3 text-sm text-foreground-soft">
          This link has expired or was opened on a different device. Sign in
          and we&apos;ll help you finish verifying your account.
        </p>
        <Link
          href="/sign-in"
          className="mt-6 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink"
        >
          Sign in
        </Link>
      </div>
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: pending.userId },
    select: { email: true, emailVerified: true, emailOtpExpires: true },
  });
  if (!user) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <h1 className="text-2xl font-semibold">Nothing to verify here</h1>
        <Link href="/sign-in" className="mt-6 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink">
          Sign in
        </Link>
      </div>
    );
  }

  if (user.emailVerified) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <h1 className="text-2xl font-semibold">Already verified</h1>
        <Link href="/sign-in" className="mt-6 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink">
          Sign in
        </Link>
      </div>
    );
  }

  // If the account's been sitting here with no active code (never sent, or
  // expired since the last visit), fire off a fresh one automatically —
  // rather than making a stuck user click "resend" themselves.
  await ensureFreshEmailOtp(pending.userId, user.email, user.emailOtpExpires);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">Confirm your email</h1>
      <p className="mt-3 text-sm text-foreground-soft">
        Enter the 6-digit code we sent to {user.email}.
      </p>

      {error && (
        <p className="mt-4 w-full rounded-lg bg-danger/10 px-4 py-2 text-center text-sm text-danger">
          {ERROR_MESSAGES[error] ?? "Something went wrong — try again."}
        </p>
      )}
      {sent === "1" && !error && (
        <p className="mt-4 w-full rounded-lg bg-success/10 px-4 py-2 text-center text-sm text-success">
          A new code is on its way.
        </p>
      )}

      <form action={confirmEmailOtp} className="mt-6 w-full space-y-3">
        <label htmlFor="verify-email-code" className="sr-only">
          Verification code
        </label>
        <input
          id="verify-email-code"
          name="code"
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="000000"
          className="w-full rounded-lg border border-line bg-surface px-4 py-3 text-center text-lg tracking-[0.3em] outline-none focus:border-accent"
        />
        <SubmitButton
          label="Confirm email"
          pendingLabel="Confirming..."
          className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-ink"
        />
      </form>

      <form action={resendEmailOtp} className="mt-4">
        <TurnstileWidget />
        <SubmitButton
          label="Resend code"
          pendingLabel="Resending..."
          className="rounded-lg border border-line px-4 py-2.5 text-sm font-medium hover:border-accent hover:text-accent"
        />
      </form>

      {/* Email delivery can be slow or blocked — never leave someone stuck waiting on it. */}
      <div className="mt-8 w-full border-t border-line pt-5 text-left">
        <p className="text-sm font-medium">Email taking too long?</p>
        <p className="mt-1 text-xs text-foreground-soft">
          Verify with your phone number instead — we&apos;ll text you a code.
        </p>
        <form action={switchToPhoneVerification} className="mt-3 flex gap-2">
          <label htmlFor="switch-phone" className="sr-only">
            Phone number
          </label>
          <input
            id="switch-phone"
            type="tel"
            name="phone"
            required
            autoComplete="tel"
            placeholder="+14155551234"
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent"
          />
          <SubmitButton
            label="Use phone"
            pendingLabel="Switching..."
            className="shrink-0 rounded-lg border border-line px-4 py-2.5 text-sm font-medium hover:border-accent hover:text-accent"
          />
        </form>
      </div>
    </div>
  );
}
