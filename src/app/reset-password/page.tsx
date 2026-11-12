import { headers } from "next/headers";
import { ResetPasswordForm } from "@/components/reset-password-form";
import { LanguagePicker } from "@/components/language-picker";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { RESET_TOKEN_CAPTURE_SCRIPT } from "@/lib/reset-token-client";

/**
 * The emailed link is /reset-password#token=... (src/lib/reset-token.ts). The server never sees the token: the inline
 * script below takes it out of the address before any analytics script runs, and ResetPasswordForm keeps it in memory
 * and sends it only in the form's POST body.
 */
export default async function ResetPasswordPage() {
  const locale = await getLocale();
  const t = await getDictionary();
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <>
      <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: RESET_TOKEN_CAPTURE_SCRIPT }} />
      <ResetPasswordForm
        t={{
          ...t.resetPassword,
          offline: t.shared.submitButton.offline,
          passwordInput: t.shared.passwordInput,
        }}
      >
        <LanguagePicker locale={locale} label={t.languagePicker.label} />
      </ResetPasswordForm>
    </>
  );
}
