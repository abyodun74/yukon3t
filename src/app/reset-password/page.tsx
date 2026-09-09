import Link from "next/link";
import { resetPassword } from "@/app/actions/password-auth";
import { PasswordInput } from "@/components/password-input";
import { SubmitButton } from "@/components/submit-button";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;

  if (!token) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-16">
        <h1 className="text-2xl font-semibold">Invalid reset link</h1>
        <p className="mt-2 text-center text-sm text-foreground-soft">
          This password reset link is missing its token.
        </p>
        <Link href="/forgot-password" className="mt-4 font-medium text-accent hover:underline">
          Request a new link
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-16">
      <h1 className="text-2xl font-semibold">Choose a new password</h1>

      {error === "invalid" && (
        <p className="mt-4 w-full rounded-lg bg-danger/10 px-4 py-2 text-center text-sm text-danger">
          Password must be at least 8 characters.
        </p>
      )}

      <form action={resetPassword} className="mt-6 w-full space-y-3">
        <input type="hidden" name="token" value={token} />
        <label htmlFor="reset-password-new" className="sr-only">
          New password
        </label>
        <PasswordInput
          id="reset-password-new"
          name="password"
          required
          minLength={8}
          maxLength={72}
          autoComplete="new-password"
          placeholder="New password (min. 8 characters)"
          className="w-full rounded-lg border border-line bg-surface px-4 py-3 text-sm outline-none focus:border-accent"
        />
        <SubmitButton
          label="Reset password"
          pendingLabel="Resetting..."
          className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-ink"
        />
      </form>
    </div>
  );
}
