import { beforeEach, describe, expect, it, vi } from "vitest";

// probeStoredVideoSeconds: only our own bucket's URLs, ranged reads, null on any failure, bounded in time.

const BASE = "https://media.example.com";
let configured = true;
let file: Uint8Array;
const publicObjectSize = vi.fn();
const readObjectRange = vi.fn();

vi.mock("@/lib/storage", () => ({
  isStorageConfigured: () => configured,
  keyFromPublicUrl: (url: string) => (url.startsWith(`${BASE}/`) ? url.slice(BASE.length + 1) : null),
  publicObjectSize: (...a: unknown[]) => publicObjectSize(...a),
  readObjectRange: (...a: unknown[]) => readObjectRange(...a),
}));

const { probeStoredVideoSeconds, SERVER_DURATION_PROBE_TIMEOUT_MS } = await import("@/lib/video-duration-server");

const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const box = (type: string, payload: number[]) => [...u32(8 + payload.length), ...ascii(type), ...payload];
const mp4 = (timescale: number, duration: number) =>
  Uint8Array.from([
    ...box("ftyp", ascii("isom0000")),
    ...box("mdat", new Array(100).fill(0)),
    ...box("moov", box("mvhd", [0, 0, 0, 0, ...u32(0), ...u32(0), ...u32(timescale), ...u32(duration)])),
  ]);

beforeEach(() => {
  vi.clearAllMocks();
  configured = true;
  file = mp4(600, 600 * 75 + 400);
  publicObjectSize.mockImplementation(async () => file.length);
  readObjectRange.mockImplementation(async (_key: string, offset: number, length: number) => file.slice(offset, offset + length));
});

describe("probeStoredVideoSeconds", () => {
  it("reads a stored MP4's length in whole seconds through ranged reads of its key", async () => {
    expect(await probeStoredVideoSeconds(`${BASE}/story-video/u1/v.mp4`)).toBe(76);
    expect(publicObjectSize).toHaveBeenCalledWith("story-video/u1/v.mp4");
    for (const [key] of readObjectRange.mock.calls) expect(key).toBe("story-video/u1/v.mp4");
  });

  it("never touches a URL outside our bucket, or anything when storage isn't configured", async () => {
    expect(await probeStoredVideoSeconds("https://evil.example.com/v.mp4")).toBeNull();
    expect(await probeStoredVideoSeconds(null)).toBeNull();
    configured = false;
    expect(await probeStoredVideoSeconds(`${BASE}/story-video/u1/v.mp4`)).toBeNull();
    expect(publicObjectSize).not.toHaveBeenCalled();
    expect(readObjectRange).not.toHaveBeenCalled();
  });

  it("answers null for a missing object, a failed read, a throw, or a non-MP4 file", async () => {
    publicObjectSize.mockResolvedValueOnce(null);
    expect(await probeStoredVideoSeconds(`${BASE}/a.mp4`)).toBeNull();
    readObjectRange.mockResolvedValueOnce(null);
    expect(await probeStoredVideoSeconds(`${BASE}/a.mp4`)).toBeNull();
    publicObjectSize.mockRejectedValueOnce(new Error("r2 down"));
    expect(await probeStoredVideoSeconds(`${BASE}/a.mp4`)).toBeNull();
    file = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, ...new Array(40).fill(0)]);
    expect(await probeStoredVideoSeconds(`${BASE}/a.webm`)).toBeNull();
  });

  it("gives up after its time limit", async () => {
    vi.useFakeTimers();
    try {
      publicObjectSize.mockImplementation(() => new Promise(() => {}));
      const pending = probeStoredVideoSeconds(`${BASE}/slow.mp4`);
      await vi.advanceTimersByTimeAsync(SERVER_DURATION_PROBE_TIMEOUT_MS + 1);
      expect(await pending).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
