import Link from "next/link";
import { confirmLoginDeviceChallenge, resendLoginDeviceChallenge } from "@/app/actions/password-auth";
import { readPendingDeviceChallengeCookie } from "@/lib/device-challenge";
import { SubmitButton } from "@/components/submit-button";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_code: "That code didn't match — check it and try again.",
  expired: "That code expired — request a new one below.",
  too_many_attempts: "Too many wrong attempts — request a new code below.",
  not_found: "That verification link is no longer valid — request a new code below.",
  rate_limited: "Too many attempts. Please wait a bit and try again.",
};

export default async function VerifyDevicePage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const { sent, error } = await searchParams;

  const pending = await readPendingDeviceChallengeCookie();
  if (!pending) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <h1 className="text-2xl font-semibold">Nothing to verify here</h1>
        <p className="mt-3 text-sm text-foreground-soft">
          This link has expired or was opened on a different device. Sign in
          again to continue.
        </p>
        <Link href="/sign-in" className="mt-6 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">We don&apos;t recognize this device</h1>
      <p className="mt-3 text-sm text-foreground-soft">
        For your security, enter the 6-digit code we just emailed you to finish signing in. If this wasn&apos;t you,
        just ignore it — your account is safe.
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

      <form action={confirmLoginDeviceChallenge} className="mt-6 w-full space-y-3">
        <label htmlFor="verify-device-code" className="sr-only">
          Verification code
        </label>
        <input
          id="verify-device-code"
          name="code"
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="000000"
          className="w-full rounded-lg border border-line bg-surface px-4 py-3 text-center text-lg tracking-[0.3em] outline-none focus:border-accent"
        />
        <SubmitButton
          label="Confirm and sign in"
          pendingLabel="Confirming..."
          className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-ink"
        />
      </form>

      <form action={resendLoginDeviceChallenge} className="mt-4">
        <SubmitButton
          label="Resend code"
          pendingLabel="Resending..."
          className="rounded-lg border border-line px-4 py-2.5 text-sm font-medium hover:border-accent hover:text-accent"
        />
      </form>

      <Link href="/sign-in" className="mt-6 text-xs text-foreground-soft hover:text-accent">
        Cancel and go back
      </Link>
    </div>
  );
}
