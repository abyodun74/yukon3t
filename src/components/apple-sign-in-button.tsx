import { Apple } from "lucide-react";
import { startAppleSignIn } from "@/app/actions/apple-auth";
import { SubmitButton } from "@/components/submit-button";
import { TurnstileWidget } from "@/components/turnstile-widget";

/**
 * Shared between /sign-in and /sign-up — same underlying action either way
 * (see startAppleSignIn's own doc comment for why signing up and signing in
 * via Apple aren't actually different flows). Rendered by the page only
 * when isAppleSignInConfigured() is true, so it's simply absent rather than
 * broken until AUTH_APPLE_ID/TEAM_ID/KEY_ID/PRIVATE_KEY are all set.
 */
export function AppleSignInButton({
  showCaptchaError,
  returnPath = "/sign-in",
}: {
  showCaptchaError: boolean;
  /** Where a Turnstile failure should redirect back to — this button is shared by /sign-in and /sign-up. */
  returnPath?: "/sign-in" | "/sign-up";
}) {
  return (
    <form action={startAppleSignIn} className="mt-4 w-full">
      <input type="hidden" name="returnPath" value={returnPath} />
      {showCaptchaError && (
        <p className="mb-3 rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">
          We couldn&apos;t complete the security check. Wait a moment and try again — if it keeps
          happening, turn off any content blocker or try another network.
        </p>
      )}
      <TurnstileWidget />
      <SubmitButton
        label={
          <span className="flex items-center justify-center gap-2">
            <Apple size={18} fill="currentColor" />
            Sign in with Apple
          </span>
        }
        pendingLabel="Redirecting..."
        className="mt-3 w-full rounded-lg bg-[#000] px-4 py-3 text-sm font-semibold text-white shadow-[var(--shadow-sm)] hover:-translate-y-0.5"
      />
    </form>
  );
}
