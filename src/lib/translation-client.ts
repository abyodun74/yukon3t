import { TRANSLATION_BATCH_MAX, type TranslationKind, type TranslationOutcome } from "@/lib/translation";

// The browser half of translation requests: one shared, per-page cache and a batcher, so several texts scrolling into
// view together (auto-translate) go to the server as one request instead of one Server Action each (Server Actions
// from one page run one at a time), and the same text asked for twice (a post shown in two places, a tap while its
// auto-translation is still on the way) is fetched once. Failures are not cached, so a later tap retries.

export type TranslationItem = { kind: TranslationKind; id: string };
export type SendBatch = (items: TranslationItem[]) => Promise<{
  error: "invalid" | "rate_limited" | "unavailable" | null;
  results: TranslationOutcome[];
}>;

/** A short, stable fingerprint of a text, so an edited text is a different cache entry. FNV-1a, 32 bits. */
export function textFingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length}.${(hash >>> 0).toString(36)}`;
}

export function translationCacheKey(item: TranslationItem, locale: string, text: string): string {
  return `${item.kind}:${item.id}:${locale}:${textFingerprint(text)}`;
}

const BATCH_DELAY_MS = 40;

export function createTranslationClient(send: SendBatch) {
  const cache = new Map<string, Promise<TranslationOutcome>>();
  let queue: { item: TranslationItem; resolve: (outcome: TranslationOutcome) => void }[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  async function drain() {
    if (running) return;
    running = true;
    try {
      while (queue.length) {
        const batch = queue.slice(0, TRANSLATION_BATCH_MAX);
        queue = queue.slice(TRANSLATION_BATCH_MAX);
        let outcomes: TranslationOutcome[];
        try {
          const response = await send(batch.map((entry) => entry.item));
          outcomes =
            response.error === null && response.results.length === batch.length
              ? response.results
              : batch.map(() => ({ status: response.error === "rate_limited" ? "rate_limited" : "unavailable" }));
        } catch {
          outcomes = batch.map(() => ({ status: "unavailable" }));
        }
        batch.forEach((entry, index) => entry.resolve(outcomes[index]));
      }
    } finally {
      running = false;
    }
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      void drain();
    }, BATCH_DELAY_MS);
  }

  return {
    /** The translation of `item` (whose current text is `text`) into `locale`, from the cache when already asked. */
    request(item: TranslationItem, locale: string, text: string): Promise<TranslationOutcome> {
      const key = translationCacheKey(item, locale, text);
      const cached = cache.get(key);
      if (cached) return cached;
      const promise = new Promise<TranslationOutcome>((resolve) => {
        queue.push({ item, resolve });
        schedule();
      }).then((outcome) => {
        if (outcome.status === "unavailable" || outcome.status === "rate_limited") cache.delete(key);
        return outcome;
      });
      cache.set(key, promise);
      return promise;
    },
  };
}
