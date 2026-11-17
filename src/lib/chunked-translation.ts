// Translating a long text as several shorter model calls, so no single call (and no single serverless invocation)
// has to carry a whole 4000-character body into a slow-to-write language. Pure: no network, no Prisma. The caller
// supplies the model call; announcement drafts (actions/announcement-drafts.ts) are the user today.
//
// Splitting rules (`splitForTranslation`):
// - Cut only at whitespace, preferring, in order: a blank line (paragraph), a line break, the end of a sentence,
//   then any space. A piece still longer than the limit with no whitespace at all (in practice a giant link) is kept
//   whole rather than cut, because links are masked before the model sees them anyway.
// - Never cut inside a Markdown link `[label](url)`; a bare URL has no whitespace, so it is never cut either.
// - The whitespace at each cut (newlines, blank lines, indentation) is kept OUT of the text sent to the model and put
//   back verbatim on reassembly, so the translated text has exactly the original line structure.
// - Invariant: `lead + chunks.map(c => c.text + c.sep).join("")` is the original text, character for character.
//
// No lookbehind in any pattern (older iOS WebViews reject it at load, see translation.ts).

import { runWithConcurrency } from "@/lib/live-stream-start";

/** One piece of a text to translate on its own, and the whitespace that followed it in the original. */
export type TextChunk = { text: string; sep: string };
/** A text split for translation: leading whitespace, then the chunks in order. */
export type ChunkedText = { lead: string; chunks: TextChunk[] };

// Separator patterns, strongest boundary first. Each match is the whitespace to keep out of the chunk. The sentence
// pattern's first group is the sentence-ending punctuation (plus any closing quote/bracket), which stays in the chunk.
const PARAGRAPH = /[ \t]*\n[ \t]*\n\s*/g;
const LINE = /[ \t]*\n\s*/g;
const SENTENCE = /([.!?…。！？؟।॥]+["'”’»)\]]*)(\s+)/g;
const SPACE = /\s+/g;
const LEVELS = [PARAGRAPH, LINE, SENTENCE, SPACE] as const;
const SENTENCE_LEVEL = 2;

const MARKDOWN_LINK = /\[[^\]\n]*\]\([^)\s]*\)/g;

/** The pieces of `text` (already trimmed) at one boundary level; never an empty piece. */
function piecesAt(text: string, level: number): TextChunk[] {
  const linkSpans = [...text.matchAll(MARKDOWN_LINK)].map((m) => [m.index, m.index + m[0].length] as const);
  const pattern = new RegExp(LEVELS[level].source, "gu");
  const pieces: TextChunk[] = [];
  let start = 0;
  for (const match of text.matchAll(pattern)) {
    const sepStart = match.index + (level === SENTENCE_LEVEL ? match[1].length : 0);
    const sepEnd = match.index + match[0].length;
    if (sepStart <= start || sepEnd >= text.length) continue;
    if (linkSpans.some(([a, b]) => sepStart > a && sepStart < b)) continue;
    pieces.push({ text: text.slice(start, sepStart), sep: text.slice(sepStart, sepEnd) });
    start = sepEnd;
  }
  pieces.push({ text: text.slice(start), sep: "" });
  return pieces;
}

/** Greedily joins neighbouring pieces (with the whitespace between them) while the result stays within `max`. */
function pack(pieces: TextChunk[], max: number): TextChunk[] {
  const out: TextChunk[] = [];
  let current: TextChunk | null = null;
  for (const piece of pieces) {
    if (current && current.text.length + current.sep.length + piece.text.length <= max) {
      current = { text: current.text + current.sep + piece.text, sep: piece.sep };
    } else {
      if (current) out.push(current);
      current = piece;
    }
  }
  if (current) out.push(current);
  return out;
}

/** Splits trimmed `text` into pieces of at most `max` characters (see the rules above); the last piece's sep is "". */
function splitToMax(text: string, max: number, level: number): TextChunk[] {
  if (text.length <= max || level >= LEVELS.length) return [{ text, sep: "" }];
  const pieces = piecesAt(text, level);
  if (pieces.length === 1) return splitToMax(text, max, level + 1);
  const out: TextChunk[] = [];
  for (const piece of pieces) {
    if (piece.text.length <= max) {
      out.push(piece);
      continue;
    }
    const sub = splitToMax(piece.text, max, level + 1);
    sub[sub.length - 1] = { ...sub[sub.length - 1], sep: piece.sep };
    out.push(...sub);
  }
  return pack(out, max);
}

/** Splits `text` into chunks of at most `maxChars` (except an unbreakable run), cut at natural boundaries. */
export function splitForTranslation(text: string, maxChars: number): ChunkedText {
  const lead = /^\s*/.exec(text)?.[0] ?? "";
  if (lead.length === text.length) return { lead: text, chunks: [] };
  const trail = /\s*$/.exec(text)?.[0] ?? "";
  const core = text.slice(lead.length, text.length - trail.length);
  const chunks = splitToMax(core, Math.max(1, maxChars), 0);
  chunks[chunks.length - 1] = { ...chunks[chunks.length - 1], sep: trail };
  return { lead, chunks };
}

/**
 * Puts a chunked text back together with each chunk's text replaced by `parts[i]` (the original whitespace between
 * chunks kept), or, for a chunk whose part is null, by `missing(originalChunkText)`.
 */
export function joinChunks(
  chunked: ChunkedText,
  parts: readonly (string | null)[],
  missing: (original: string) => string = (original) => original,
): string {
  return (
    chunked.lead +
    chunked.chunks.map((chunk, i) => (parts[i] ?? missing(chunk.text)) + chunk.sep).join("")
  );
}

// ---------- Running the calls inside a time budget ----------

export type ChunkCallResult = { ok: true; translation: string } | { ok: false; retryable: boolean };
/** One model call for `text`, which must give up after `timeoutMs`. */
export type ChunkCall = (text: string, timeoutMs: number) => Promise<ChunkCallResult>;

export type ChunkRunOptions = {
  /** Wall-clock time (ms, same clock as `now`) by which every call must have finished. */
  deadline: number;
  now: () => number;
  /** The most one call may take. Each call gets min(this, time left before the deadline). */
  callTimeoutMs: number;
  /** A call is not started with less than this left (it couldn't finish usefully). */
  minCallMs: number;
  /** The one retry of a transient failure is made only with at least this left. */
  minRetryMs: number;
  /** Asked before each retry (e.g. to charge it to a rate limit); false means no retry. */
  allowRetry: () => Promise<boolean>;
};

/** One text translated with its own timeout and ONE retry on a transient failure; null if it couldn't be done. */
export async function translatePart(text: string, call: ChunkCall, options: ChunkRunOptions): Promise<string | null> {
  const attempt = async (): Promise<ChunkCallResult | null> => {
    const left = options.deadline - options.now();
    if (left < options.minCallMs) return null;
    try {
      return await call(text, Math.min(options.callTimeoutMs, left));
    } catch {
      return { ok: false, retryable: true };
    }
  };
  let result = await attempt();
  if (
    result &&
    !result.ok &&
    result.retryable &&
    options.deadline - options.now() >= options.minRetryMs &&
    (await options.allowRetry())
  ) {
    result = await attempt();
  }
  const translation = result?.ok ? result.translation.trim() : "";
  return translation || null;
}

/** Every chunk translated with at most `concurrency` calls in flight; each entry is the translation or null. */
export async function translateChunks(
  chunks: readonly TextChunk[],
  call: ChunkCall,
  options: ChunkRunOptions & { concurrency: number },
): Promise<(string | null)[]> {
  const results: (string | null)[] = chunks.map(() => null);
  await runWithConcurrency(
    chunks.map((chunk, index) => ({ chunk, index })),
    options.concurrency,
    async ({ chunk, index }) => {
      results[index] = await translatePart(chunk.text, call, options);
    },
  );
  return results;
}
