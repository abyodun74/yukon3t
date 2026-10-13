"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { shellEn } from "@/lib/i18n/en/shell";
import { uiEn } from "@/lib/i18n/en/ui";
import { localeDirection, type Locale } from "@/lib/i18n/locales";

// How client components get their wording. A server layout reads the reader's language and hands a provider that one
// language's slice of one area of the dictionary; the matching hook defaults to English, so a component rendered with
// no provider above it (a test, a route that isn't translated yet) still works. One provider per area, each in the
// file that imports only that area's English (this one: what the root layout mounts everywhere; feed-text.tsx;
// messages-text.tsx), so a page's bundle carries the default wording of the areas it renders and nothing else.
// Never import dictionaries.ts in a client component: that would ship every language to the browser.

export type AreaText<T> = { locale: Locale; dir: "ltr" | "rtl"; t: T };

/** A provider and its hook for one area of the dictionary, falling back to `english`. */
export function createAreaText<T>(english: T) {
  const Context = createContext<AreaText<T>>({ locale: "en", dir: "ltr", t: english });
  function Provider({ locale, text, children }: { locale: Locale; text: T; children: ReactNode }) {
    const value = useMemo(() => ({ locale, dir: localeDirection(locale), t: text }), [locale, text]);
    return <Context.Provider value={value}>{children}</Context.Provider>;
  }
  return { Provider, useText: () => useContext(Context) };
}

const ui = createAreaText(uiEn);
const shell = createAreaText(shellEn);

/** Root layout: comments, recorders, pickers, dictation, reactions and the report sheet, wherever they are mounted. */
export const UiTextProvider = ui.Provider;
/** `lang`/`dir` go on the root element of whatever renders this wording: the screen around it may be English. */
export const useUiText = ui.useText;

/** Root layout: the nav and footer, the error boundary, and the overlays any screen can open (see en/shell.ts). */
export const ShellTextProvider = shell.Provider;
export const useShellText = shell.useText;
