import Link from "next/link";
import { requireUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { confirmPasswordChangeDeviceChallenge, resendPasswordChangeDeviceChallenge } from "@/app/actions/profile";
import { SubmitButton } from "@/components/submit-button";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { getDictionary, getLocale } from "@/lib/i18n/server";

export default async function VerifyDeviceSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ challengeId?: string; sent?: string; error?: string }>;
}) {
  const user = await requireUser();
  const { challengeId, sent, error } = await searchParams;
  const locale = await getLocale();
  const dictionary = await getDictionary();
  const t = dictionary.settings.verifyDevice;
  // The same codes, and the same wording, as the sign-in code screen.
  const errorMessages: Record<string, string> = {
    ...dictionary.verifyDevice.errors,
    captcha: dictionary.common.captchaFailed,
    captcha_unavailable: dictionary.common.captchaUnavailable,
  };
  const turnstile = { locale, strings: dictionary.shared.turnstile };
  const offlineMessage = dictionary.shared.submitButton.offline;

  const challenge = challengeId
    ? await prisma.securityChallenge.findUnique({ where: { id: challengeId }, select: { id: true, userId: true, purpose: true, consumedAt: true } })
    : null;
  const valid = challenge && challenge.userId === user.id && challenge.purpose === "PASSWORD_CHANGE" && !challenge.consumedAt;

  if (!valid) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <h1 className="text-2xl font-semibold">{dictionary.common.nothingToVerify}</h1>
        <p className="mt-3 text-sm text-foreground-soft">{t.usedBody}</p>
        <Link href="/settings" className="mt-6 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink">
          {t.backToSettings}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">{dictionary.verifyDevice.title}</h1>
      <p className="mt-3 text-sm text-foreground-soft">{t.body}</p>

      {error && (
        <p role="alert" className="mt-4 w-full rounded-lg bg-danger/10 px-4 py-2 text-center text-sm text-danger">
          {errorMessages[error] ?? dictionary.common.somethingWentWrong}
        </p>
      )}
      {sent === "1" && !error && (
        <p role="status" className="mt-4 w-full rounded-lg bg-success/10 px-4 py-2 text-center text-sm text-success">
          {dictionary.common.newCodeSent}
        </p>
      )}

      <form action={confirmPasswordChangeDeviceChallenge} className="mt-6 w-full space-y-3">
        <input type="hidden" name="challengeId" value={challenge.id} />
        <label htmlFor="verify-device-code" className="sr-only">
          {dictionary.common.codeLabel}
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
          label={t.submit}
          pendingLabel={dictionary.common.confirming}
          offlineMessage={offlineMessage}
          className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-ink"
        />
      </form>

      <form action={resendPasswordChangeDeviceChallenge} className="mt-4">
        <input type="hidden" name="challengeId" value={challenge.id} />
        <TurnstileWidget {...turnstile} />
        <SubmitButton
          label={dictionary.common.resendCode}
          pendingLabel={dictionary.common.resending}
          offlineMessage={offlineMessage}
          className="rounded-lg border border-line px-4 py-2.5 text-sm font-medium hover:border-accent hover:text-accent"
        />
      </form>

      <Link href="/settings" className="mt-6 text-xs text-foreground-soft hover:text-accent">
        {t.cancel}
      </Link>
    </div>
  );
}
