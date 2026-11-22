/**
 * A video's length read straight from its MP4 / QuickTime (.mov) container, without decoding it: the `moov` box's
 * `mvhd` (duration / timescale), or for a fragmented MP4 the `mvex` > `mehd` fragment duration. Pure and client-safe;
 * the bytes come from a reader, so the same walk runs over a picked File in the browser (blobByteReader, the fallback
 * when a phone's <video> element can't read the length, see probeVideoDuration in upload-client.ts) and over an object
 * already in R2 on the server (video-duration-server.ts, ranged GETs).
 *
 * Only the top-level box headers and the `moov` box itself are read (a few small reads whatever the file size; `moov`
 * is at the start of a "fast start" file and at the end of most phone camera recordings). Anything that isn't an
 * ISO-BMFF file (WebM, a truncated or corrupt file) answers null: the length stays unknown, never guessed.
 */

/** Reads `length` bytes at `offset` (fewer at the end of the file), or null when it can't. */
export type ByteReader = (offset: number, length: number) => Promise<Uint8Array | null>;

/** The largest `moov` box this will read (a 2-minute phone clip's is ~50-200 KB). */
export const MP4_MAX_MOOV_BYTES = 8 * 1024 * 1024;
/** Top-level boxes walked before giving up (a normal file has 3-6: ftyp, free/wide, mdat, moov, maybe udta/uuid). */
const MAX_TOP_LEVEL_BOXES = 32;
/** A length outside (0, this] is treated as unreadable rather than stored. */
const MAX_PLAUSIBLE_SECONDS = 24 * 60 * 60;

function u32(b: Uint8Array, at: number): number {
  return ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];
}

function u64(b: Uint8Array, at: number): number {
  return u32(b, at) * 2 ** 32 + u32(b, at + 4);
}

function boxType(b: Uint8Array, at: number): string | null {
  let type = "";
  for (let i = 0; i < 4; i++) {
    const c = b[at + i];
    // Box types are four printable ASCII characters (© = 0xA9 appears only inside udta, never at the top level).
    if (c === undefined || c < 0x20 || c > 0x7e) return null;
    type += String.fromCharCode(c);
  }
  return type;
}

/** The child boxes of a container payload: [type, payloadStart, payloadEnd] each. Stops at the first malformed one. */
function childBoxes(b: Uint8Array, start: number, end: number): [string, number, number][] {
  const out: [string, number, number][] = [];
  let at = start;
  while (at + 8 <= end) {
    let size = u32(b, at);
    const type = boxType(b, at + 4);
    if (!type) break;
    let header = 8;
    if (size === 1) {
      if (at + 16 > end) break;
      size = u64(b, at + 8);
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < header || at + size > end) break;
    out.push([type, at + header, at + size]);
    at += size;
  }
  return out;
}

function seconds(duration: number, timescale: number): number | null {
  if (!(timescale > 0) || !(duration > 0)) return null;
  const s = duration / timescale;
  return Number.isFinite(s) && s > 0 && s <= MAX_PLAUSIBLE_SECONDS ? s : null;
}

/** The length in a `moov` box's payload: mvhd's duration, else (fragmented MP4) mvex > mehd's. */
export function durationFromMoov(moov: Uint8Array): number | null {
  const children = childBoxes(moov, 0, moov.length);
  const mvhd = children.find(([type]) => type === "mvhd");
  if (!mvhd) return null;
  const [, p, end] = mvhd;
  const version = moov[p];
  let timescale: number;
  let duration: number;
  if (version === 1) {
    if (p + 32 > end) return null;
    timescale = u32(moov, p + 20);
    duration = u64(moov, p + 24);
    if (duration === 2 ** 64 - 1) duration = 0;
  } else {
    if (p + 20 > end) return null;
    timescale = u32(moov, p + 12);
    duration = u32(moov, p + 16);
    // All ones = "unknown" in a version 0 mvhd.
    if (duration === 0xffffffff) duration = 0;
  }
  const fromMvhd = seconds(duration, timescale);
  if (fromMvhd !== null) return fromMvhd;

  const mvex = children.find(([type]) => type === "mvex");
  if (!mvex) return null;
  const mehd = childBoxes(moov, mvex[1], mvex[2]).find(([type]) => type === "mehd");
  if (!mehd) return null;
  const [, q, mehdEnd] = mehd;
  if (moov[q] === 1) return q + 12 <= mehdEnd ? seconds(u64(moov, q + 4), timescale) : null;
  return q + 8 <= mehdEnd ? seconds(u32(moov, q + 4), timescale) : null;
}

/**
 * The container's length in seconds (fractional), or null when it isn't an MP4/QuickTime file or the length isn't
 * recorded. `totalSize` is the file's size in bytes.
 */
export async function readMp4DurationSeconds(read: ByteReader, totalSize: number): Promise<number | null> {
  if (!(totalSize >= 16)) return null;
  let offset = 0;
  for (let boxes = 0; boxes < MAX_TOP_LEVEL_BOXES && offset + 8 <= totalSize; boxes++) {
    const header = await read(offset, 16);
    if (!header || header.length < 8) return null;
    let size = u32(header, 0);
    const type = boxType(header, 4);
    if (!type) return null;
    let headerLength = 8;
    if (size === 1) {
      if (header.length < 16) return null;
      size = u64(header, 8);
      headerLength = 16;
    } else if (size === 0) {
      size = totalSize - offset;
    }
    if (size < headerLength) return null;
    if (type === "moov") {
      const payloadLength = Math.min(size, totalSize - offset) - headerLength;
      if (payloadLength <= 0 || payloadLength > MP4_MAX_MOOV_BYTES) return null;
      const moov = await read(offset + headerLength, payloadLength);
      if (!moov || moov.length < payloadLength) return null;
      return durationFromMoov(moov);
    }
    offset += size;
  }
  return null;
}

/** A ByteReader over a Blob / File (the browser's picked file; slices, never the whole file at once). */
export function blobByteReader(blob: Blob): ByteReader {
  return async (offset, length) => {
    try {
      return new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
    } catch {
      return null;
    }
  };
}

/** Whole seconds as every composer stores them (Math.round, at least 1), or null. */
export function wholeVideoSeconds(seconds: number | null): number | null {
  return seconds === null || !Number.isFinite(seconds) || seconds <= 0 ? null : Math.max(1, Math.round(seconds));
}
