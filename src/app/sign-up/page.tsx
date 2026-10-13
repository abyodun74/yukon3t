import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { BotProtectionFields } from "@/components/bot-protection-fields";
import { SignUpForm } from "@/components/sign-up-form";
import { countryFromGeoHeaders } from "@/lib/request-country";
import { isAppleSignInConfigured } from "@/lib/apple-client-secret";
import { AppleSignInButton } from "@/components/apple-sign-in-button";
import { isIosUserAgent } from "@/lib/ios-app";
import { getDictionary, getLocale } from "@/lib/i18n/server";

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
  const locale = await getLocale();
  const t = await getDictionary();

  return (
    <div lang={locale} className="mx-auto flex max-w-md flex-col items-center px-4 py-16">
      <h1 className="text-2xl font-semibold">{t.signUp.title}</h1>
      <p className="mt-2 text-center text-sm text-foreground-soft">{t.signUp.intro}</p>

      {isAppleSignInConfigured() && isIosUserAgent(userAgent) && (
        <>
          <AppleSignInButton showCaptchaError={error === "apple_captcha"} returnPath="/sign-up" />
          <div className="my-6 flex w-full items-center gap-3 text-xs text-foreground-soft">
            <div className="h-px flex-1 bg-line" />
            {t.signUp.appleDivider}
            <div className="h-px flex-1 bg-line" />
          </div>
        </>
      )}

      <SignUpForm
        defaultCountry={countryFromGeoHeaders((name) => requestHeaders.get(name))}
        botProtection={<BotProtectionFields />}
        locale={locale}
        t={t.signUp.form}
        shared={t.shared}
      />

      <p className="mt-6 text-sm text-foreground-soft">
        {t.signUp.haveAccount}{" "}
        <Link href="/sign-in" className="font-medium text-accent hover:underline">
          {t.common.signIn}
        </Link>
      </p>
    </div>
  );
}
