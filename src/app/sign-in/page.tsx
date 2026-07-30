import Link from "next/link";
import { signIn } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { loginWithPassword, resendVerificationEmail } from "@/app/actions/password-auth";

async function sendMagicLink(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    redirect("/sign-in?error=invalid");
  }

  const ip = (await headers()).get("x-forwarded-for") ?? "unknown";
  const allowed = await checkRateLimit("signIn", `signin:${ip}:${email}`);
  if (!allowed) {
    redirect("/sign-in?error=rate_limited");
  }

  await signIn("resend", { email, redirectTo: "/discover" });
}

function passwordErrorMessage(error: string | undefined) {
  switch (error) {
    case "invalid_credentials":
      return "Incorrect username/email or password.";
    case "unverified":
      return "Confirm your email before signing in — check your inbox.";
    case "rate_limited":
      return "Too many attempts. Please wait a few minutes and try again.";
    default:
      return null;
  }
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; email?: string }>;
}) {
  const { error, email } = await searchParams;
  const passwordError = passwordErrorMessage(error);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-16">
      <h1 className="text-2xl font-semibold">Sign in to YuKon3t</h1>

      <div className="mt-8 w-full rounded-xl border border-line p-5">
        <h2 className="text-sm font-semibold">Username &amp; password</h2>

        {passwordError && (
          <p className="mt-3 rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">
            {passwordError}
            {error === "unverified" && email && (
              <form action={resendVerificationEmail} className="mt-2">
                <input type="hidden" name="email" value={email} />
                <button type="submit" className="font-medium underline">
                  Resend confirmation email
                </button>
              </form>
            )}
          </p>
        )}

        <form action={loginWithPassword} className="mt-3 space-y-3">
          <input
            type="text"
            name="identifier"
            required
            placeholder="Username or email"
            className="w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
          />
          <input
            type="password"
            name="password"
            required
            placeholder="Password"
            className="w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
          />
          <button
            type="submit"
            className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink"
          >
            Sign in
          </button>
        </form>
        <p className="mt-3 text-center text-xs text-foreground-soft">
          No account?{" "}
          <Link href="/sign-up" className="font-medium text-accent hover:underline">
            Create one
          </Link>
        </p>
      </div>

      <div className="my-6 flex w-full items-center gap-3 text-xs text-foreground-soft">
        <div className="h-px flex-1 bg-line" />
        or
        <div className="h-px flex-1 bg-line" />
      </div>

      <div className="w-full rounded-xl border border-line p-5">
        <h2 className="text-sm font-semibold">Email link</h2>
        <p className="mt-1 text-sm text-foreground-soft">
          No password to leak or reuse — we&apos;ll email you a secure
          sign-in link instead.
        </p>

        {error === "rate_limited" && !passwordError && (
          <p className="mt-3 rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">
            Too many attempts. Please wait a few minutes and try again.
          </p>
        )}
        {error === "invalid" && (
          <p className="mt-3 rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">
            Enter a valid email address.
          </p>
        )}

        <form action={sendMagicLink} className="mt-3 space-y-3">
          <input
            type="email"
            name="email"
            required
            placeholder="you@example.com"
            className="w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
          />
          <button
            type="submit"
            className="w-full rounded-lg border border-line px-4 py-2.5 text-sm font-semibold hover:border-accent hover:text-accent"
          >
            Send sign-in link
          </button>
        </form>
      </div>
    </div>
  );
}
