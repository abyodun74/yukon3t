// Pure helpers for share-receiver.ts (no Capacitor import, so they run under Vitest's node environment).

/** Bytes asked for per readPendingFile call (iOS). The native side caps a chunk at 4MB. */
export const SHARE_READ_CHUNK_BYTES = 2 * 1024 * 1024;

export type ShareFileChunk = { data: string; size: number; end: boolean };

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Reads a whole file through `readChunk(offset, length)` until the native side reports its end, as Blob parts (each
 * chunk's bytes become a Blob straight away, so the decoded arrays can be collected while the rest is read). Throws
 * when a chunk makes no progress before the end, so a misbehaving reader can't loop forever.
 */
export async function readFileInChunks(
  readChunk: (offset: number, length: number) => Promise<ShareFileChunk>,
  chunkBytes: number = SHARE_READ_CHUNK_BYTES,
): Promise<Blob[]> {
  const parts: Blob[] = [];
  let offset = 0;
  for (;;) {
    const chunk = await readChunk(offset, chunkBytes);
    const bytes = base64ToBytes(chunk.data);
    if (bytes.length > 0) parts.push(new Blob([bytes]));
    offset += bytes.length;
    if (chunk.end || offset >= chunk.size) return parts;
    if (bytes.length === 0) throw new Error("share_read_stalled");
  }
}

/**
 * Runs `task` one at a time: a trigger while it is running (launch, "resume" and the yukon3t://share open can all
 * land together) runs it once more afterwards instead of in parallel, so a share that arrives mid-check is still
 * read, and two checks never race for the same one.
 */
export function createSerialRunner(task: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | null = null;
  let again = false;
  const run = (): Promise<void> => {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await task().catch(() => {});
        } while (again);
      } finally {
        running = null;
      }
    })();
    return running;
  };
  return run;
}

/** True for the yukon3t://share link the iOS Share Extension opens (when iOS lets it). */
export function isShareHandOffUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "yukon3t:" && (parsed.hostname === "share" || parsed.pathname.replace(/^\/+/, "") === "share");
  } catch {
    return false;
  }
}
