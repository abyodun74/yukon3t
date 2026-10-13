import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  resendEmailOtp,
  confirmEmailOtp,
  ensureFreshEmailOtp,
  switchToPhoneVerification,
} from "@/app/actions/password-auth";
import { readPendingVerification } from "@/lib/pending-verification";
import { SubmitButton } from "@/components/submit-button";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { PhoneNumberField } from "@/components/phone-number-field";
import { getRequestCountry } from "@/lib/request-country";
import { LanguagePicker } from "@/components/language-picker";
import { format, localeDirection } from "@/lib/i18n/locales";
import { getDictionary, getLocale } from "@/lib/i18n/server";

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ verified?: string; sent?: string; error?: string }>;
}) {
  const { verified, sent, error } = await searchParams;
  const locale = await getLocale();
  const t = await getDictionary();
  // The actions redirect back with an error code; this is the sentence for each, in the request's language.
  const errorMessages: Record<string, string> = { ...t.verifyEmail.errors, captcha: t.common.captchaFailed };
  const offlineMessage = t.shared.submitButton.offline;
  const picker = <LanguagePicker locale={locale} label={t.languagePicker.label} />;

  if (verified === "1") {
    return (
      <div lang={locale} dir={localeDirection(locale)} className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <h1 className="text-2xl font-semibold">{t.verifyEmail.confirmedTitle}</h1>
        <p className="mt-3 text-sm text-foreground-soft">{t.verifyEmail.confirmedBody}</p>
        <Link
          href="/sign-in"
          className="mt-6 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink"
        >
          {t.common.signIn}
        </Link>
        {picker}
      </div>
    );
  }

  const pending = await readPendingVerification();
  if (!pending) {
    return (
      <div lang={locale} dir={localeDirection(locale)} className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <h1 className="text-2xl font-semibold">{t.common.nothingToVerify}</h1>
        <p className="mt-3 text-sm text-foreground-soft">{t.verifyEmail.expiredBody}</p>
        <Link
          href="/sign-in"
          className="mt-6 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink"
        >
          {t.common.signIn}
        </Link>
        {picker}
      </div>
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: pending.userId },
    select: { email: true, emailVerified: true, emailOtpExpires: true },
  });
  if (!user) {
    return (
      <div lang={locale} dir={localeDirection(locale)} className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <h1 className="text-2xl font-semibold">{t.common.nothingToVerify}</h1>
        <Link href="/sign-in" className="mt-6 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink">
          {t.common.signIn}
        </Link>
        {picker}
      </div>
    );
  }

  if (user.emailVerified) {
    return (
      <div lang={locale} dir={localeDirection(locale)} className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <h1 className="text-2xl font-semibold">{t.common.alreadyVerified}</h1>
        <Link href="/sign-in" className="mt-6 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink">
          {t.common.signIn}
        </Link>
        {picker}
      </div>
    );
  }

  // If the account's been sitting here with no active code (never sent, or
  // expired since the last visit), fire off a fresh one automatically —
  // rather than making a stuck user click "resend" themselves.
  await ensureFreshEmailOtp();
  const defaultCountry = await getRequestCountry();

  return (
    <div lang={locale} dir={localeDirection(locale)} className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">{t.verifyEmail.title}</h1>
      <p className="mt-3 text-sm text-foreground-soft">{format(t.verifyEmail.body, { email: user.email })}</p>

      {error && (
        <p role="alert" className="mt-4 w-full rounded-lg bg-danger/10 px-4 py-2 text-center text-sm text-danger">
          {errorMessages[error] ?? t.common.somethingWentWrong}
        </p>
      )}
      {sent === "1" && !error && (
        <p role="status" className="mt-4 w-full rounded-lg bg-success/10 px-4 py-2 text-center text-sm text-success">
          {t.common.newCodeSent}
        </p>
      )}

      <form action={confirmEmailOtp} className="mt-6 w-full space-y-3">
        <label htmlFor="verify-email-code" className="sr-only">
          {t.common.codeLabel}
        </label>
        <input
          id="verify-email-code"
          name="code"
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="000000"
          dir="ltr"
          className="w-full rounded-lg border border-line bg-surface px-4 py-3 text-center text-lg tracking-[0.3em] outline-none focus:border-accent"
        />
        <SubmitButton
          label={t.verifyEmail.submit}
          pendingLabel={t.common.confirming}
          offlineMessage={offlineMessage}
          className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-ink"
        />
      </form>

      <form action={resendEmailOtp} className="mt-4">
        <TurnstileWidget locale={locale} waitMessage={t.shared.turnstile.wait} />
        <SubmitButton
          label={t.common.resendCode}
          pendingLabel={t.common.resending}
          offlineMessage={offlineMessage}
          className="rounded-lg border border-line px-4 py-2.5 text-sm font-medium hover:border-accent hover:text-accent"
        />
      </form>

      {/* Email delivery can be slow or blocked — never leave someone stuck waiting on it. */}
      <div className="mt-8 w-full border-t border-line pt-5 text-start">
        <p className="text-sm font-medium">{t.verifyEmail.slowTitle}</p>
        <p className="mt-1 text-xs text-foreground-soft">{t.verifyEmail.slowBody}</p>
        <form action={switchToPhoneVerification} className="mt-3 space-y-2">
          <label htmlFor="switch-phone" className="sr-only">
            {t.common.phoneLabel}
          </label>
          <PhoneNumberField
            id="switch-phone"
            defaultCountry={defaultCountry}
            locale={locale}
            labels={t.shared.phoneField}
          />
          <SubmitButton
            label={t.verifyEmail.usePhone}
            pendingLabel={t.common.switching}
            offlineMessage={offlineMessage}
            className="w-full rounded-lg border border-line px-4 py-2.5 text-sm font-medium hover:border-accent hover:text-accent"
          />
        </form>
      </div>

      {picker}
    </div>
  );
}
