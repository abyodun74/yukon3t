import Link from "next/link";
import { requestPasswordReset } from "@/app/actions/password-auth";
import { SubmitButton } from "@/components/submit-button";
import { BotProtectionFields } from "@/components/bot-protection-fields";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { LanguagePicker } from "@/components/language-picker";
import { localeDirection } from "@/lib/i18n/locales";
import { getDictionary, getLocale } from "@/lib/i18n/server";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  const { error, sent } = await searchParams;
  const locale = await getLocale();
  const t = await getDictionary();

  return (
    <div lang={locale} dir={localeDirection(locale)} className="mx-auto flex max-w-md flex-col items-center px-4 py-16">
      <h1 className="text-2xl font-semibold">{t.forgotPassword.title}</h1>
      <p className="mt-2 text-center text-sm text-foreground-soft">{t.forgotPassword.intro}</p>

      {sent && (
        <p role="status" className="mt-4 w-full rounded-lg bg-success/10 px-4 py-2 text-center text-sm text-success">
          {t.forgotPassword.sent}
        </p>
      )}
      {error === "invalid" && (
        <p role="alert" className="mt-4 w-full rounded-lg bg-danger/10 px-4 py-2 text-center text-sm text-danger">
          {t.common.invalidEmail}
        </p>
      )}
      {error === "captcha" && (
        <p role="alert" className="mt-4 w-full rounded-lg bg-danger/10 px-4 py-2 text-center text-sm text-danger">
          {t.common.captchaFailed}
        </p>
      )}
      {error === "expired" && (
        <p role="alert" className="mt-4 w-full rounded-lg bg-danger/10 px-4 py-2 text-center text-sm text-danger">
          {t.forgotPassword.expired}
        </p>
      )}

      <form action={requestPasswordReset} className="mt-6 w-full space-y-3">
        <BotProtectionFields />
        <label htmlFor="forgot-password-email" className="sr-only">
          {t.common.emailLabel}
        </label>
        <input
          id="forgot-password-email"
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder={t.common.emailPlaceholder}
          className="w-full rounded-lg border border-line bg-surface px-4 py-3 text-sm ltr-value outline-none focus:border-accent"
        />
        <TurnstileWidget locale={locale} waitMessage={t.shared.turnstile.wait} />
        <SubmitButton
          label={t.forgotPassword.submit}
          pendingLabel={t.common.sending}
          offlineMessage={t.shared.submitButton.offline}
          className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-ink"
        />
      </form>

      <p className="mt-6 text-sm text-foreground-soft">
        <Link href="/sign-in" className="font-medium text-accent hover:underline">
          {t.forgotPassword.back}
        </Link>
      </p>

      <LanguagePicker locale={locale} label={t.languagePicker.label} />
    </div>
  );
}
