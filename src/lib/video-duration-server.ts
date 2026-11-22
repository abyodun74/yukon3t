import { isStorageConfigured, keyFromPublicUrl, publicObjectSize, readObjectRange } from "@/lib/storage";
import { readMp4DurationSeconds, wholeVideoSeconds } from "@/lib/mp4-duration";

/** The most time a server-side length read may add to a request (it only runs when the client couldn't read it). */
export const SERVER_DURATION_PROBE_TIMEOUT_MS = 4_000;

/**
 * A stored video's length in whole seconds, read on the server from the file's MP4 / QuickTime container in R2
 * (src/lib/mp4-duration.ts over ranged GETs: a few small reads, never the whole file), or null: not one of our bucket's
 * URLs, storage not configured, not an MP4/MOV (a WebM), no length recorded, R2 unreachable, or slower than
 * SERVER_DURATION_PROBE_TIMEOUT_MS. The fallback for a video whose length the phone couldn't read (createStory, and a
 * Story reposted to Feed / Muse / a Circle, actions/story-reshare.ts). Never throws.
 */
export async function probeStoredVideoSeconds(url: string | null | undefined): Promise<number | null> {
  if (!url || !isStorageConfigured()) return null;
  const key = keyFromPublicUrl(url);
  if (!key) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), SERVER_DURATION_PROBE_TIMEOUT_MS);
  });
  const probe = (async () => {
    const size = await publicObjectSize(key);
    if (size === null) return null;
    return wholeVideoSeconds(await readMp4DurationSeconds((offset, length) => readObjectRange(key, offset, length), size));
  })().catch(() => null);
  try {
    return await Promise.race([probe, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
