import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { captureError } from "@/lib/error-tracking";
import { checkRateLimit } from "@/lib/rate-limit";
import { getVisiblePostsWhere } from "@/lib/post-visibility";
import { getBlockedEitherWayIds } from "@/lib/blocks";
import { isHiddenUnlocked } from "@/lib/hidden-chats";
import type { Locale } from "@/lib/i18n/locales";
import {
  TRANSLATION_PROMPT_VERSION,
  TRANSLATION_KINDS,
  TRANSLATION_RESPONSE_SCHEMA,
  buildTranslationMessages,
  isSameLanguageResult,
  isTranslatable,
  parseTranslationResponse,
  protectTokens,
  restoreProtectedTokens,
  type TranslationKind,
  type TranslationOutcome,
} from "@/lib/translation";
import {
  lockedConversationIds,
  translatableCommentsWhere,
  translatableEventUpdatesWhere,
  translatableMessagesWhere,
  translatablePostsWhere,
} from "@/lib/translation-access";

// The server half of translating posts, comments and messages (rules and prompt: src/lib/translation.ts). The
// provider is OpenAI's Chat Completions API, the same account and key (OPENAI_API_KEY) the app already uses for
// moderation, embeddings and dictation, so no new processor receives anyone's text: every post, comment and message
// is already sent to OpenAI's moderation endpoint when it is written. TRANSLATION_MODEL picks the model (default
// below). Without OPENAI_API_KEY the feature is off: the Translate button isn't shown and the action answers
// "unavailable".

export const DEFAULT_TRANSLATION_MODEL = "gpt-5-mini";
const TRANSLATION_TIMEOUT_MS = 8000;
// Room for the translation of TRANSLATION_MAX_CHARS characters plus a reasoning model's (minimal) reasoning.
const TRANSLATION_MAX_COMPLETION_TOKENS = 4096;

export function isTranslationConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function translationModel(): string {
  return process.env.TRANSLATION_MODEL?.trim() || DEFAULT_TRANSLATION_MODEL;
}

/**
 * The cache key's text version: a hash of exactly the stored text (and the prompt version), so an edit, or a prompt
 * change worth re-translating for, never serves an old translation.
 */
export function translationContentHash(text: string): string {
  return createHash("sha256").update(`v${TRANSLATION_PROMPT_VERSION}\u0000${text}`).digest("hex").slice(0, 40);
}

// The original GPT-5 models take "minimal" reasoning (fast and cheap, plenty for translation); other models are sent
// no reasoning setting at all rather than one they might reject.
function reasoningSettings(model: string): Record<string, string> {
  return /^gpt-5(-mini|-nano)?(-\d{4}-\d{2}-\d{2})?$/.test(model) ? { reasoning_effort: "minimal" } : {};
}

// One report per 10 minutes per server instance, so a bad key or an outage doesn't send one Sentry event per tap.
let lastFailureReportAt = 0;
function reportTranslationFailure(reason: string, error?: unknown) {
  const now = Date.now();
  if (now - lastFailureReportAt < 10 * 60_000) return;
  lastFailureReportAt = now;
  console.error(`[translation] model call failed: ${reason}`);
  void captureError(error ?? new Error(`Translation failed: ${reason}`), { where: "callTranslationModel", reason });
}

/** One model call. Null on any failure (HTTP error, timeout, refusal, an answer not in the expected shape). */
export async function callTranslationModel(
  text: string,
  target: Locale,
): Promise<{ sourceLang: string; translation: string } | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const model = translationModel();
  const { masked, tokens } = protectTokens(text);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TRANSLATION_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: buildTranslationMessages(masked, target),
        response_format: { type: "json_schema", json_schema: TRANSLATION_RESPONSE_SCHEMA },
        max_completion_tokens: TRANSLATION_MAX_COMPLETION_TOKENS,
        ...reasoningSettings(model),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      reportTranslationFailure(`HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      reportTranslationFailure("no content");
      return null;
    }
    const parsed = parseTranslationResponse(content, masked);
    if (!parsed) {
      reportTranslationFailure("unexpected answer shape");
      return null;
    }
    return { sourceLang: parsed.sourceLang, translation: restoreProtectedTokens(parsed.translation, tokens) };
  } catch (err) {
    reportTranslationFailure(controller.signal.aborted ? "timeout" : "network error", err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

type Item = { kind: TranslationKind; id: string };
const itemKey = (item: Item) => `${item.kind}:${item.id}`;

/** The stored text of each item the viewer may have translated, keyed "kind:id". Everything else is left out. */
export async function loadTranslatableTexts(viewerId: string, items: Item[]): Promise<Map<string, string>> {
  const idsOf = (kind: TranslationKind) => [...new Set(items.filter((i) => i.kind === kind).map((i) => i.id))];
  const postIds = idsOf("post");
  const commentIds = idsOf("comment");
  const messageIds = idsOf("message");
  const eventUpdateIds = idsOf("eventUpdate");

  const needsVisibility = postIds.length > 0 || commentIds.length > 0 || eventUpdateIds.length > 0;
  const [visibleWhere, blockedIds] = await Promise.all([
    needsVisibility ? getVisiblePostsWhere(viewerId) : null,
    commentIds.length || eventUpdateIds.length ? getBlockedEitherWayIds(viewerId) : new Set<string>(),
  ]);

  const [posts, comments, messages, eventUpdates] = await Promise.all([
    postIds.length && visibleWhere
      ? prisma.post.findMany({ where: translatablePostsWhere(postIds, visibleWhere), select: { id: true, content: true } })
      : [],
    commentIds.length && visibleWhere
      ? prisma.comment.findMany({
          where: translatableCommentsWhere(commentIds, visibleWhere, blockedIds),
          select: { id: true, content: true },
        })
      : [],
    messageIds.length
      ? prisma.message.findMany({
          where: translatableMessagesWhere(messageIds, viewerId),
          select: { id: true, content: true, conversationId: true },
        })
      : [],
    eventUpdateIds.length && visibleWhere
      ? prisma.eventAnnouncement.findMany({
          where: translatableEventUpdatesWhere(eventUpdateIds, visibleWhere, blockedIds, viewerId),
          select: { id: true, text: true },
        })
      : [],
  ]);

  let locked = new Set<string>();
  if (messages.length) {
    const memberships = await prisma.conversationMember.findMany({
      where: { userId: viewerId, conversationId: { in: [...new Set(messages.map((m) => m.conversationId))] } },
      select: { conversationId: true, hiddenAt: true },
    });
    const anyHidden = memberships.some((m) => m.hiddenAt !== null);
    locked = lockedConversationIds(memberships, anyHidden ? await isHiddenUnlocked(viewerId) : true);
  }

  const texts = new Map<string, string>();
  for (const p of posts) texts.set(`post:${p.id}`, p.content);
  for (const c of comments) texts.set(`comment:${c.id}`, c.content);
  for (const m of messages) if (!locked.has(m.conversationId)) texts.set(`message:${m.id}`, m.content);
  for (const u of eventUpdates) texts.set(`eventUpdate:${u.id}`, u.text);
  return texts;
}

const SOURCE_COLUMN = {
  post: "postId",
  comment: "commentId",
  message: "messageId",
  eventUpdate: "eventAnnouncementId",
} as const;

type CachedRow = { sourceId: string; contentHash: string; sourceLang: string; translatedText: string | null };

async function loadCached(kind: TranslationKind, ids: string[], target: Locale): Promise<CachedRow[]> {
  if (!ids.length) return [];
  const column = SOURCE_COLUMN[kind];
  const rows = await prisma.contentTranslation.findMany({
    where: { [column]: { in: ids }, targetLang: target },
    select: {
      postId: true,
      commentId: true,
      messageId: true,
      eventAnnouncementId: true,
      contentHash: true,
      sourceLang: true,
      translatedText: true,
    },
  });
  return rows.map((r) => ({
    sourceId: (r[column] ?? "") as string,
    contentHash: r.contentHash,
    sourceLang: r.sourceLang,
    translatedText: r.translatedText,
  }));
}

function outcomeFromRow(row: { sourceLang: string; translatedText: string | null }): TranslationOutcome {
  return row.translatedText === null
    ? { status: "same_language" }
    : { status: "translated", text: row.translatedText, sourceLang: row.sourceLang };
}

// Two viewers (or one viewer's two tabs) asking for the same text at once share one model call on this instance.
const inFlight = new Map<string, Promise<TranslationOutcome>>();

async function translateAndStore(
  item: Item,
  text: string,
  contentHash: string,
  target: Locale,
): Promise<TranslationOutcome> {
  const result = await callTranslationModel(text, target);
  if (!result) return { status: "unavailable" };
  const same = isSameLanguageResult(result, text, target);
  const row = {
    [SOURCE_COLUMN[item.kind]]: item.id,
    contentHash,
    targetLang: target,
    sourceLang: same ? target : result.sourceLang,
    translatedText: same ? null : result.translation,
    model: translationModel(),
  };
  try {
    await prisma.contentTranslation.createMany({ data: [row], skipDuplicates: true });
    // An older version of this text (edited since) is never served again: drop its translation into this language.
    await prisma.contentTranslation.deleteMany({
      where: { [SOURCE_COLUMN[item.kind]]: item.id, targetLang: target, contentHash: { not: contentHash } },
    });
  } catch (err) {
    // The text was deleted mid-call (foreign key) or the database hiccupped: the reader still gets this answer.
    void captureError(err, { where: "translateAndStore" });
  }
  return same ? { status: "same_language" } : { status: "translated", text: result.translation, sourceLang: result.sourceLang };
}

/**
 * Translates each item into `target` for this viewer, in the same order as `items`. Items the viewer can't see,
 * held/removed content and secret-chat ciphertext are "unavailable" / "not_translatable"; cached translations are
 * served without a model call; each cache miss counts against the viewer's and the global model-call limits.
 */
export async function translateForViewer({
  viewerId,
  items,
  target,
}: {
  viewerId: string;
  items: Item[];
  target: Locale;
}): Promise<TranslationOutcome[]> {
  if (!isTranslationConfigured()) return items.map(() => ({ status: "unavailable" }));

  const texts = await loadTranslatableTexts(viewerId, items);
  const hashes = new Map<string, string>();
  for (const [key, text] of texts) if (isTranslatable(text)) hashes.set(key, translationContentHash(text));

  const cachedByKey = new Map<string, CachedRow>();
  const kinds = TRANSLATION_KINDS;
  const cachedLists = await Promise.all(
    kinds.map((kind) =>
      loadCached(
        kind,
        items.filter((i) => i.kind === kind && hashes.has(itemKey(i))).map((i) => i.id),
        target,
      ),
    ),
  );
  kinds.forEach((kind, index) => {
    for (const row of cachedLists[index]) {
      const key = `${kind}:${row.sourceId}`;
      if (hashes.get(key) === row.contentHash) cachedByKey.set(key, row);
    }
  });

  const results = new Map<string, Promise<TranslationOutcome>>();
  for (const item of items) {
    const key = itemKey(item);
    if (results.has(key)) continue;
    const text = texts.get(key);
    const hash = hashes.get(key);
    if (text === undefined) {
      results.set(key, Promise.resolve({ status: "unavailable" }));
    } else if (hash === undefined) {
      results.set(key, Promise.resolve({ status: "not_translatable" }));
    } else if (cachedByKey.has(key)) {
      results.set(key, Promise.resolve(outcomeFromRow(cachedByKey.get(key)!)));
    } else {
      const flightKey = `${key}|${hash}|${target}`;
      const existing = inFlight.get(flightKey);
      if (existing) {
        results.set(key, existing);
        continue;
      }
      const work = (async (): Promise<TranslationOutcome> => {
        const [mine, everyone] = await Promise.all([
          checkRateLimit("translateModelCall", viewerId),
          checkRateLimit("translateGlobal", "all"),
        ]);
        if (!mine || !everyone) return { status: "rate_limited" };
        return translateAndStore(item, text, hash, target);
      })().finally(() => inFlight.delete(flightKey));
      inFlight.set(flightKey, work);
      results.set(key, work);
    }
  }

  return Promise.all(items.map((item) => results.get(itemKey(item))!));
}

/** Drops every cached translation of a text that was just edited or deleted for everyone (its old wording). */
export async function deleteTranslationsOf(kind: TranslationKind, id: string): Promise<void> {
  await prisma.contentTranslation.deleteMany({ where: { [SOURCE_COLUMN[kind]]: id } });
}
