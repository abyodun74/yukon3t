// Per-language versions of a "What's new" announcement. Pure and client-safe (the admin form imports it): no
// Prisma, no network.
//
// The rule, everywhere an announcement is shown or pushed: the version in the reader's language when the admin
// wrote (or reviewed a machine draft of) one, otherwise the Announcement's own title/body, which are the English
// (default) version. A translation is always whole: a language never mixes a translated title with an English body.

import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from "@/lib/i18n/locales";

/** Same bounds as announcementSchema's base title/body (validations.ts), which every translation also uses. */
export const ANNOUNCEMENT_TITLE_MIN = 3;
export const ANNOUNCEMENT_TITLE_MAX = 120;
export const ANNOUNCEMENT_BODY_MIN = 10;
export const ANNOUNCEMENT_BODY_MAX = 4000;

/** The languages an announcement can have its own version in: every supported one but the base (English). */
export const ANNOUNCEMENT_TRANSLATION_LOCALES = SUPPORTED_LOCALES.filter(
  (locale): locale is Exclude<Locale, "en"> => locale !== DEFAULT_LOCALE,
);
export type AnnouncementTranslationLocale = (typeof ANNOUNCEMENT_TRANSLATION_LOCALES)[number];

export function isAnnouncementTranslationLocale(value: unknown): value is AnnouncementTranslationLocale {
  return (ANNOUNCEMENT_TRANSLATION_LOCALES as readonly unknown[]).includes(value);
}

export type AnnouncementText = { title: string; body: string };
export type AnnouncementTranslationRow = AnnouncementText & { locale: string };

/**
 * What a reader in `locale` sees: the row for that language if there is one (and it has both halves), else the base
 * version. `locale` in the answer is the language of the text returned, for `lang` attributes.
 */
export function announcementTextFor(
  announcement: AnnouncementText & { translations?: readonly AnnouncementTranslationRow[] | null },
  locale: Locale,
): AnnouncementText & { locale: Locale } {
  if (locale !== DEFAULT_LOCALE) {
    const row = announcement.translations?.find((t) => t.locale === locale);
    if (row && row.title.trim() && row.body.trim()) return { title: row.title, body: row.body, locale };
  }
  return { title: announcement.title, body: announcement.body, locale: DEFAULT_LOCALE };
}

// ---------- The admin form's per-language fields ----------

/** The form's per-language fields as typed (either half may be empty while the admin works). */
export type TranslationFields = Partial<Record<AnnouncementTranslationLocale, AnnouncementText>>;

export type TranslationFieldState = "empty" | "partial" | "filled";

/** Whether a language's fields are untouched, half filled (which posting refuses) or complete. */
export function translationFieldState(fields: AnnouncementText | undefined): TranslationFieldState {
  const title = Boolean(fields?.title.trim());
  const body = Boolean(fields?.body.trim());
  if (title && body) return "filled";
  return title || body ? "partial" : "empty";
}

/** One language a draft request asks for, and which of its halves are still empty. */
export type DraftTarget = { locale: AnnouncementTranslationLocale; fields: ("title" | "body")[] };

/**
 * What "Draft translations" should ask for: each selected language's EMPTY halves only. A language whose title and
 * body are both typed is left out entirely; a half the admin typed is never requested.
 */
export function draftTargets(current: TranslationFields, selected: readonly AnnouncementTranslationLocale[]): DraftTarget[] {
  const targets: DraftTarget[] = [];
  for (const locale of ANNOUNCEMENT_TRANSLATION_LOCALES) {
    if (!selected.includes(locale)) continue;
    const fields: DraftTarget["fields"] = [];
    if (!current[locale]?.title.trim()) fields.push("title");
    if (!current[locale]?.body.trim()) fields.push("body");
    if (fields.length) targets.push({ locale, fields });
  }
  return targets;
}

export type AnnouncementDraft = { locale: AnnouncementTranslationLocale; title?: string; body?: string };

/**
 * Puts machine drafts into the form: only into halves that are STILL empty when the answer arrives (the admin may
 * have typed while it ran), so nothing the admin typed is ever replaced. Returns the new fields and which languages
 * received any draft text (the form labels those as drafts to review).
 */
export function applyDrafts(
  current: TranslationFields,
  drafts: readonly AnnouncementDraft[],
): { fields: TranslationFields; drafted: AnnouncementTranslationLocale[] } {
  const fields: TranslationFields = { ...current };
  const drafted: AnnouncementTranslationLocale[] = [];
  for (const draft of drafts) {
    if (!isAnnouncementTranslationLocale(draft.locale)) continue;
    const before = fields[draft.locale] ?? { title: "", body: "" };
    const next = { ...before };
    let changed = false;
    if (draft.title?.trim() && !before.title.trim()) {
      next.title = draft.title.trim();
      changed = true;
    }
    if (draft.body?.trim() && !before.body.trim()) {
      next.body = draft.body.trim();
      changed = true;
    }
    if (changed) {
      fields[draft.locale] = next;
      if (!drafted.includes(draft.locale)) drafted.push(draft.locale);
    }
  }
  return { fields, drafted };
}

/**
 * The form's fields as the createAnnouncement payload: languages left completely empty are dropped (they just fall
 * back to English); everything else is sent as typed, so a half-filled language reaches validation and is refused
 * there rather than silently discarded.
 */
export function translationsForSubmit(fields: TranslationFields): AnnouncementTranslationRow[] {
  const rows: AnnouncementTranslationRow[] = [];
  for (const locale of ANNOUNCEMENT_TRANSLATION_LOCALES) {
    const value = fields[locale];
    if (!value || translationFieldState(value) === "empty") continue;
    rows.push({ locale, title: value.title, body: value.body });
  }
  return rows;
}

/**
 * The push for a new announcement, worded per recipient language (push-text.ts's Localized): that language's version
 * when one was posted, else the English. One payload per language however many devices share it (perLocale).
 */
export function announcementPushPayload(
  announcement: AnnouncementText & { translations?: readonly AnnouncementTranslationRow[] | null },
): (locale: Locale) => AnnouncementText {
  return (locale) => {
    const { title, body } = announcementTextFor(announcement, locale);
    return { title, body };
  };
}
