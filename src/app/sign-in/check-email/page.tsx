import Link from "next/link";
import { headers } from "next/headers";
import { NativeAppSwitch } from "@/components/native-app-switch";
import { isLikelyIosAppUserAgent } from "@/lib/ios-app";
import { LanguagePicker } from "@/components/language-picker";
import { getDictionary, getLocale } from "@/lib/i18n/server";

export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ context?: string }>;
}) {
  const { context } = await searchParams;
  const isVerify = context === "verify";
  const locale = await getLocale();
  const t = await getDictionary();
  const userAgent = (await headers()).get("user-agent");

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">{t.checkEmail.title}</h1>
      <p className="mt-3 text-sm text-foreground-soft">
        {isVerify ? t.checkEmail.verifyBody : t.checkEmail.linkBody}
      </p>
      {isVerify ? (
        <Link
          href="/verify-email"
          className="mt-6 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink"
        >
          {t.checkEmail.enterCode}
        </Link>
      ) : (
        // In the app there is no tab to close: say where the emailed link leads and what to do if it opens the browser.
        <NativeAppSwitch
          appOnServer={isLikelyIosAppUserAgent(userAgent)}
          app={<p className="mt-3 text-sm text-foreground-soft">{t.appLinks.checkEmailInApp}</p>}
          web={<p className="mt-3 text-sm text-foreground-soft">{t.checkEmail.closeTab}</p>}
        />
      )}
      <LanguagePicker locale={locale} label={t.languagePicker.label} />
    </div>
  );
}
