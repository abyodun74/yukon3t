import { encodeWav, renderScore, renderScoreAsync } from "@/lib/music/synth";
import { TRACK_SCORES } from "@/lib/music/tracks";
import type { PostMusicKey } from "@/lib/post-music";

/**
 * Bump when the synthesizer itself changes how anything sounds: renders cached on a device under an older version are
 * thrown away (src/lib/post-music-player.ts). A change to a score is picked up on its own (trackCacheId hashes it).
 */
export const MUSIC_SYNTH_VERSION = 1;

/** One track as a WAV file (16-bit mono PCM): what the shared <audio> element plays from a blob: URL. */
export function renderTrackWav(key: PostMusicKey): ArrayBuffer {
  return encodeWav(renderScore(TRACK_SCORES[key]()));
}

/** The same WAV, rendered in slices that hand the main thread back (no frozen screen while a track is made). */
export async function renderTrackWavAsync(key: PostMusicKey): Promise<ArrayBuffer> {
  return encodeWav(await renderScoreAsync(TRACK_SCORES[key]()));
}

/** A short id for the exact audio a track renders to: synth version + a hash of its score. */
export function trackCacheId(key: PostMusicKey): string {
  const text = JSON.stringify(TRACK_SCORES[key]());
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${key}-v${MUSIC_SYNTH_VERSION}-${h.toString(16).padStart(8, "0")}`;
}
