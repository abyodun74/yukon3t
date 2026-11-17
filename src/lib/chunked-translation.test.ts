import { describe, expect, it, vi } from "vitest";
import {
  joinChunks,
  splitForTranslation,
  translateChunks,
  translatePart,
  type ChunkCall,
  type ChunkRunOptions,
} from "./chunked-translation";

const reassemble = (c: ReturnType<typeof splitForTranslation>) => joinChunks(c, c.chunks.map((ch) => ch.text));

describe("splitForTranslation", () => {
  it("keeps a short text whole", () => {
    expect(splitForTranslation("Hello there.", 900)).toEqual({ lead: "", chunks: [{ text: "Hello there.", sep: "" }] });
  });

  it("cuts at paragraph breaks first and keeps the exact whitespace out of the chunks", () => {
    const text = `${"a".repeat(50)}\n\n${"b".repeat(50)}\n \n\n${"c".repeat(50)}`;
    const split = splitForTranslation(text, 60);
    expect(split.chunks.map((c) => c.text)).toEqual(["a".repeat(50), "b".repeat(50), "c".repeat(50)]);
    expect(split.chunks.map((c) => c.sep)).toEqual(["\n\n", "\n \n\n", ""]);
    expect(reassemble(split)).toBe(text);
  });

  it("packs small paragraphs together up to the limit", () => {
    const text = "One.\n\nTwo.\n\nThree.\n\nFour.";
    const split = splitForTranslation(text, 12);
    expect(split.chunks.map((c) => c.text)).toEqual(["One.\n\nTwo.", "Three.", "Four."]);
    expect(reassemble(split)).toBe(text);
  });

  it("falls back to line breaks, then sentence ends, then spaces", () => {
    const lines = `${"x".repeat(30)}\n${"y".repeat(30)}`;
    expect(splitForTranslation(lines, 40).chunks.map((c) => c.text)).toEqual(["x".repeat(30), "y".repeat(30)]);

    const sentences = "This is the first sentence. This is the second one! And a third? Yes.";
    const s = splitForTranslation(sentences, 30);
    expect(s.chunks.every((c) => c.text.length <= 30)).toBe(true);
    expect(s.chunks[0].text).toBe("This is the first sentence.");
    expect(reassemble(s)).toBe(sentences);

    const words = "alpha beta gamma delta epsilon zeta eta theta";
    const w = splitForTranslation(words, 12);
    expect(w.chunks.every((c) => c.text.length <= 12)).toBe(true);
    expect(reassemble(w)).toBe(words);
  });

  it("treats non-Latin sentence ends as boundaries (Hindi danda, Arabic question mark, CJK)", () => {
    const hindi = "यह पहला वाक्य है। यह दूसरा वाक्य है। यह तीसरा है।";
    const h = splitForTranslation(hindi, 20);
    expect(h.chunks[0].text).toBe("यह पहला वाक्य है।");
    expect(reassemble(h)).toBe(hindi);
    const arabic = "هل هذا سؤال؟ نعم هذا سؤال؟ حسنا.";
    expect(reassemble(splitForTranslation(arabic, 14))).toBe(arabic);
  });

  it("never cuts a link: a bare URL, or a Markdown link whose label has spaces and full stops", () => {
    const url = `https://yukon3t.com/whats-new?with=a.long&query=${"q".repeat(60)}`;
    const text = `Read more at ${url} today. See [the new. polls page here](https://yukon3t.com/polls) for details.`;
    const split = splitForTranslation(text, 30);
    expect(split.chunks.some((c) => c.text.includes(url))).toBe(true);
    expect(split.chunks.some((c) => c.text.includes("[the new. polls page here](https://yukon3t.com/polls)"))).toBe(true);
    expect(reassemble(split)).toBe(text);
  });

  it("keeps leading and trailing whitespace for reassembly, and an all-whitespace text has no chunks", () => {
    const text = "\n  Hello world. Again here.  \n";
    const split = splitForTranslation(text, 13);
    expect(split.lead).toBe("\n  ");
    expect(split.chunks.at(-1)?.sep).toBe("  \n");
    expect(reassemble(split)).toBe(text);
    expect(splitForTranslation("  \n ", 10)).toEqual({ lead: "  \n ", chunks: [] });
  });

  it("splits a 4000-character body with markup into a handful of in-order chunks that reassemble exactly", () => {
    const paragraph = (i: number) =>
      `**Update ${i}:** You can now add polls (see https://yukon3t.com/faq#polls-${i}) and @team will help. ` +
      `Try it today! Questions? Ask in #help.\n- point one for ${i}\n- point two for ${i}`;
    let text = "";
    for (let i = 0; text.length < 3900; i++) text += (i ? "\n\n" : "") + paragraph(i);
    text = text.slice(0, 4000).trimEnd();
    const split = splitForTranslation(text, 900);
    expect(split.chunks.length).toBeGreaterThanOrEqual(5);
    expect(split.chunks.length).toBeLessThanOrEqual(6);
    expect(split.chunks.every((c) => c.text.length <= 900 && c.text.trim() === c.text)).toBe(true);
    expect(reassemble(split)).toBe(text);
    // Translated in order: each chunk's slot is filled with its own translation.
    const upper = joinChunks(split, split.chunks.map((c) => c.text.toUpperCase()));
    expect(upper).toBe(text.toUpperCase());
  });

  it("keeps a single unbreakable run whole rather than cutting it", () => {
    const run = "x".repeat(2000);
    expect(splitForTranslation(run, 900).chunks).toEqual([{ text: run, sep: "" }]);
  });

  it("joinChunks fills a missing chunk with the replacement of its original text", () => {
    const split = splitForTranslation("First part.\n\nSecond part.", 12);
    expect(joinChunks(split, ["Primera.", null], (en) => `<<${en}>>`)).toBe("Primera.\n\n<<Second part.>>");
  });
});

function options(overrides: Partial<ChunkRunOptions> = {}): ChunkRunOptions & { concurrency: number } {
  return {
    deadline: 22_000,
    now: () => 0,
    callTimeoutMs: 15_000,
    minCallMs: 3_000,
    minRetryMs: 5_000,
    allowRetry: async () => true,
    concurrency: 3,
    ...overrides,
  };
}

describe("translatePart / translateChunks", () => {
  it("gives each call min(callTimeout, time left) and trims the answer", async () => {
    let now = 10_000;
    const call = vi.fn<ChunkCall>(async () => ({ ok: true, translation: "  hola  " }));
    expect(await translatePart("hello", call, options({ now: () => now }))).toBe("hola");
    expect(call).toHaveBeenCalledWith("hello", 12_000);
    now = 0;
    await translatePart("hello", call, options({ now: () => now }));
    expect(call).toHaveBeenLastCalledWith("hello", 15_000);
  });

  it("retries a transient failure exactly once, and only when allowed", async () => {
    const call = vi
      .fn<ChunkCall>()
      .mockResolvedValueOnce({ ok: false, retryable: true })
      .mockResolvedValueOnce({ ok: true, translation: "ok" });
    const allowRetry = vi.fn(async () => true);
    expect(await translatePart("x", call, options({ allowRetry }))).toBe("ok");
    expect(call).toHaveBeenCalledTimes(2);
    expect(allowRetry).toHaveBeenCalledTimes(1);

    const alwaysFails = vi.fn<ChunkCall>(async () => ({ ok: false, retryable: true }));
    expect(await translatePart("x", alwaysFails, options())).toBeNull();
    expect(alwaysFails).toHaveBeenCalledTimes(2);

    const refused = vi.fn<ChunkCall>(async () => ({ ok: false, retryable: true }));
    expect(await translatePart("x", refused, options({ allowRetry: async () => false }))).toBeNull();
    expect(refused).toHaveBeenCalledTimes(1);

    const permanent = vi.fn<ChunkCall>(async () => ({ ok: false, retryable: false }));
    const allow = vi.fn(async () => true);
    expect(await translatePart("x", permanent, options({ allowRetry: allow }))).toBeNull();
    expect(permanent).toHaveBeenCalledTimes(1);
    expect(allow).not.toHaveBeenCalled();
  });

  it("treats a thrown call as transient", async () => {
    const call = vi
      .fn<ChunkCall>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ ok: true, translation: "ok" });
    expect(await translatePart("x", call, options())).toBe("ok");
  });

  it("never starts a call, or a retry, without enough time left", async () => {
    const call = vi.fn<ChunkCall>(async () => ({ ok: false, retryable: true }));
    expect(await translatePart("x", call, options({ now: () => 20_000 }))).toBeNull();
    expect(call).not.toHaveBeenCalled();

    // 6s left for the first try, then the clock says only 4s are left: no retry.
    let now = 16_000;
    const slow = vi.fn<ChunkCall>(async () => {
      now = 18_000;
      return { ok: false, retryable: true };
    });
    expect(await translatePart("x", slow, options({ now: () => now }))).toBeNull();
    expect(slow).toHaveBeenCalledTimes(1);
  });

  it("translates chunks with bounded concurrency and keeps their order; failures are null", async () => {
    let inFlight = 0;
    let peak = 0;
    const call: ChunkCall = async (text) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, text === "b" ? 5 : 1));
      inFlight--;
      return text === "c" ? { ok: false, retryable: false } : { ok: true, translation: text.toUpperCase() };
    };
    const chunks = ["a", "b", "c", "d", "e"].map((text) => ({ text, sep: " " }));
    const result = await translateChunks(chunks, call, { ...options(), concurrency: 2 });
    expect(result).toEqual(["A", "B", null, "D", "E"]);
    expect(peak).toBeLessThanOrEqual(2);
  });
});
