import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { resendVerificationEmail, confirmEmailVerification } from "@/app/actions/password-auth";

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; email?: string; verified?: string }>;
}) {
  const { token, email, verified } = await searchParams;

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

  // Read-only check: merely looking at this page must never consume the
  // token (see confirmEmailVerification) — email clients and security
  // scanners routinely pre-fetch links in incoming mail.
  let tokenValid = false;
  if (token && email) {
    const record = await prisma.verificationToken.findUnique({
      where: { identifier_token: { identifier: email, token } },
    });
    tokenValid = Boolean(record && record.expires > new Date());
  }

  if (tokenValid && token && email) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <h1 className="text-2xl font-semibold">Confirm your email</h1>
        <p className="mt-3 text-sm text-foreground-soft">
          Click below to finish verifying {email}.
        </p>
        <form action={confirmEmailVerification} className="mt-6">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="email" value={email} />
          <button
            type="submit"
            className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink"
          >
            Confirm email
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">Link expired or invalid</h1>
      <p className="mt-3 text-sm text-foreground-soft">
        This confirmation link has already been used or has expired.
      </p>
      {email && (
        <form action={resendVerificationEmail} className="mt-6">
          <input type="hidden" name="email" value={email} />
          <button
            type="submit"
            className="rounded-lg border border-line px-4 py-2.5 text-sm font-medium hover:border-accent hover:text-accent"
          >
            Send a new link
          </button>
        </form>
      )}
    </div>
  );
}
