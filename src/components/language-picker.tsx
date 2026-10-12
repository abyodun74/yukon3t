"use client";

import { useId, useOptimistic, useTransition } from "react";
import { setLocale } from "@/app/actions/locale";
import { LOCALE_NAMES, SUPPORTED_LOCALES, type Locale } from "@/lib/i18n/locales";

/**
 * Language choice for the account screens. A native <select> (the one picker that behaves in both WKWebView and
 * Android WebView), each language under its own name. The choice goes in a cookie, never the URL, and the page
 * re-renders in place — client state on it (what has been typed into the sign-up form) is kept.
 */
export function LanguagePicker({ locale, label }: { locale: Locale; label: string }) {
  const id = useId();
  const [isPending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(locale);

  return (
    <div className="mt-8 flex w-full items-center justify-center gap-2 text-xs text-foreground-soft">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={shown}
        aria-busy={isPending || undefined}
        onChange={(e) => {
          const next = e.target.value as Locale;
          startTransition(async () => {
            setShown(next);
            await setLocale(next);
          });
        }}
        className="rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-foreground outline-none focus:border-accent"
      >
        {SUPPORTED_LOCALES.map((code) => (
          <option key={code} value={code} lang={code}>
            {LOCALE_NAMES[code]}
          </option>
        ))}
      </select>
    </div>
  );
}
