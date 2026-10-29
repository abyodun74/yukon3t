import { Apple } from "lucide-react";
import { startAppleSignIn } from "@/app/actions/apple-auth";
import { SubmitButton } from "@/components/submit-button";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { getDictionary, getLocale } from "@/lib/i18n/server";

/**
 * Shared between /sign-in and /sign-up — same underlying action either way
 * (see startAppleSignIn's own doc comment for why signing up and signing in
 * via Apple aren't actually different flows). Rendered by the page only
 * when isAppleSignInConfigured() is true, so it's simply absent rather than
 * broken until AUTH_APPLE_ID/TEAM_ID/KEY_ID/PRIVATE_KEY are all set. Written
 * in the request's language, like the two pages it sits on.
 */
export async function AppleSignInButton({
  captchaError,
  returnPath = "/sign-in",
}: {
  /** The page's `?error=` value; only `apple_captcha` / `apple_captcha_unavailable` (actions/apple-auth.ts) show here. */
  captchaError: string | undefined;
  /** Where a Turnstile failure should redirect back to — this button is shared by /sign-in and /sign-up. */
  returnPath?: "/sign-in" | "/sign-up";
}) {
  const locale = await getLocale();
  const t = await getDictionary();

  return (
    <form action={startAppleSignIn} className="mt-4 w-full">
      <input type="hidden" name="returnPath" value={returnPath} />
      {(captchaError === "apple_captcha" || captchaError === "apple_captcha_unavailable") && (
        <p role="alert" className="mb-3 rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">
          {captchaError === "apple_captcha" ? t.common.captchaFailed : t.common.captchaUnavailable}
        </p>
      )}
      <TurnstileWidget locale={locale} strings={t.shared.turnstile} />
      <SubmitButton
        label={
          <span className="flex items-center justify-center gap-2">
            <Apple size={18} fill="currentColor" />
            {t.apple.signIn}
          </span>
        }
        pendingLabel={t.apple.redirecting}
        offlineMessage={t.shared.submitButton.offline}
        className="mt-3 w-full rounded-lg bg-[#000] px-4 py-3 text-sm font-semibold text-white shadow-[var(--shadow-sm)] hover:-translate-y-0.5"
      />
    </form>
  );
}
