"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { messagesEn, uiEn } from "@/lib/i18n/en";
import { localeDirection, type Locale } from "@/lib/i18n/locales";

// How client components outside the account screens get their wording. A server component (the root layout, the
// messages layout) reads the reader's language and hands the provider that one language's slice; the hooks default
// to English, so a component rendered with no provider above it (a test, a new screen) still works. Never import
// dictionaries.ts here: that would ship every language to the browser.

type UiText = { locale: Locale; dir: "ltr" | "rtl"; t: typeof uiEn };
type MessagesText = { locale: Locale; dir: "ltr" | "rtl"; t: typeof messagesEn };

const UiTextContext = createContext<UiText>({ locale: "en", dir: "ltr", t: uiEn });
const MessagesTextContext = createContext<MessagesText>({ locale: "en", dir: "ltr", t: messagesEn });

/** Root layout: comments, recorders, pickers, dictation, reactions and the report sheet, wherever they are mounted. */
export function UiTextProvider({ locale, text, children }: { locale: Locale; text: typeof uiEn; children: ReactNode }) {
  const value = useMemo(() => ({ locale, dir: localeDirection(locale), t: text }), [locale, text]);
  return <UiTextContext.Provider value={value}>{children}</UiTextContext.Provider>;
}

/** `lang`/`dir` go on the root element of whatever renders this wording: the screen around it may be English. */
export function useUiText() {
  return useContext(UiTextContext);
}

/** messages/layout.tsx: everything under /messages. */
export function MessagesTextProvider({
  locale,
  text,
  children,
}: {
  locale: Locale;
  text: typeof messagesEn;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ locale, dir: localeDirection(locale), t: text }), [locale, text]);
  return <MessagesTextContext.Provider value={value}>{children}</MessagesTextContext.Provider>;
}

export function useMessagesText() {
  return useContext(MessagesTextContext);
}
