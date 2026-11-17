"use client";

import { useEffect, useRef, useState } from "react";
import { draftAnnouncementTranslation } from "@/app/actions/announcement-drafts";
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_BODY_MIN,
  ANNOUNCEMENT_TITLE_MAX,
  ANNOUNCEMENT_TITLE_MIN,
  ANNOUNCEMENT_TRANSLATION_LOCALES,
  applyDrafts,
  canRetryDraft,
  draftFailureStopsQueue,
  draftStatusFromResult,
  draftTargets,
  translationFieldState,
  type AnnouncementTranslationLocale,
  type DraftFailReason,
  type DraftLanguageResult,
  type DraftLanguageStatus,
  type DraftTarget,
  type TranslationFields,
} from "@/lib/announcement-translations";
import { localeDirection } from "@/lib/i18n/locales";
import { TARGET_LANGUAGE_NAMES } from "@/lib/translation";

// The per-language half of the admin's announcement form (create-announcement-form.tsx, used for posting and for
// editing). Admin UI: English only, like the rest of /admin. Every language is optional; one left empty shows readers
// the English version.

const STATE_LABEL = { empty: "Empty (English shown)", partial: "Incomplete", filled: "Filled" } as const;
const STATE_MARK = { empty: "", partial: " (!)", filled: " ✓" } as const;

function failMessage(reason: DraftFailReason): string {
  switch (reason) {
    case "invalid":
      return "Write the English title (3+ chars) and body (10+ chars) first.";
    case "unavailable":
      return "Machine drafts aren't available right now (translation isn't configured). Write it yourself, or leave it empty.";
    case "rate_limited":
      return "Too many draft requests for now. Try again later, or write it yourself.";
    default:
      return "Couldn't draft this one. Retry, or write it yourself.";
  }
}

function statusText(status: DraftLanguageStatus): string {
  switch (status.state) {
    case "queued":
      return "Waiting...";
    case "drafting":
      return "Drafting...";
    case "done":
      return status.tooLong.length
        ? `Drafted, but the ${status.tooLong.join(" and ")} is over the limit: shorten it.`
        : "Drafted: review and correct before saving.";
    case "partial": {
      const parts: string[] = [];
      if (status.body && status.body.done > 0) {
        parts.push(
          `Partial draft: ${status.body.done} of ${status.body.total} parts of the body translated; the rest is marked "NOT TRANSLATED YET" in English. Translate those passages (or clear the body and Retry).`,
        );
      } else if (status.body) {
        parts.push("Couldn't draft the body.");
      }
      if (status.missingTitle) parts.push("Couldn't draft the title.");
      if (status.tooLong.length) parts.push(`The ${status.tooLong.join(" and ")} is over the limit: shorten it.`);
      return parts.join(" ");
    }
    case "failed":
      return failMessage(status.reason);
  }
}

export function AnnouncementTranslationsFields({
  englishTitle,
  englishBody,
  value,
  onChange,
  drafted,
  onDrafted,
  activeLocale,
  onActiveLocaleChange,
  disabled,
  submitVerb,
}: {
  englishTitle: string;
  englishBody: string;
  value: TranslationFields;
  onChange: (next: TranslationFields) => void;
  /** Languages that received machine-drafted text in this form (labelled until posted/saved). */
  drafted: AnnouncementTranslationLocale[];
  onDrafted: (locales: AnnouncementTranslationLocale[]) => void;
  activeLocale: AnnouncementTranslationLocale;
  onActiveLocaleChange: (locale: AnnouncementTranslationLocale) => void;
  disabled: boolean;
  submitVerb: "posting" | "saving";
}) {
  const [selected, setSelected] = useState<AnnouncementTranslationLocale[]>([...ANNOUNCEMENT_TRANSLATION_LOCALES]);
  const [statuses, setStatuses] = useState<Partial<Record<AnnouncementTranslationLocale, DraftLanguageStatus>>>({});
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // The fields as they are when each answer arrives (not when it was asked for), so text typed while a language was
  // drafting is seen as typed and kept; and the callbacks as they are now (the queue outlives renders).
  const latest = useRef({ value, drafted, onChange, onDrafted });
  useEffect(() => {
    latest.current = { value, drafted, onChange, onDrafted };
  }, [value, drafted, onChange, onDrafted]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const englishReady =
    englishTitle.trim().length >= ANNOUNCEMENT_TITLE_MIN && englishBody.trim().length >= ANNOUNCEMENT_BODY_MIN;
  const targets = draftTargets(value, selected);
  const current = value[activeLocale] ?? { title: "", body: "" };
  const activeState = translationFieldState(current);

  function setField(locale: AnnouncementTranslationLocale, field: "title" | "body", text: string) {
    const before = value[locale] ?? { title: "", body: "" };
    onChange({ ...value, [locale]: { ...before, [field]: text } });
  }

  function toggleSelected(locale: AnnouncementTranslationLocale) {
    setSelected((prev) => (prev.includes(locale) ? prev.filter((l) => l !== locale) : [...prev, locale]));
  }

  function setStatus(locale: AnnouncementTranslationLocale, status: DraftLanguageStatus) {
    if (mounted.current) setStatuses((prev) => ({ ...prev, [locale]: status }));
  }

  /**
   * One server call per language, one after another (Next runs a tab's Server Actions one at a time anyway; each call
   * gets its own function time budget). A language that fails keeps a Retry; the others carry on, except after a
   * failure that would repeat for all of them (rate limit, not configured).
   */
  async function runQueue(queue: DraftTarget[]) {
    const english = { title: englishTitle, body: englishBody };
    setRunning(true);
    setNotice(null);
    setStatuses((prev) => {
      const next = { ...prev };
      for (const t of queue) next[t.locale] = { state: "queued" };
      return next;
    });
    for (let i = 0; i < queue.length; i++) {
      if (!mounted.current) return;
      const { locale } = queue[i];
      // Ask only for what is STILL empty now: the admin may have typed into this language while others drafted.
      const fields = draftTargets(latest.current.value, [locale])[0]?.fields;
      if (!fields) {
        setStatuses((prev) => {
          const next = { ...prev };
          delete next[locale];
          return next;
        });
        continue;
      }
      setStatus(locale, { state: "drafting" });
      let result: DraftLanguageResult | null = null;
      try {
        result = await draftAnnouncementTranslation({ ...english, locale, fields });
      } catch {
        result = null;
      }
      if (!mounted.current) return;
      if (result && !result.error) {
        // Only into halves that are still empty now: anything typed meanwhile stays as typed.
        const applied = applyDrafts(latest.current.value, [result]);
        latest.current.value = applied.fields;
        latest.current.onChange(applied.fields);
        if (applied.drafted.length) {
          const nextDrafted = [...new Set([...latest.current.drafted, ...applied.drafted])];
          latest.current.drafted = nextDrafted;
          latest.current.onDrafted(nextDrafted);
        }
      }
      const status = draftStatusFromResult(result, fields);
      setStatus(locale, status);
      if (status.state === "failed" && draftFailureStopsQueue(status.reason)) {
        for (const rest of queue.slice(i + 1)) setStatus(rest.locale, { state: "failed", reason: status.reason });
        break;
      }
    }
    if (mounted.current) setRunning(false);
  }

  function requestDrafts() {
    if (!englishReady || targets.length === 0) {
      setNotice("Write the English title (3+ chars) and body (10+ chars) first, then tick at least one language with an empty field.");
      return;
    }
    void runQueue(targets);
  }

  function retry(locale: AnnouncementTranslationLocale) {
    const target = draftTargets(value, [locale]);
    if (!englishReady || target.length === 0) return;
    void runQueue(target);
  }

  const statusLocales = ANNOUNCEMENT_TRANSLATION_LOCALES.filter((l) => statuses[l]);

  return (
    <fieldset className="space-y-3 rounded-lg border border-line p-3" disabled={disabled}>
      <legend className="px-1 text-xs font-medium text-foreground-soft">Translations (optional)</legend>
      <p className="text-xs text-foreground-soft">
        Readers whose app language has no translation here see the English above. A language needs both a title and a
        body, or neither{submitVerb === "saving" ? "; clearing both removes that language when you save" : ""}.
      </p>

      <div role="tablist" aria-label="Translation language" className="flex flex-wrap gap-1.5">
        {ANNOUNCEMENT_TRANSLATION_LOCALES.map((locale) => {
          const state = translationFieldState(value[locale]);
          const active = locale === activeLocale;
          return (
            <button
              key={locale}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls="announcement-translation-panel"
              aria-label={`${TARGET_LANGUAGE_NAMES[locale]}: ${STATE_LABEL[state]}${drafted.includes(locale) ? ", machine draft" : ""}`}
              onClick={() => onActiveLocaleChange(locale)}
              className={`rounded-full border px-3 py-1 text-xs ${
                active ? "border-accent bg-accent text-accent-ink" : "border-line"
              } ${state === "partial" && !active ? "border-danger text-danger" : ""} ${
                state === "filled" && !active ? "font-semibold" : ""
              }`}
            >
              {TARGET_LANGUAGE_NAMES[locale]}
              {STATE_MARK[state]}
            </button>
          );
        })}
      </div>

      <div id="announcement-translation-panel" role="tabpanel" className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-foreground-soft">
          <span>
            {TARGET_LANGUAGE_NAMES[activeLocale]}: {STATE_LABEL[activeState]}
          </span>
          {drafted.includes(activeLocale) && (
            <span className="rounded bg-accent-soft px-1.5 py-0.5 font-medium text-foreground">
              Machine draft: review and correct before {submitVerb}
            </span>
          )}
        </div>
        <div>
          <label htmlFor={`title-${activeLocale}`} className="text-xs font-medium text-foreground-soft">
            Title ({TARGET_LANGUAGE_NAMES[activeLocale]})
          </label>
          <input
            id={`title-${activeLocale}`}
            type="text"
            lang={activeLocale}
            dir={localeDirection(activeLocale)}
            maxLength={ANNOUNCEMENT_TITLE_MAX}
            value={current.title}
            onChange={(e) => setField(activeLocale, "title", e.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>
        <div>
          <label htmlFor={`body-${activeLocale}`} className="text-xs font-medium text-foreground-soft">
            What&apos;s new ({TARGET_LANGUAGE_NAMES[activeLocale]})
          </label>
          <textarea
            id={`body-${activeLocale}`}
            rows={4}
            lang={activeLocale}
            dir={localeDirection(activeLocale)}
            maxLength={ANNOUNCEMENT_BODY_MAX}
            value={current.body}
            onChange={(e) => setField(activeLocale, "body", e.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <p className="mt-0.5 text-right text-[11px] text-foreground-soft">
            {current.body.trim().length}/{ANNOUNCEMENT_BODY_MAX}
          </p>
        </div>
      </div>

      <div className="space-y-2 border-t border-line pt-3">
        <p className="text-xs text-foreground-soft">
          Draft translations: fills only the EMPTY fields of the languages ticked below with a machine translation of
          the English, one language at a time. It never replaces anything you typed and never posts or saves; review
          every draft before {submitVerb}.
        </p>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {ANNOUNCEMENT_TRANSLATION_LOCALES.map((locale) => (
            <label key={locale} className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={selected.includes(locale)} onChange={() => toggleSelected(locale)} />
              {TARGET_LANGUAGE_NAMES[locale]}
            </label>
          ))}
        </div>
        <button
          type="button"
          onClick={requestDrafts}
          disabled={running || !englishReady || targets.length === 0}
          className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium disabled:opacity-50"
        >
          {running ? "Drafting..." : "Draft translations"}
        </button>
        {!englishReady && <p className="text-xs text-foreground-soft">Write the English title and body first.</p>}
        {notice && (
          <p role="alert" className="text-xs text-danger">
            {notice}
          </p>
        )}
        {statusLocales.length > 0 && (
          <ul aria-live="polite" className="space-y-1 text-xs">
            {statusLocales.map((locale) => {
              const status = statuses[locale]!;
              const bad = status.state === "failed" || status.state === "partial" || (status.state === "done" && status.tooLong.length > 0);
              return (
                <li key={locale} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{TARGET_LANGUAGE_NAMES[locale]}:</span>
                  <span className={bad ? "text-danger" : "text-foreground-soft"}>{statusText(status)}</span>
                  {!running && canRetryDraft(status, value[locale]) && (
                    <button
                      type="button"
                      onClick={() => retry(locale)}
                      className="rounded border border-line px-2 py-0.5 text-xs font-medium"
                    >
                      Retry
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </fieldset>
  );
}
