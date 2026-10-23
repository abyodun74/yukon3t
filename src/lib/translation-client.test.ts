import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslationClient, textFingerprint, translationCacheKey, type SendBatch } from "./translation-client";

describe("translation client cache keys", () => {
  it("changes when the text, the language or the item changes", () => {
    const item = { kind: "post" as const, id: "p1" };
    const base = translationCacheKey(item, "en", "Hola");
    expect(translationCacheKey(item, "en", "Hola")).toBe(base);
    expect(translationCacheKey(item, "en", "Hola!")).not.toBe(base);
    expect(translationCacheKey(item, "fr", "Hola")).not.toBe(base);
    expect(translationCacheKey({ kind: "comment", id: "p1" }, "en", "Hola")).not.toBe(base);
    expect(textFingerprint("abc")).toBe(textFingerprint("abc"));
  });
});

describe("createTranslationClient", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("batches requests made together, dedupes repeats and caches results", async () => {
    const send = vi.fn<SendBatch>(async (items) => ({
      error: null,
      results: items.map((i) => ({ status: "translated" as const, text: `T(${i.id})`, sourceLang: "es" })),
    }));
    const client = createTranslationClient(send);
    const a = client.request({ kind: "post", id: "a" }, "en", "Hola");
    const b = client.request({ kind: "comment", id: "b" }, "en", "Adiós");
    const again = client.request({ kind: "post", id: "a" }, "en", "Hola");
    await vi.runAllTimersAsync();
    expect(await a).toEqual({ status: "translated", text: "T(a)", sourceLang: "es" });
    expect(await b).toMatchObject({ text: "T(b)" });
    expect(await again).toEqual(await a);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toEqual([
      { kind: "post", id: "a" },
      { kind: "comment", id: "b" },
    ]);

    client.request({ kind: "post", id: "a" }, "en", "Hola");
    await vi.runAllTimersAsync();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("splits more than TRANSLATION_BATCH_MAX items into several requests", async () => {
    const send = vi.fn<SendBatch>(async (items) => ({
      error: null,
      results: items.map(() => ({ status: "same_language" as const })),
    }));
    const client = createTranslationClient(send);
    const all = Array.from({ length: 12 }, (_, i) => client.request({ kind: "message", id: `m${i}` }, "en", `t${i}`));
    await vi.runAllTimersAsync();
    await Promise.all(all);
    expect(send.mock.calls.map((call) => call[0].length)).toEqual([10, 2]);
  });

  it("maps request-level errors to every item and doesn't cache failures", async () => {
    const send = vi
      .fn<SendBatch>()
      .mockResolvedValueOnce({ error: "rate_limited", results: [] })
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ error: null, results: [{ status: "same_language" }] });
    const client = createTranslationClient(send);
    const item = { kind: "post" as const, id: "p" };

    const first = client.request(item, "en", "Hola");
    await vi.runAllTimersAsync();
    expect(await first).toEqual({ status: "rate_limited" });

    const second = client.request(item, "en", "Hola");
    await vi.runAllTimersAsync();
    expect(await second).toEqual({ status: "unavailable" });

    const third = client.request(item, "en", "Hola");
    await vi.runAllTimersAsync();
    expect(await third).toEqual({ status: "same_language" });
    expect(send).toHaveBeenCalledTimes(3);
  });
});
