import Link from "next/link";
import { confirmLoginDeviceChallenge, resendLoginDeviceChallenge } from "@/app/actions/password-auth";
import { readPendingDeviceChallengeCookie } from "@/lib/device-challenge";
import { SubmitButton } from "@/components/submit-button";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { LanguagePicker } from "@/components/language-picker";
import { getDictionary, getLocale } from "@/lib/i18n/server";

export default async function VerifyDevicePage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const { sent, error } = await searchParams;
  const locale = await getLocale();
  const t = await getDictionary();
  // The actions redirect back with an error code; this is the sentence for each, in the request's language.
  const errorMessages: Record<string, string> = { ...t.verifyDevice.errors, captcha: t.common.captchaFailed };
  const turnstile = { locale, waitMessage: t.shared.turnstile.wait };
  const offlineMessage = t.shared.submitButton.offline;
  const picker = <LanguagePicker locale={locale} label={t.languagePicker.label} />;

  const pending = await readPendingDeviceChallengeCookie();
  if (!pending) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <h1 className="text-2xl font-semibold">{t.common.nothingToVerify}</h1>
        <p className="mt-3 text-sm text-foreground-soft">{t.verifyDevice.expiredBody}</p>
        <Link href="/sign-in" className="mt-6 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink">
          {t.common.signIn}
        </Link>
        {picker}
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">{t.verifyDevice.title}</h1>
      <p className="mt-3 text-sm text-foreground-soft">{t.verifyDevice.body}</p>

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

      <form action={confirmLoginDeviceChallenge} className="mt-6 w-full space-y-3">
        <label htmlFor="verify-device-code" className="sr-only">
          {t.common.codeLabel}
        </label>
        <input
          id="verify-device-code"
          name="code"
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="000000"
          dir="ltr"
          className="w-full rounded-lg border border-line bg-surface px-4 py-3 text-center text-lg tracking-[0.3em] outline-none focus:border-accent"
        />
        <TurnstileWidget {...turnstile} />
        <SubmitButton
          label={t.verifyDevice.submit}
          pendingLabel={t.common.confirming}
          offlineMessage={offlineMessage}
          className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-ink"
        />
      </form>

      <form action={resendLoginDeviceChallenge} className="mt-4">
        <TurnstileWidget {...turnstile} />
        <SubmitButton
          label={t.common.resendCode}
          pendingLabel={t.common.resending}
          offlineMessage={offlineMessage}
          className="rounded-lg border border-line px-4 py-2.5 text-sm font-medium hover:border-accent hover:text-accent"
        />
      </form>

      <Link href="/sign-in" className="mt-6 text-xs text-foreground-soft hover:text-accent">
        {t.verifyDevice.cancel}
      </Link>
      {picker}
    </div>
  );
}
