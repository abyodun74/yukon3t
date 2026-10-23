"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { translateContent } from "@/app/actions/translation";
import { useUiText } from "@/components/ui-text";
import { format, intlLocale, type Locale } from "@/lib/i18n/locales";
import { shouldOfferTranslation, type TranslationKind, type TranslationOutcome } from "@/lib/translation";
import { createTranslationClient, translationCacheKey } from "@/lib/translation-client";
import { cn } from "@/lib/utils";

// "Translate" / "Show original" under a post, comment or chat message written in another language than the reader's
// (src/lib/translation.ts has the rules, src/lib/translation-server.ts the server half). The original text is never
// replaced in the data: the hook only chooses which text to show, and a translation is always labelled.

type TranslationSettings = { available: boolean; autoTranslate: boolean };

const SettingsContext = createContext<TranslationSettings>({ available: false, autoTranslate: false });

/**
 * Root layout, signed in: `available` is false while the server has no translation provider configured (then no
 * Translate button is shown anywhere), `autoTranslate` is the reader's Settings -> Language choice.
 */
export function ContentTranslationProvider({
  available,
  autoTranslate,
  children,
}: TranslationSettings & { children: ReactNode }) {
  return <SettingsContext.Provider value={{ available, autoTranslate }}>{children}</SettingsContext.Provider>;
}

let sharedClient: ReturnType<typeof createTranslationClient> | null = null;
function translationClient() {
  sharedClient ??= createTranslationClient((items) => translateContent({ items }));
  return sharedClient;
}

type ViewState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "translated"; text: string; sourceLang: string; showing: boolean }
  | { phase: "hidden" } // same language, or nothing to translate after all
  | { phase: "failed"; reason: "unavailable" | "rate_limited" };

function languageName(code: string, locale: Locale): string | null {
  if (code === "und") return null;
  try {
    return new Intl.DisplayNames([intlLocale(locale) ?? locale], { type: "language" }).of(code) ?? null;
  } catch {
    return null;
  }
}

/**
 * The text to show for one post/comment/message, and the control to render under it. `enabled: false` (a secret
 * chat's message, a deleted one, a view-once one) turns both off: the text is shown as written, with no control.
 */
export function useContentTranslation({
  kind,
  id,
  text,
  enabled = true,
  controlClassName,
}: {
  kind: TranslationKind;
  id: string;
  text: string;
  enabled?: boolean;
  controlClassName?: string;
}): { displayText: string; control: ReactNode } {
  const { available, autoTranslate } = useContext(SettingsContext);
  const { locale } = useUiText();
  const offered = available && enabled && shouldOfferTranslation(text, locale);
  const key = translationCacheKey({ kind, id }, locale, text);

  const [state, setState] = useState<{ key: string; view: ViewState }>({ key, view: { phase: "idle" } });
  // An edited text or a language change starts over (the cache keeps anything already fetched).
  const view: ViewState = state.key === key ? state.view : { phase: "idle" };
  const keyRef = useRef(key);
  useEffect(() => {
    keyRef.current = key;
  }, [key]);

  const fetchTranslation = useCallback(
    (showWhenDone: boolean) => {
      const requestKey = key;
      setState({ key: requestKey, view: { phase: "loading" } });
      void translationClient()
        .request({ kind, id }, locale, text)
        .then((outcome: TranslationOutcome) => {
          if (keyRef.current !== requestKey) return;
          let next: ViewState;
          if (outcome.status === "translated") {
            next = { phase: "translated", text: outcome.text, sourceLang: outcome.sourceLang, showing: showWhenDone };
          } else if (outcome.status === "same_language" || outcome.status === "not_translatable") {
            next = { phase: "hidden" };
          } else {
            next = { phase: "failed", reason: outcome.status };
          }
          setState({ key: requestKey, view: next });
        });
    },
    [key, kind, id, locale, text],
  );

  // Auto-translate: once the text is (nearly) on screen, never for every item of a long list up front.
  const autoRef = useRef<HTMLSpanElement | null>(null);
  const autoStarted = useRef<string | null>(null);
  const wantsAuto = offered && autoTranslate && view.phase === "idle";
  useEffect(() => {
    const element = autoRef.current;
    if (!wantsAuto || !element || autoStarted.current === key) return;
    const start = () => {
      if (autoStarted.current === key) return;
      autoStarted.current = key;
      fetchTranslation(true);
    };
    if (typeof IntersectionObserver === "undefined") {
      start();
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          start();
        }
      },
      { rootMargin: "200px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [wantsAuto, key, fetchTranslation]);

  if (!offered || view.phase === "hidden") return { displayText: text, control: null };

  const displayText = view.phase === "translated" && view.showing ? view.text : text;
  return {
    displayText,
    control: (
      <TranslationControl
        view={view}
        locale={locale}
        className={controlClassName}
        autoRef={autoRef}
        onTranslate={() => {
          if (view.phase === "translated") setState({ key, view: { ...view, showing: true } });
          else fetchTranslation(true);
        }}
        onShowOriginal={() => {
          if (view.phase === "translated") setState({ key, view: { ...view, showing: false } });
        }}
      />
    ),
  };
}

function TranslationControl({
  view,
  locale,
  className,
  autoRef,
  onTranslate,
  onShowOriginal,
}: {
  view: ViewState;
  locale: Locale;
  className?: string;
  autoRef: React.RefObject<HTMLSpanElement | null>;
  onTranslate: () => void;
  onShowOriginal: () => void;
}) {
  const { t: ui } = useUiText();
  const t = ui.translation;
  const button = "font-medium hover:underline disabled:opacity-60";

  let content: ReactNode;
  if (view.phase === "loading") {
    content = (
      <span role="status" aria-live="polite">
        {t.translating}
      </span>
    );
  } else if (view.phase === "translated" && view.showing) {
    const name = languageName(view.sourceLang, locale);
    content = (
      <>
        <span>{name ? format(t.translatedFrom, { language: name }) : t.translated}</span>
        <span aria-hidden>·</span>
        <button type="button" className={button} onClick={onShowOriginal}>
          {t.showOriginal}
        </button>
      </>
    );
  } else if (view.phase === "failed") {
    content = (
      <>
        <span role="status">{view.reason === "rate_limited" ? t.rateLimited : t.unavailable}</span>
        <span aria-hidden>·</span>
        <button type="button" className={button} onClick={onTranslate}>
          {t.translate}
        </button>
      </>
    );
  } else {
    content = (
      <button type="button" className={button} onClick={onTranslate}>
        {t.translate}
      </button>
    );
  }

  return (
    <span
      ref={autoRef}
      // Clicks here must not also open the card/bubble underneath.
      onClick={(e) => e.stopPropagation()}
      className={cn("mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-foreground-soft", className)}
    >
      {content}
    </span>
  );
}
