"use server";

import { requireAdmin } from "@/lib/auth-guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { callTranslationModelDetailed, isTranslationConfigured } from "@/lib/translation-server";
import { announcementDraftSchema } from "@/lib/validations";
import { joinChunks, splitForTranslation, translateChunks, translatePart, type ChunkCall } from "@/lib/chunked-translation";
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_DRAFT_BUDGET_MS,
  ANNOUNCEMENT_DRAFT_CALL_TIMEOUT_MS,
  ANNOUNCEMENT_DRAFT_CHUNK_CONCURRENCY,
  ANNOUNCEMENT_DRAFT_CHUNK_MAX_CHARS,
  ANNOUNCEMENT_DRAFT_MIN_CALL_MS,
  ANNOUNCEMENT_DRAFT_MIN_RETRY_MS,
  ANNOUNCEMENT_TITLE_MAX,
  markUntranslated,
  type AnnouncementTranslationLocale,
  type DraftField,
  type DraftLanguageResult,
} from "@/lib/announcement-translations";

/**
 * Admin-only: a machine draft of an announcement's English title and/or body in ONE language, for the admin to review
 * and edit on /admin/announcements before posting or saving. The form calls this once per language, one after
 * another, showing each language's progress; one language failing loses nothing else. Never stores or posts
 * anything: it only returns text, and the form (applyDrafts) puts it only into halves that are still empty, so
 * nothing the admin typed is replaced.
 *
 * Time: everything here finishes within ANNOUNCEMENT_DRAFT_BUDGET_MS of the call starting (the numbers and why are in
 * src/lib/announcement-translations.ts). The title is one model call; the body is split at paragraph/sentence
 * boundaries into chunks (src/lib/chunked-translation.ts) translated in parallel, each with its own timeout and one
 * retry of a transient failure, and put back together in order with the original line breaks. A chunk that still
 * can't be done in time comes back as its English, wrapped in the "not translated yet" marker, and the answer is
 * flagged `partial`: the admin completes it (posting refuses the marker). Only a body with no chunk done at all
 * counts as failed.
 *
 * Limits: one announcementDraft unit per call (per language), and one translateGlobal unit per model call (the
 * planned calls up front, each retry before it is made); both fail closed. Reuses the post/comment translation model
 * call (same OpenAI key and model; the text travels as a JSON data field; links/@mentions/#hashtags kept).
 */
export async function draftAnnouncementTranslation(input: unknown): Promise<DraftLanguageResult> {
  const startedAt = Date.now();
  const admin = await requireAdmin();

  const parsed = announcementDraftSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  if (!isTranslationConfigured()) return { error: "unavailable" };

  const { title, body } = parsed.data;
  const locale = parsed.data.locale as AnnouncementTranslationLocale;
  const fields = [...new Set(parsed.data.fields)] as DraftField[];
  const wantTitle = fields.includes("title");
  const chunked = fields.includes("body") ? splitForTranslation(body, ANNOUNCEMENT_DRAFT_CHUNK_MAX_CHARS) : null;
  const plannedCalls = (wantTitle ? 1 : 0) + (chunked?.chunks.length ?? 0);

  const [mine, everyone] = await Promise.all([
    checkRateLimit("announcementDraft", admin.id),
    checkRateLimit("translateGlobal", "all", { rate: plannedCalls }),
  ]);
  if (!mine || !everyone) return { error: "rate_limited" };

  const call: ChunkCall = async (text, timeoutMs) => {
    const result = await callTranslationModelDetailed(text, locale, { timeoutMs });
    return result.ok ? { ok: true, translation: result.translation } : { ok: false, retryable: result.retryable };
  };
  const options = {
    deadline: startedAt + ANNOUNCEMENT_DRAFT_BUDGET_MS,
    now: () => Date.now(),
    callTimeoutMs: ANNOUNCEMENT_DRAFT_CALL_TIMEOUT_MS,
    minCallMs: ANNOUNCEMENT_DRAFT_MIN_CALL_MS,
    minRetryMs: ANNOUNCEMENT_DRAFT_MIN_RETRY_MS,
    // A retry is one more model call: charged before it is made, and not made if the ceiling refuses it.
    allowRetry: () => checkRateLimit("translateGlobal", "all"),
    concurrency: ANNOUNCEMENT_DRAFT_CHUNK_CONCURRENCY,
  };

  const [draftTitle, bodyParts] = await Promise.all([
    wantTitle ? translatePart(title, call, options) : Promise.resolve(null),
    chunked ? translateChunks(chunked.chunks, call, options) : Promise.resolve([] as (string | null)[]),
  ]);

  const failed: DraftField[] = [];
  const tooLong: DraftField[] = [];
  const result: Extract<DraftLanguageResult, { error: null }> = { error: null, locale, failed, partial: null, tooLong };

  if (wantTitle) {
    if (draftTitle) {
      result.title = draftTitle;
      if (draftTitle.length > ANNOUNCEMENT_TITLE_MAX) tooLong.push("title");
    } else {
      failed.push("title");
    }
  }
  if (chunked) {
    const done = bodyParts.filter((part) => part !== null).length;
    const total = chunked.chunks.length;
    if (done === 0) {
      failed.push("body");
    } else {
      const draftBody = joinChunks(chunked, bodyParts, markUntranslated).trim();
      result.body = draftBody;
      if (done < total) result.partial = { done, total };
      if (draftBody.length > ANNOUNCEMENT_BODY_MAX) tooLong.push("body");
    }
  }
  return result;
}
