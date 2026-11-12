"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { resetPassword, type ResetPasswordState } from "@/app/actions/password-auth";
import { PasswordInput } from "@/components/password-input";
import { SubmitButton } from "@/components/submit-button";
import { readResetTokenFromHash, RESET_TOKEN_GLOBAL } from "@/lib/reset-token-client";

type Strings = {
  invalidTitle: string;
  invalidBody: string;
  requestNew: string;
  title: string;
  errors: { invalid: string; mismatch: string; same_password: string };
  newLabel: string;
  newPlaceholder: string;
  confirm: string;
  submit: string;
  submitting: string;
  offline: string;
  passwordInput: { show: string; hide: string };
};

const initialState: ResetPasswordState = { error: null };

/**
 * The /reset-password form. The emailed link carries the token in the URL fragment; the page's inline script (see
 * reset-password/page.tsx) has already moved it into memory and replaced the URL before any analytics script loaded.
 * This picks it up from there (or, after a client-side navigation where that script didn't run, from the fragment
 * itself, then cleans the URL the same way) and keeps it in state for the POST body only: errors come back as action
 * state, never as a redirect that would put the token back into a URL.
 */
export function ResetPasswordForm({ t, children }: { t: Strings; children?: ReactNode }) {
  // undefined until the browser has been read (the server never sees the fragment).
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [state, formAction] = useActionState(resetPassword, initialState);

  useEffect(() => {
    const holder = window as unknown as Record<string, string | undefined>;
    let found = holder[RESET_TOKEN_GLOBAL] ?? null;
    delete holder[RESET_TOKEN_GLOBAL];
    if (!found) {
      found = readResetTokenFromHash(window.location.hash);
      if (window.location.hash || window.location.search) {
        window.history.replaceState(window.history.state, "", window.location.pathname);
      }
    }
    // Reading the browser's URL is exactly what this effect is for: there's no render-time source for it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToken(found);
  }, []);

  if (token === null) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-16">
        <h1 className="text-2xl font-semibold">{t.invalidTitle}</h1>
        <p className="mt-2 text-center text-sm text-foreground-soft">{t.invalidBody}</p>
        <Link href="/forgot-password" className="mt-4 font-medium text-accent hover:underline">
          {t.requestNew}
        </Link>
        {children}
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-16">
      <h1 className="text-2xl font-semibold">{t.title}</h1>

      {state.error && (
        <p role="alert" className="mt-4 w-full rounded-lg bg-danger/10 px-4 py-2 text-center text-sm text-danger">
          {t.errors[state.error]}
        </p>
      )}

      <form action={formAction} className="mt-6 w-full space-y-3">
        <input type="hidden" name="token" value={token ?? ""} />
        <label htmlFor="reset-password-new" className="sr-only">
          {t.newLabel}
        </label>
        <PasswordInput
          id="reset-password-new"
          name="password"
          required
          minLength={8}
          maxLength={72}
          autoComplete="new-password"
          placeholder={t.newPlaceholder}
          className="w-full rounded-lg border border-line bg-surface px-4 py-3 text-sm outline-none focus:border-accent"
          labels={t.passwordInput}
        />
        <label htmlFor="reset-password-confirm" className="sr-only">
          {t.confirm}
        </label>
        <PasswordInput
          id="reset-password-confirm"
          name="confirmPassword"
          required
          minLength={8}
          maxLength={72}
          autoComplete="new-password"
          placeholder={t.confirm}
          className="w-full rounded-lg border border-line bg-surface px-4 py-3 text-sm outline-none focus:border-accent"
          labels={t.passwordInput}
        />
        <SubmitButton
          label={t.submit}
          pendingLabel={t.submitting}
          offlineMessage={t.offline}
          pending={token === undefined ? true : undefined}
          className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-ink"
        />
      </form>

      {children}
    </div>
  );
}
