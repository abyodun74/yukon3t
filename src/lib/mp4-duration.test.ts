import { describe, expect, it } from "vitest";
import { blobByteReader, durationFromMoov, readMp4DurationSeconds, wholeVideoSeconds, type ByteReader } from "@/lib/mp4-duration";

// Synthetic ISO-BMFF files: the boxes a phone camera writes (ftyp, mdat, moov > mvhd), in both orders, plus the
// 64-bit and fragmented variants and things that aren't MP4 at all.

function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}
function u64(n: number): number[] {
  return [...u32(Math.floor(n / 2 ** 32)), ...u32(n >>> 0)];
}
function ascii(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0));
}
function box(type: string, payload: number[]): number[] {
  return [...u32(8 + payload.length), ...ascii(type), ...payload];
}
function mvhd0(timescale: number, duration: number): number[] {
  return box("mvhd", [0, 0, 0, 0, ...u32(0), ...u32(0), ...u32(timescale), ...u32(duration), ...new Array(80).fill(0)]);
}
function mvhd1(timescale: number, duration: number): number[] {
  return box("mvhd", [1, 0, 0, 0, ...u64(0), ...u64(0), ...u32(timescale), ...u64(duration), ...new Array(80).fill(0)]);
}
const ftyp = box("ftyp", [...ascii("isom"), ...u32(512), ...ascii("isommp41")]);
const mdat = (bytes: number) => box("mdat", new Array(bytes).fill(7));

/** A reader over a byte array that also counts its reads (to prove the media data is never read). */
function reader(bytes: number[]) {
  const data = Uint8Array.from(bytes);
  const reads: [number, number][] = [];
  const read: ByteReader = async (offset, length) => {
    reads.push([offset, length]);
    return data.slice(offset, offset + length);
  };
  return { read, size: data.length, reads };
}

describe("readMp4DurationSeconds", () => {
  it("reads a camera recording with moov at the end, without reading the media data", async () => {
    const file = [...ftyp, ...mdat(5000), ...box("moov", mvhd0(600, 600 * 42))];
    const r = reader(file);
    expect(await readMp4DurationSeconds(r.read, r.size)).toBe(42);
    // Box headers (16 bytes each) and the moov payload only; never the 5000 bytes of mdat.
    expect(r.reads.every(([, length]) => length <= 16 || length < 200)).toBe(true);
  });

  it("reads a fast-start file (moov first) and an iPhone .mov (qt brand, 64-bit mvhd)", async () => {
    const fastStart = reader([...ftyp, ...box("moov", mvhd0(1000, 90_500)), ...mdat(100)]);
    expect(await readMp4DurationSeconds(fastStart.read, fastStart.size)).toBeCloseTo(90.5);
    const qtFtyp = box("ftyp", [...ascii("qt  "), ...u32(0), ...ascii("qt  ")]);
    const mov = reader([...qtFtyp, ...box("wide", []), ...mdat(64), ...box("moov", mvhd1(90_000, 90_000 * 117))]);
    expect(await readMp4DurationSeconds(mov.read, mov.size)).toBe(117);
  });

  it("follows a 64-bit (largesize) mdat header", async () => {
    const payload = new Array(40).fill(1);
    const bigMdat = [...u32(1), ...ascii("mdat"), ...u64(16 + payload.length), ...payload];
    const r = reader([...ftyp, ...bigMdat, ...box("moov", mvhd0(30, 30 * 12))]);
    expect(await readMp4DurationSeconds(r.read, r.size)).toBe(12);
  });

  it("reads a fragmented MP4's length from mvex > mehd when mvhd has none", async () => {
    const mehd = box("mehd", [0, 0, 0, 0, ...u32(48_000 * 20)]);
    const r = reader([...ftyp, ...box("moov", [...mvhd0(48_000, 0), ...box("mvex", mehd)]), ...box("moof", [])]);
    expect(await readMp4DurationSeconds(r.read, r.size)).toBe(20);
  });

  it("answers null for a WebM, an empty or truncated file, no moov, or no recorded length", async () => {
    const webm = reader([0x1a, 0x45, 0xdf, 0xa3, ...new Array(60).fill(0)]);
    expect(await readMp4DurationSeconds(webm.read, webm.size)).toBeNull();
    expect(await readMp4DurationSeconds(reader([]).read, 0)).toBeNull();
    const noMoov = reader([...ftyp, ...mdat(30)]);
    expect(await readMp4DurationSeconds(noMoov.read, noMoov.size)).toBeNull();
    const truncated = [...ftyp, ...box("moov", mvhd0(600, 6000))].slice(0, ftyp.length + 20);
    const t = reader(truncated);
    expect(await readMp4DurationSeconds(t.read, t.size)).toBeNull();
    const unknown = reader([...ftyp, ...box("moov", mvhd0(600, 0xffffffff))]);
    expect(await readMp4DurationSeconds(unknown.read, unknown.size)).toBeNull();
    const zeroScale = reader([...ftyp, ...box("moov", mvhd0(0, 100))]);
    expect(await readMp4DurationSeconds(zeroScale.read, zeroScale.size)).toBeNull();
  });

  it("answers null when a read fails", async () => {
    const r = reader([...ftyp, ...box("moov", mvhd0(600, 6000))]);
    expect(await readMp4DurationSeconds(async () => null, r.size)).toBeNull();
  });

  it("works over a Blob (the picked file in the browser)", async () => {
    const bytes = Uint8Array.from([...ftyp, ...mdat(10), ...box("moov", mvhd0(1000, 61_400))]);
    const blob = new Blob([bytes]);
    expect(wholeVideoSeconds(await readMp4DurationSeconds(blobByteReader(blob), blob.size))).toBe(61);
  });
});

describe("durationFromMoov / wholeVideoSeconds", () => {
  it("ignores an implausible length and rounds like the composers (at least 1)", () => {
    expect(durationFromMoov(Uint8Array.from(mvhd0(1, 200_000)))).toBeNull();
    expect(wholeVideoSeconds(59.4)).toBe(59);
    expect(wholeVideoSeconds(59.5)).toBe(60);
    expect(wholeVideoSeconds(0.2)).toBe(1);
    expect(wholeVideoSeconds(null)).toBeNull();
    expect(wholeVideoSeconds(0)).toBeNull();
  });
});
