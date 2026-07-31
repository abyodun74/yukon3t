import Link from "next/link";
import { requestPasswordReset } from "@/app/actions/password-auth";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  const { error, sent } = await searchParams;

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-16">
      <h1 className="text-2xl font-semibold">Reset your password</h1>
      <p className="mt-2 text-center text-sm text-foreground-soft">
        Enter the email on your account and we&apos;ll send you a link to
        reset your password.
      </p>

      {sent && (
        <p className="mt-4 w-full rounded-lg bg-success/10 px-4 py-2 text-center text-sm text-success">
          If that email is registered, a reset link is on its way — check
          your inbox.
        </p>
      )}
      {error === "invalid" && (
        <p className="mt-4 w-full rounded-lg bg-danger/10 px-4 py-2 text-center text-sm text-danger">
          Enter a valid email address.
        </p>
      )}
      {error === "expired" && (
        <p className="mt-4 w-full rounded-lg bg-danger/10 px-4 py-2 text-center text-sm text-danger">
          That reset link expired or was already used — request a new one below.
        </p>
      )}

      <form action={requestPasswordReset} className="mt-6 w-full space-y-3">
        <input
          type="email"
          name="email"
          required
          placeholder="you@example.com"
          className="w-full rounded-lg border border-line bg-surface px-4 py-3 text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-ink"
        >
          Send reset link
        </button>
      </form>

      <p className="mt-6 text-sm text-foreground-soft">
        <Link href="/sign-in" className="font-medium text-accent hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
