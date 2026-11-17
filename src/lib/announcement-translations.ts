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
 * body are both typed is left out entirely; a half the admin typed is never requested. The form sends one
 * draftAnnouncementTranslation call per target, in this order.
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

// ---------- Drafting, one language per server call ----------
//
// "Draft translations" asks the server for ONE language per call (draftAnnouncementTranslation), one call after
// another: Next runs a tab's Server Actions one at a time anyway, and each call then gets the whole function time
// budget for its language. Inside a call the body is split into chunks translated in parallel
// (src/lib/chunked-translation.ts), within ANNOUNCEMENT_DRAFT_BUDGET_MS.
//
// Time limits (the reason for these numbers): yukon3t.com is served by Netlify, whose synchronous functions are cut at
// about 26-30s (a 30s Hive call got a 504 there; see src/lib/video-scan-budget.ts); Vercel allows more (the admin
// pages set maxDuration = 30). So a call stops starting model calls at 22s after it began and every model call is
// given min(15s, time left), leaving several seconds for auth, the rate-limit checks and the response. A 4000-char
// body is at most ~5-6 chunks of <= 900 chars, all in flight at once (concurrency 5, plus the title in parallel), so
// even a slow language (Hindi, Arabic, Swahili: more output tokens per character) needs one ~5-10s round, with time
// left for one retry of a chunk that failed transiently. A chunk that still can't be done comes back as a marked
// English passage (ANNOUNCEMENT_UNTRANSLATED_OPEN), never a failure of the whole language.

export const ANNOUNCEMENT_DRAFT_BUDGET_MS = 22_000;
export const ANNOUNCEMENT_DRAFT_CALL_TIMEOUT_MS = 15_000;
export const ANNOUNCEMENT_DRAFT_MIN_CALL_MS = 3_000;
export const ANNOUNCEMENT_DRAFT_MIN_RETRY_MS = 5_000;
export const ANNOUNCEMENT_DRAFT_CHUNK_MAX_CHARS = 900;
export const ANNOUNCEMENT_DRAFT_CHUNK_CONCURRENCY = 5;

/**
 * Marks a passage of a partial draft that is still English. Posting or saving refuses any text containing it
 * (validations.ts), so a partial draft can't go out unfinished.
 */
export const ANNOUNCEMENT_UNTRANSLATED_OPEN = "[[NOT TRANSLATED YET: ";
export const ANNOUNCEMENT_UNTRANSLATED_CLOSE = "]]";

export function markUntranslated(english: string): string {
  return `${ANNOUNCEMENT_UNTRANSLATED_OPEN}${english}${ANNOUNCEMENT_UNTRANSLATED_CLOSE}`;
}

export function hasUntranslatedMarker(text: string): boolean {
  return text.includes(ANNOUNCEMENT_UNTRANSLATED_OPEN);
}

export type DraftField = "title" | "body";

/** What draftAnnouncementTranslation answers for one language. */
export type DraftLanguageResult =
  | {
      error: null;
      locale: AnnouncementTranslationLocale;
      title?: string;
      body?: string;
      /** Halves asked for that came back with no text at all. */
      failed: DraftField[];
      /** Set when the body came back with some chunks still English (marked); done/total count chunks. */
      partial: { done: number; total: number } | null;
      /** Halves whose draft is over the field's length limit (returned anyway, for the admin to shorten). */
      tooLong: DraftField[];
    }
  | { error: "invalid" | "unavailable" | "rate_limited" };

export type DraftFailReason = "invalid" | "unavailable" | "rate_limited" | "failed";

/** One language's place in the form's draft queue. */
export type DraftLanguageStatus =
  | { state: "queued" }
  | { state: "drafting" }
  | { state: "done"; tooLong: DraftField[] }
  | { state: "partial"; missingTitle: boolean; body: { done: number; total: number } | null; tooLong: DraftField[] }
  | { state: "failed"; reason: DraftFailReason };

/** The status a language ends in after its call answered (`result`) or threw (`null`). */
export function draftStatusFromResult(result: DraftLanguageResult | null, requested: readonly DraftField[]): DraftLanguageStatus {
  if (!result) return { state: "failed", reason: "failed" };
  if (result.error) return { state: "failed", reason: result.error };
  const gotSomething = (result.title !== undefined && requested.includes("title")) || (result.body !== undefined && requested.includes("body"));
  if (!gotSomething) return { state: "failed", reason: "failed" };
  if (result.failed.length || result.partial) {
    return {
      state: "partial",
      missingTitle: result.failed.includes("title"),
      body: result.failed.includes("body") ? { done: 0, total: result.partial?.total ?? 1 } : result.partial,
      tooLong: result.tooLong,
    };
  }
  return { state: "done", tooLong: result.tooLong };
}

/** Whether a failure means every later language in the queue would fail the same way (so they aren't sent). */
export function draftFailureStopsQueue(reason: DraftFailReason): boolean {
  return reason === "rate_limited" || reason === "unavailable";
}

/** Whether a language can be drafted again with Retry (it failed, or still has an empty half after a partial). */
export function canRetryDraft(status: DraftLanguageStatus | undefined, fields: AnnouncementText | undefined): boolean {
  if (!status) return false;
  if (status.state === "failed") return status.reason !== "invalid";
  if (status.state === "partial") return !fields?.title.trim() || !fields?.body.trim();
  return false;
}

export type SubmitProblem = { locale: AnnouncementTranslationLocale; reason: "partial" | "too_long" | "untranslated" };

/**
 * The first language the form must not send as it is: half filled, over a length limit, or still holding a marked
 * English passage from a partial draft. Null when every language can be sent (the server checks all of it again).
 */
export function translationSubmitProblem(fields: TranslationFields): SubmitProblem | null {
  for (const locale of ANNOUNCEMENT_TRANSLATION_LOCALES) {
    const value = fields[locale];
    const state = translationFieldState(value);
    if (!value || state === "empty") continue;
    if (state === "partial") return { locale, reason: "partial" };
    if (hasUntranslatedMarker(value.title) || hasUntranslatedMarker(value.body)) return { locale, reason: "untranslated" };
    if (value.title.trim().length > ANNOUNCEMENT_TITLE_MAX || value.body.trim().length > ANNOUNCEMENT_BODY_MAX) {
      return { locale, reason: "too_long" };
    }
  }
  return null;
}

/** A posted announcement's stored versions as the form's fields (edit page); unknown locales are ignored. */
export function translationFieldsFromRows(rows: readonly AnnouncementTranslationRow[]): TranslationFields {
  const fields: TranslationFields = {};
  for (const row of rows) {
    if (isAnnouncementTranslationLocale(row.locale)) fields[row.locale] = { title: row.title, body: row.body };
  }
  return fields;
}

/**
 * The form's fields as the createAnnouncement / updateAnnouncement payload: languages left completely empty are
 * dropped (they just fall back to English; on an edit that removes the language); everything else is sent as typed,
 * so a half-filled language reaches validation and is refused there rather than silently discarded.
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
