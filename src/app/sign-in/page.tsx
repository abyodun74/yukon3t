import type { Metadata } from "next";
import Link from "next/link";
import { signIn } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/client-ip";
import { redirect } from "next/navigation";
import { loginWithPassword } from "@/app/actions/password-auth";
import { PasswordInput } from "@/components/password-input";
import { SubmitButton } from "@/components/submit-button";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { verifyTurnstile } from "@/lib/turnstile";

const title = "Sign In to YuKon3t";
const description =
  "Log in to YuKon3t to catch up on your Circles, messages, and Collab Boards. Don't have an account? Sign up free in seconds.";

export const metadata: Metadata = {
  title: { absolute: title },
  description,
  openGraph: {
    type: "website",
    url: "/sign-in",
    siteName: "YuKon3t",
    title,
    description,
    images: [{ url: "/icons/icon-512.png", width: 512, height: 512 }],
  },
  twitter: {
    card: "summary",
    title,
    description,
    images: ["/icons/icon-512.png"],
  },
};

async function sendMagicLink(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    redirect("/sign-in?error=invalid");
  }

  const ip = await getClientIp();
  // Each magic-link request is a real outbound email, so this is the form
  // most worth gating — a script rotating addresses would otherwise use it
  // to email-bomb strangers and burn the sender's reputation. Its own error
  // code so the message lands in this form's box, not the password one.
  if (!(await verifyTurnstile(formData, ip))) {
    redirect("/sign-in?error=magic_captcha");
  }
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
    case "rate_limited":
      return "Too many attempts. Please wait a few minutes and try again.";
    case "captcha":
      return "We couldn't complete the security check. Wait a moment and try again — if it keeps happening, turn off any content blocker or try another network.";
    case "locked":
      return "Too many failed attempts — this account is locked for 24 hours. Reset your password below to unlock it immediately.";
    default:
      return null;
  }
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reset?: string }>;
}) {
  const { error, reset } = await searchParams;
  const passwordError = passwordErrorMessage(error);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-16">
      <h1 className="font-display text-3xl font-semibold">Sign in to YuKon3t</h1>

      <Link
        href="/sign-up"
        className="mt-6 w-full rounded-lg border border-accent px-4 py-3 text-center text-sm font-semibold text-accent hover:bg-accent hover:text-accent-ink"
      >
        New here? Create account
      </Link>

      <div className="mt-8 w-full rounded-xl border border-line bg-surface p-5 shadow-[var(--shadow-sm)]">
        <h2 className="text-sm font-semibold">Username &amp; password</h2>

        {reset && !passwordError && (
          <p className="mt-3 rounded-lg bg-success/10 px-4 py-2 text-sm text-success">
            Password reset — sign in with your new password.
          </p>
        )}
        {passwordError && (
          <div className="mt-3 rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">
            {passwordError}
          </div>
        )}

        <form action={loginWithPassword} className="mt-3 space-y-3">
          <label htmlFor="identifier" className="sr-only">
            Username or email
          </label>
          <input
            id="identifier"
            type="text"
            name="identifier"
            required
            autoComplete="username"
            placeholder="Username or email"
            className="w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
          />
          <label htmlFor="password" className="sr-only">
            Password
          </label>
          <PasswordInput
            id="password"
            name="password"
            required
            autoComplete="current-password"
            placeholder="Password"
            className="w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
          />
          <TurnstileWidget />
          <SubmitButton
            label="Sign in"
            pendingLabel="Signing in..."
            className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink shadow-[var(--shadow-sm)] hover:-translate-y-0.5"
          />
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
        {error === "magic_captcha" && (
          <p className="mt-3 rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">
            We couldn&apos;t complete the security check. Wait a moment and try again — if it keeps
            happening, turn off any content blocker or try another network.
          </p>
        )}

        <form action={sendMagicLink} className="mt-3 space-y-3">
          <label htmlFor="magic-link-email" className="sr-only">
            Email address
          </label>
          <input
            id="magic-link-email"
            type="email"
            name="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            className="w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
          />
          <TurnstileWidget />
          <SubmitButton
            label="Send sign-in link"
            pendingLabel="Sending..."
            className="w-full rounded-lg border border-line px-4 py-2.5 text-sm font-semibold hover:border-accent hover:text-accent"
          />
        </form>
      </div>
    </div>
  );
}
