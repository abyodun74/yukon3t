"use client";

import { useEffect, useRef, useTransition, type FormEvent } from "react";
import { PasswordInput } from "@/components/password-input";
import { SubmitButton } from "@/components/submit-button";
import { TurnstileWidget } from "@/components/turnstile-widget";
import type { Locale } from "@/lib/i18n/locales";
import type { TurnstileStrings } from "@/lib/turnstile-lifecycle";
import type { Dictionary } from "@/lib/i18n/en";

/**
 * The username & password form on /sign-in. `action` (loginWithPassword) always ends in a redirect: back to /sign-in
 * with an error code, or on to the next step. Called from onSubmit rather than through the form's `action`, the same way
 * the sign-up form does it, because React resets a form submitted through `action` once the action finishes: a wrong
 * password used to come back with both fields empty. Here what was typed stays, and the password field is focused so it
 * can be corrected. Without JavaScript the form still posts through `action` as before.
 */
export function PasswordSignInForm({
  action,
  error,
  locale,
  t,
  shared,
  turnstileStrings,
}: {
  action: (formData: FormData) => Promise<void>;
  /** The error code the page was rendered with, if any. */
  error: string | null;
  locale: Locale;
  t: Pick<Dictionary["signIn"], "identifier" | "password" | "submit" | "submitting">;
  shared: Pick<Dictionary["shared"], "passwordInput" | "submitButton">;
  turnstileStrings: TurnstileStrings;
}) {
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (error) formRef.current?.querySelector<HTMLInputElement>("#password")?.focus();
  }, [error]);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    // TurnstileWidget's listener has already run and cancels a submit that would go out without a token.
    if (e.defaultPrevented) return;
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      await action(formData);
    });
  }

  return (
    <form ref={formRef} action={action} onSubmit={handleSubmit} className="mt-3 space-y-3">
      <label htmlFor="identifier" className="sr-only">
        {t.identifier}
      </label>
      <input
        id="identifier"
        type="text"
        name="identifier"
        required
        autoComplete="username"
        // A username or an email address: never capitalised, corrected or spell-checked by the keyboard.
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder={t.identifier}
        className="w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm ltr-value outline-none focus:border-accent"
      />
      <label htmlFor="password" className="sr-only">
        {t.password}
      </label>
      <PasswordInput
        id="password"
        name="password"
        required
        autoComplete="current-password"
        placeholder={t.password}
        className="w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
        labels={shared.passwordInput}
      />
      <TurnstileWidget className="flex justify-center" locale={locale} strings={turnstileStrings} />
      <SubmitButton
        label={t.submit}
        pendingLabel={t.submitting}
        pending={isPending}
        offlineMessage={shared.submitButton.offline}
        className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink shadow-[var(--shadow-sm)] hover:-translate-y-0.5"
      />
    </form>
  );
}
