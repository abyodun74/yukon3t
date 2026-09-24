import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { signUpWithPassword } from "@/app/actions/password-auth";
import { PasswordInput } from "@/components/password-input";
import { SubmitButton } from "@/components/submit-button";
import { BirthDateSelect } from "@/components/birth-date-select";
import { BotProtectionFields } from "@/components/bot-protection-fields";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { VerifyMethodFields } from "@/components/verify-method-fields";
import { MIN_AGE } from "@/lib/validations";
import { isAppleSignInConfigured } from "@/lib/apple-client-secret";
import { AppleSignInButton } from "@/components/apple-sign-in-button";
import { IosAppOnly } from "@/components/ios-app-only";
import { isLikelyIosAppUserAgent } from "@/lib/ios-app";

const title = "Sign Up for YuKon3t — Join Free, Verified Communities";
const description =
  "Create your free YuKon3t account in minutes. Verify by email, join Circles that match your interests, and start real global connections today.";

export const metadata: Metadata = {
  title: { absolute: title },
  description,
  openGraph: {
    type: "website",
    url: "/sign-up",
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

function errorMessage(error: string | undefined) {
  switch (error) {
    case "underage":
      return "You must be at least 13 years old to use YuKon3t.";
    case "email_taken":
      return "An account with that email already exists.";
    case "username_taken":
      return "That username is taken — try another.";
    case "invalid_username":
      return "Usernames are 3–20 characters: letters, numbers and underscores only.";
    case "invalid_phone":
      return "Enter a valid phone number with country code (e.g. +14155551234).";
    case "phone_taken":
      return "That phone number is already verified on another account.";
    case "rate_limited":
      return "Too many attempts. Please wait a bit and try again.";
    case "captcha":
      return "We couldn't complete the security check. Wait a moment and try again — if it keeps happening, turn off any content blocker or try another network.";
    case "invalid":
      return "Please check your inputs — password must be at least 8 characters.";
    default:
      return null;
  }
}

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; username?: string; email?: string; phone?: string; method?: string }>;
}) {
  const { error, username, email, phone, method } = await searchParams;
  const message = errorMessage(error);
  const userAgent = (await headers()).get("user-agent");

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-16">
      <h1 className="text-2xl font-semibold">Create an account</h1>
      <p className="mt-2 text-center text-sm text-foreground-soft">
        Choose a username and password, then confirm your account with a
        code we send by email or text before you can sign in.
      </p>

      {message && (
        <p className="mt-4 w-full rounded-lg bg-danger/10 px-4 py-2 text-center text-sm text-danger">
          {message}
        </p>
      )}

      {isAppleSignInConfigured() && (
        <IosAppOnly shownOnServer={isLikelyIosAppUserAgent(userAgent)}>
          <AppleSignInButton showCaptchaError={error === "apple_captcha"} returnPath="/sign-up" />
          <div className="my-6 flex w-full items-center gap-3 text-xs text-foreground-soft">
            <div className="h-px flex-1 bg-line" />
            or create an account with a password
            <div className="h-px flex-1 bg-line" />
          </div>
        </IosAppOnly>
      )}

      <form action={signUpWithPassword} className="mt-6 w-full space-y-3">
        <BotProtectionFields />
        <label htmlFor="signup-username" className="sr-only">
          Username
        </label>
        <input
          id="signup-username"
          type="text"
          name="username"
          required
          minLength={3}
          maxLength={20}
          pattern="[A-Za-z0-9_]+"
          title="Letters, numbers and underscores only"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          defaultValue={username ?? ""}
          placeholder="Username (3–20 letters, numbers, _)"
          className="w-full rounded-lg border border-line bg-surface px-4 py-3 text-sm outline-none focus:border-accent"
        />
        <label htmlFor="signup-email" className="sr-only">
          Email address
        </label>
        <input
          id="signup-email"
          type="email"
          name="email"
          required
          autoComplete="email"
          defaultValue={email ?? ""}
          placeholder="you@example.com"
          className="w-full rounded-lg border border-line bg-surface px-4 py-3 text-sm outline-none focus:border-accent"
        />
        <label htmlFor="signup-password" className="sr-only">
          Password
        </label>
        <PasswordInput
          id="signup-password"
          name="password"
          required
          minLength={8}
          maxLength={72}
          autoComplete="new-password"
          placeholder="Password (min. 8 characters)"
          className="w-full rounded-lg border border-line bg-surface px-4 py-3 text-sm outline-none focus:border-accent"
        />
        <div>
          <label className="block text-xs font-medium text-foreground-soft">
            Date of birth
          </label>
          <div className="mt-1">
            <BirthDateSelect minAge={MIN_AGE} />
          </div>
          <p className="mt-1 text-xs text-foreground-soft">
            You must be at least 13 to use YuKon3t.
          </p>
        </div>
        <VerifyMethodFields defaultMethod={method === "PHONE" ? "PHONE" : "EMAIL"} defaultPhone={phone ?? ""} />
        <TurnstileWidget />
        <SubmitButton
          label="Create account"
          pendingLabel="Creating account..."
          className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-ink"
        />
      </form>

      <p className="mt-6 text-sm text-foreground-soft">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
