import Link from "next/link";
import { resetPassword } from "@/app/actions/password-auth";
import { PasswordInput } from "@/components/password-input";
import { SubmitButton } from "@/components/submit-button";
import { LanguagePicker } from "@/components/language-picker";
import { getDictionary, getLocale } from "@/lib/i18n/server";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  const locale = await getLocale();
  const t = await getDictionary();
  const picker = <LanguagePicker locale={locale} label={t.languagePicker.label} />;

  if (!token) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-16">
        <h1 className="text-2xl font-semibold">{t.resetPassword.invalidTitle}</h1>
        <p className="mt-2 text-center text-sm text-foreground-soft">{t.resetPassword.invalidBody}</p>
        <Link href="/forgot-password" className="mt-4 font-medium text-accent hover:underline">
          {t.resetPassword.requestNew}
        </Link>
        {picker}
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-16">
      <h1 className="text-2xl font-semibold">{t.resetPassword.title}</h1>

      {error === "invalid" && (
        <p role="alert" className="mt-4 w-full rounded-lg bg-danger/10 px-4 py-2 text-center text-sm text-danger">
          {t.resetPassword.errors.invalid}
        </p>
      )}

      {error === "mismatch" && (
        <p role="alert" className="mt-4 w-full rounded-lg bg-danger/10 px-4 py-2 text-center text-sm text-danger">
          {t.resetPassword.errors.mismatch}
        </p>
      )}

      {error === "same_password" && (
        <p role="alert" className="mt-4 w-full rounded-lg bg-danger/10 px-4 py-2 text-center text-sm text-danger">
          {t.resetPassword.errors.same_password}
        </p>
      )}

      <form action={resetPassword} className="mt-6 w-full space-y-3">
        <input type="hidden" name="token" value={token} />
        <label htmlFor="reset-password-new" className="sr-only">
          {t.resetPassword.newLabel}
        </label>
        <PasswordInput
          id="reset-password-new"
          name="password"
          required
          minLength={8}
          maxLength={72}
          autoComplete="new-password"
          placeholder={t.resetPassword.newPlaceholder}
          className="w-full rounded-lg border border-line bg-surface px-4 py-3 text-sm outline-none focus:border-accent"
          labels={t.shared.passwordInput}
        />
        <label htmlFor="reset-password-confirm" className="sr-only">
          {t.resetPassword.confirm}
        </label>
        <PasswordInput
          id="reset-password-confirm"
          name="confirmPassword"
          required
          minLength={8}
          maxLength={72}
          autoComplete="new-password"
          placeholder={t.resetPassword.confirm}
          className="w-full rounded-lg border border-line bg-surface px-4 py-3 text-sm outline-none focus:border-accent"
          labels={t.shared.passwordInput}
        />
        <SubmitButton
          label={t.resetPassword.submit}
          pendingLabel={t.resetPassword.submitting}
          offlineMessage={t.shared.submitButton.offline}
          className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-ink"
        />
      </form>

      {picker}
    </div>
  );
}
