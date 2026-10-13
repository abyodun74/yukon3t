import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { signIn } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/client-ip";
import { redirect } from "next/navigation";
import { loginWithPassword } from "@/app/actions/password-auth";
import { PasswordInput } from "@/components/password-input";
import { SubmitButton } from "@/components/submit-button";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { verifyTurnstile } from "@/lib/turnstile";
import { isAppleSignInConfigured } from "@/lib/apple-client-secret";
import { AppleSignInButton } from "@/components/apple-sign-in-button";
import { isIosUserAgent } from "@/lib/ios-app";
import { getDictionary, getLocale } from "@/lib/i18n/server";

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

// The actions only ever redirect back with an error code; the sentence for it comes from the request's dictionary.
function passwordErrorMessage(error: string | undefined, t: Awaited<ReturnType<typeof getDictionary>>) {
  switch (error) {
    case "invalid_credentials":
      return t.signIn.errors.invalid_credentials;
    case "rate_limited":
      return t.signIn.errors.rate_limited;
    case "captcha":
      return t.common.captchaFailed;
    case "locked":
      return t.signIn.errors.locked;
    default:
      return null;
  }
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reset?: string; notice?: string }>;
}) {
  const { error, reset, notice } = await searchParams;
  const locale = await getLocale();
  const t = await getDictionary();
  const passwordError = passwordErrorMessage(error, t);
  const userAgent = (await headers()).get("user-agent");
  const turnstile = { locale, waitMessage: t.shared.turnstile.wait };
  const offlineMessage = t.shared.submitButton.offline;

  return (
    <div lang={locale} className="mx-auto flex max-w-md flex-col items-center px-4 py-16">
      <h1 className="font-display text-3xl font-semibold">{t.signIn.title}</h1>

      {isAppleSignInConfigured() && isIosUserAgent(userAgent) && (
        <AppleSignInButton showCaptchaError={error === "apple_captcha"} />
      )}

      <div className="mt-6 w-full rounded-xl border border-line bg-surface p-5 shadow-[var(--shadow-sm)]">
        <h2 className="text-sm font-semibold">{t.signIn.passwordHeading}</h2>

        {reset && !passwordError && (
          <p role="status" className="mt-3 rounded-lg bg-success/10 px-4 py-2 text-sm text-success">
            {t.signIn.resetDone}
          </p>
        )}
        {notice === "reset_required" && !passwordError && (
          <p role="status" className="mt-3 rounded-lg bg-accent-soft px-4 py-2 text-sm">
            {t.signIn.resetRequired}
          </p>
        )}
        {passwordError && (
          <div role="alert" className="mt-3 rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">
            {passwordError}
          </div>
        )}

        <form action={loginWithPassword} className="mt-3 space-y-3">
          <label htmlFor="identifier" className="sr-only">
            {t.signIn.identifier}
          </label>
          <input
            id="identifier"
            type="text"
            name="identifier"
            required
            autoComplete="username"
            placeholder={t.signIn.identifier}
            className="w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
          />
          <label htmlFor="password" className="sr-only">
            {t.signIn.password}
          </label>
          <PasswordInput
            id="password"
            name="password"
            required
            autoComplete="current-password"
            placeholder={t.signIn.password}
            className="w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
            labels={t.shared.passwordInput}
          />
          <TurnstileWidget appearance="always" className="flex justify-center" {...turnstile} />
          <SubmitButton
            label={t.signIn.submit}
            pendingLabel={t.signIn.submitting}
            offlineMessage={offlineMessage}
            className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink shadow-[var(--shadow-sm)] hover:-translate-y-0.5"
          />
        </form>
        <p className="mt-3 text-xs">
          <Link href="/forgot-password" className="font-medium text-accent hover:underline">
            {t.signIn.forgotPassword}
          </Link>
        </p>
      </div>

      <div className="my-6 flex w-full items-center gap-3 text-xs text-foreground-soft">
        <div className="h-px flex-1 bg-line" />
        {t.signIn.or}
        <div className="h-px flex-1 bg-line" />
      </div>

      <div className="w-full rounded-xl border border-line bg-surface p-5 shadow-[var(--shadow-sm)]">
        <h2 className="text-sm font-semibold">{t.signIn.magicHeading}</h2>
        <p className="mt-1 text-sm text-foreground-soft">
          {t.signIn.magicIntro}
        </p>

        {error === "rate_limited" && !passwordError && (
          <p role="alert" className="mt-3 rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">
            {t.signIn.errors.rate_limited}
          </p>
        )}
        {error === "invalid" && (
          <p role="alert" className="mt-3 rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">
            {t.common.invalidEmail}
          </p>
        )}
        {error === "magic_captcha" && (
          <p role="alert" className="mt-3 rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">
            {t.common.captchaFailed}
          </p>
        )}

        <form action={sendMagicLink} className="mt-3 space-y-3">
          <label htmlFor="magic-link-email" className="sr-only">
            {t.common.emailLabel}
          </label>
          <input
            id="magic-link-email"
            type="email"
            name="email"
            required
            autoComplete="email"
            placeholder={t.common.emailPlaceholder}
            className="w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
          />
          <TurnstileWidget appearance="always" className="flex justify-center" {...turnstile} />
          <SubmitButton
            label={t.signIn.magicSubmit}
            pendingLabel={t.common.sending}
            offlineMessage={offlineMessage}
            className="w-full rounded-lg border border-line px-4 py-2.5 text-sm font-semibold hover:border-accent hover:text-accent"
          />
        </form>
      </div>
    </div>
  );
}
