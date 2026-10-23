"use server";

import { requireVerifiedUser } from "@/lib/auth-guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { translateRequestSchema } from "@/lib/validations";
import { getLocale } from "@/lib/i18n/server";
import { isTranslationConfigured, translateForViewer } from "@/lib/translation-server";
import type { TranslationOutcome } from "@/lib/translation";

/**
 * Translates posts, comments and chat messages into the caller's language (the app language of this request, the
 * same one the page is shown in). Takes ids only: the text is loaded on the server, and only what the caller may
 * already read is translated (src/lib/translation-access.ts). One result per item, in order. Called by the browser's
 * batcher (src/lib/use-content-translation.ts), at most TRANSLATION_BATCH_MAX items at a time.
 */
export async function translateContent(input: unknown): Promise<{
  error: "invalid" | "rate_limited" | "unavailable" | null;
  results: TranslationOutcome[];
}> {
  const user = await requireVerifiedUser();
  const parsed = translateRequestSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid", results: [] };
  if (!isTranslationConfigured()) return { error: "unavailable", results: [] };
  if (!(await checkRateLimit("translateRequest", user.id))) return { error: "rate_limited", results: [] };

  const target = await getLocale();
  const results = await translateForViewer({ viewerId: user.id, items: parsed.data.items, target });
  return { error: null, results };
}
