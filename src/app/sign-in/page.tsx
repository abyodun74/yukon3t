import Link from "next/link";
import { signIn } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/client-ip";
import { redirect } from "next/navigation";
import { loginWithPassword, resendVerificationEmail } from "@/app/actions/password-auth";
import { PasswordInput } from "@/components/password-input";

async function sendMagicLink(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    redirect("/sign-in?error=invalid");
  }

  const ip = await getClientIp();
  const allowed = await checkRateLimit("signIn", `signin:${ip}:${email}`);
  if (!allowed) {
    redirect("/sign-in?error=rate_limited");
  }

  await signIn("resend", { email, redirectTo: "/home" });
}

function passwordErrorMessage(error: string | undefined) {
  switch (error) {
    case "invalid_credentials":
      return "Incorrect username/email or password.";
    case "unverified":
      return "Confirm your email before signing in — check your inbox.";
    case "rate_limited":
      return "Too many attempts. Please wait a few minutes and try again.";
    case "locked":
      return "Too many failed attempts — this account is locked for 24 hours. Reset your password below to unlock it immediately.";
    default:
      return null;
  }
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; email?: string; reset?: string }>;
}) {
  const { error, email, reset } = await searchParams;
  const passwordError = passwordErrorMessage(error);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-16">
      <h1 className="font-display text-3xl font-semibold">Sign in to YuKon3t</h1>

      <div className="mt-8 w-full rounded-xl border border-line bg-surface p-5 shadow-[var(--shadow-sm)]">
        <h2 className="text-sm font-semibold">Username &amp; password</h2>

        {reset && !passwordError && (
          <p className="mt-3 rounded-lg bg-success/10 px-4 py-2 text-sm text-success">
            Password reset — sign in with your new password.
          </p>
        )}
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
          <PasswordInput
            name="password"
            required
            placeholder="Password"
            className="w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
          />
          <button
            type="submit"
            className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink shadow-[var(--shadow-sm)] hover:-translate-y-0.5"
          >
            Sign in
          </button>
        </form>
        <p className="mt-3 flex items-center justify-between text-xs text-foreground-soft">
          <Link href="/forgot-password" className="font-medium text-accent hover:underline">
            Forgot password?
          </Link>
          <span>
            No account?{" "}
            <Link href="/sign-up" className="font-medium text-accent hover:underline">
              Create one
            </Link>
          </span>
        </p>
      </div>

      <div className="my-6 flex w-full items-center gap-3 text-xs text-foreground-soft">
        <div className="h-px flex-1 bg-line" />
        or
        <div className="h-px flex-1 bg-line" />
      </div>

      <div className="w-full rounded-xl border border-line bg-surface p-5 shadow-[var(--shadow-sm)]">
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
