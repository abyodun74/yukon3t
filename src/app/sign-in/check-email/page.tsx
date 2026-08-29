import Link from "next/link";

export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ context?: string }>;
}) {
  const { context } = await searchParams;
  const isVerify = context === "verify";

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">Check your email</h1>
      <p className="mt-3 text-sm text-foreground-soft">
        {isVerify
          ? "If an account with that email needs verifying, we've sent it a 6-digit code. It expires in 10 minutes."
          : "We sent you a secure sign-in link. It expires shortly, so use it soon."}
      </p>
      {isVerify ? (
        <Link
          href="/verify-email"
          className="mt-6 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink"
        >
          Enter code
        </Link>
      ) : (
        <p className="mt-3 text-sm text-foreground-soft">You can close this tab.</p>
      )}
    </div>
  );
}
