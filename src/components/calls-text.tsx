"use client";

import type { ReactNode } from "react";
import { createAreaText } from "@/components/ui-text";
import { callsEn } from "@/lib/i18n/en/calls";
import type { Locale } from "@/lib/i18n/locales";

const calls = createAreaText(callsEn);

/**
 * Root layout: the call buttons, the incoming-call banner, the call screen and the live stream's video tiles, which
 * can be on screen from any page. `text` is left out for a signed-out visitor, who can't be in a call: the page is
 * then not sent this wording at all, and the hook's English default is never rendered.
 */
export function CallsTextProvider({
  locale,
  text,
  children,
}: {
  locale: Locale;
  text?: typeof callsEn;
  children: ReactNode;
}) {
  return (
    <calls.Provider locale={locale} text={text ?? callsEn}>
      {children}
    </calls.Provider>
  );
}

export const useCallsText = calls.useText;
