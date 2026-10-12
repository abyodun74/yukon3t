import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { BotProtectionFields } from "@/components/bot-protection-fields";
import { SignUpForm } from "@/components/sign-up-form";
import { countryFromGeoHeaders } from "@/lib/request-country";
import { isAppleSignInConfigured } from "@/lib/apple-client-secret";
import { AppleSignInButton } from "@/components/apple-sign-in-button";
import { isIosUserAgent } from "@/lib/ios-app";

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

// The only thing still sent here in the URL is ?error=apple_captcha (actions/apple-auth.ts). The password form's own
// errors come back through its action's state (SignUpForm), never as a redirect.
export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const requestHeaders = await headers();
  const userAgent = requestHeaders.get("user-agent");

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-16">
      <h1 className="text-2xl font-semibold">Create an account</h1>
      <p className="mt-2 text-center text-sm text-foreground-soft">
        Choose a username, enter your email and your desired password, then
        confirm your account with a code we send by email or text before
        you can sign in.
      </p>

      {isAppleSignInConfigured() && isIosUserAgent(userAgent) && (
        <>
          <AppleSignInButton showCaptchaError={error === "apple_captcha"} returnPath="/sign-up" />
          <div className="my-6 flex w-full items-center gap-3 text-xs text-foreground-soft">
            <div className="h-px flex-1 bg-line" />
            or create an account with a password
            <div className="h-px flex-1 bg-line" />
          </div>
        </>
      )}

      <SignUpForm
        defaultCountry={countryFromGeoHeaders((name) => requestHeaders.get(name))}
        botProtection={<BotProtectionFields />}
      />

      <p className="mt-6 text-sm text-foreground-soft">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
