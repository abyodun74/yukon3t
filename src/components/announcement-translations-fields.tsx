"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { draftAnnouncementTranslations } from "@/app/actions/announcement-drafts";
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_BODY_MIN,
  ANNOUNCEMENT_TITLE_MAX,
  ANNOUNCEMENT_TITLE_MIN,
  ANNOUNCEMENT_TRANSLATION_LOCALES,
  applyDrafts,
  draftTargets,
  translationFieldState,
  type AnnouncementTranslationLocale,
  type TranslationFields,
} from "@/lib/announcement-translations";
import { localeDirection } from "@/lib/i18n/locales";
import { TARGET_LANGUAGE_NAMES } from "@/lib/translation";

// The per-language half of the admin's announcement form (create-announcement-form.tsx). Admin UI: English only, like
// the rest of /admin. Every language is optional; one left empty shows readers the English version.

const STATE_LABEL = { empty: "Empty (English shown)", partial: "Incomplete", filled: "Filled" } as const;
const STATE_MARK = { empty: "", partial: " (!)", filled: " ✓" } as const;

function draftErrorMessage(code: "invalid" | "unavailable" | "rate_limited" | "failed"): string {
  switch (code) {
    case "invalid":
      return "Write the English title (3+ chars) and body (10+ chars) first, then pick at least one language with an empty field.";
    case "unavailable":
      return "Machine drafts aren't available right now (translation isn't configured). Write the translations yourself, or post in English only.";
    case "rate_limited":
      return "Too many draft requests for now. Try again later, or write the translations yourself.";
    default:
      return "Couldn't draft translations. Try again, or write them yourself.";
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
}: {
  englishTitle: string;
  englishBody: string;
  value: TranslationFields;
  onChange: (next: TranslationFields) => void;
  /** Languages that received machine-drafted text in this form (labelled until posted). */
  drafted: AnnouncementTranslationLocale[];
  onDrafted: (locales: AnnouncementTranslationLocale[]) => void;
  activeLocale: AnnouncementTranslationLocale;
  onActiveLocaleChange: (locale: AnnouncementTranslationLocale) => void;
  disabled: boolean;
}) {
  const [selected, setSelected] = useState<AnnouncementTranslationLocale[]>([...ANNOUNCEMENT_TRANSLATION_LOCALES]);
  const [isDrafting, startDrafting] = useTransition();
  const [draftNotice, setDraftNotice] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  // The fields as they are when a draft answer arrives (not when it was asked for), so text typed while it ran is
  // seen as typed and kept.
  const latest = useRef({ value, drafted });
  useEffect(() => {
    latest.current = { value, drafted };
  }, [value, drafted]);

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

  function requestDrafts() {
    setDraftNotice(null);
    if (!englishReady || targets.length === 0) {
      setDraftNotice({ kind: "error", text: draftErrorMessage("invalid") });
      return;
    }
    startDrafting(async () => {
      let result;
      try {
        result = await draftAnnouncementTranslations({ title: englishTitle, body: englishBody, targets });
      } catch {
        setDraftNotice({ kind: "error", text: draftErrorMessage("failed") });
        return;
      }
      if (result.error) {
        setDraftNotice({ kind: "error", text: draftErrorMessage(result.error) });
        return;
      }
      // Only into halves that are still empty now: anything typed meanwhile stays as typed.
      const applied = applyDrafts(latest.current.value, result.drafts);
      onChange(applied.fields);
      onDrafted([...new Set([...latest.current.drafted, ...applied.drafted])]);
      const failedNames = result.failed.map((l) => TARGET_LANGUAGE_NAMES[l]).join(", ");
      setDraftNotice({
        kind: result.failed.length ? "error" : "info",
        text:
          (applied.drafted.length
            ? `Drafted ${applied.drafted.map((l) => TARGET_LANGUAGE_NAMES[l]).join(", ")}. Machine drafts: read and correct each one before posting.`
            : "No empty fields were filled.") + (failedNames ? ` Couldn't draft ${failedNames}; write those yourself or leave them empty.` : ""),
      });
    });
  }

  return (
    <fieldset className="space-y-3 rounded-lg border border-line p-3" disabled={disabled}>
      <legend className="px-1 text-xs font-medium text-foreground-soft">Translations (optional)</legend>
      <p className="text-xs text-foreground-soft">
        Readers whose app language has no translation here see the English above. A language needs both a title and a
        body, or neither.
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
              Machine draft: review and correct before posting
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
        </div>
      </div>

      <div className="space-y-2 border-t border-line pt-3">
        <p className="text-xs text-foreground-soft">
          Draft translations: fills only the EMPTY fields of the languages ticked below with a machine translation of
          the English. It never replaces anything you typed and never posts; review every draft before posting.
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
          disabled={isDrafting || !englishReady || targets.length === 0}
          className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium disabled:opacity-50"
        >
          {isDrafting ? "Drafting..." : "Draft translations"}
        </button>
        {!englishReady && (
          <p className="text-xs text-foreground-soft">Write the English title and body first.</p>
        )}
        {draftNotice && (
          <p role={draftNotice.kind === "error" ? "alert" : "status"} className={`text-xs ${draftNotice.kind === "error" ? "text-danger" : "text-foreground-soft"}`}>
            {draftNotice.text}
          </p>
        )}
      </div>
    </fieldset>
  );
}
