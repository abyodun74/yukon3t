"use server";

import { requireAdmin } from "@/lib/auth-guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { callTranslationModel, isTranslationConfigured } from "@/lib/translation-server";
import { announcementDraftSchema } from "@/lib/validations";
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_BODY_MIN,
  ANNOUNCEMENT_TITLE_MAX,
  ANNOUNCEMENT_TITLE_MIN,
  type AnnouncementDraft,
  type AnnouncementTranslationLocale,
} from "@/lib/announcement-translations";

export type DraftAnnouncementResult =
  | { error: null; drafts: AnnouncementDraft[]; failed: AnnouncementTranslationLocale[] }
  | { error: "invalid" | "unavailable" | "rate_limited" };

/**
 * Admin-only: machine drafts of an announcement's English title/body in the requested languages, for the admin to
 * review and edit on /admin/announcements before posting. Never stores or posts anything: it only returns text, and
 * the form (applyDrafts, src/lib/announcement-translations.ts) puts it only into halves that are still empty, so
 * nothing the admin typed is replaced. Reuses the post/comment translation model call (callTranslationModel: same
 * OpenAI key and model, the text travels as a JSON data field, links/@mentions/#hashtags kept). Each requested half is
 * one model call, counted against this admin's announcementDraft limit (per press) and the app-wide translateGlobal
 * ceiling (per call); both fail closed. A language where any requested half fails, or comes back over the field's
 * limit, is returned in `failed` with no text, so the admin writes it instead.
 */
export async function draftAnnouncementTranslations(input: unknown): Promise<DraftAnnouncementResult> {
  const admin = await requireAdmin();

  const parsed = announcementDraftSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  if (!isTranslationConfigured()) return { error: "unavailable" };

  const { title, body } = parsed.data;
  const targets = parsed.data.targets.map((t) => ({
    locale: t.locale as AnnouncementTranslationLocale,
    fields: [...new Set(t.fields)],
  }));
  const calls = targets.reduce((sum, t) => sum + t.fields.length, 0);

  const [mine, everyone] = await Promise.all([
    checkRateLimit("announcementDraft", admin.id),
    checkRateLimit("translateGlobal", "all", { rate: calls }),
  ]);
  if (!mine || !everyone) return { error: "rate_limited" };

  // All in parallel: each call has its own timeout (8s), and one press must finish inside a single request.
  const results = await Promise.all(
    targets.map(async ({ locale, fields }) => {
      const [draftTitle, draftBody] = await Promise.all([
        fields.includes("title") ? draftField(title, locale, ANNOUNCEMENT_TITLE_MIN, ANNOUNCEMENT_TITLE_MAX) : undefined,
        fields.includes("body") ? draftField(body, locale, ANNOUNCEMENT_BODY_MIN, ANNOUNCEMENT_BODY_MAX) : undefined,
      ]);
      const ok = (!fields.includes("title") || draftTitle) && (!fields.includes("body") || draftBody);
      return ok
        ? { locale, draft: { locale, ...(draftTitle ? { title: draftTitle } : {}), ...(draftBody ? { body: draftBody } : {}) } }
        : { locale, draft: null };
    }),
  );

  return {
    error: null,
    drafts: results.flatMap((r) => (r.draft ? [r.draft] : [])),
    failed: results.filter((r) => !r.draft).map((r) => r.locale),
  };
}

/** One half's draft, or null when the call failed or the answer wouldn't pass the field's own bounds. */
async function draftField(
  text: string,
  locale: AnnouncementTranslationLocale,
  min: number,
  max: number,
): Promise<string | null> {
  const result = await callTranslationModel(text, locale);
  const translated = result?.translation.trim();
  if (!translated || translated.length < min || translated.length > max) return null;
  return translated;
}
