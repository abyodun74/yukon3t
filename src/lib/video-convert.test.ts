import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  advanceConversion,
  isCloudflareStreamUrl,
  isMovUrl,
  mp4KeyForMovKey,
  MAX_CONVERSION_ATTEMPTS,
  type ConversionState,
} from "./video-convert";

const BASE = "https://media.example.com";
const SRC = `${BASE}/post-video/user1/abc.mov`;
const DL = "https://customer-x.cloudflarestream.com/uid1/downloads/default.mp4";

function makeDeps() {
  // vi.fn() mocks (not the bare ConversionDeps signatures) so tests can set return values
  const deps = {
    createStreamCopy: vi.fn().mockResolvedValue("uid1"),
    getStreamStatus: vi.fn().mockResolvedValue({ ready: true, failed: false }),
    requestMp4Download: vi.fn().mockResolvedValue({ status: "inprogress", url: DL }),
    getMp4Download: vi.fn().mockResolvedValue({ status: "ready", url: DL }),
    deleteStreamVideo: vi.fn().mockResolvedValue(undefined),
    keyFromPublicUrl: vi.fn((u: string) => (u.startsWith(BASE + "/") ? u.slice(BASE.length + 1) : null)),
    copyToR2: vi.fn().mockResolvedValue(`${BASE}/post-video/user1/abc.mp4`),
    deleteObject: vi.fn().mockResolvedValue(undefined),
    swapUrl: vi.fn().mockResolvedValue(1),
  };
  return deps;
}
const fresh = (over: Partial<ConversionState> = {}): ConversionState => ({ sourceUrl: SRC, streamUid: null, attempts: 0, ...over });

describe("helpers", () => {
  it("isMovUrl matches .mov only (any case, ignoring query)", () => {
    expect(isMovUrl(SRC)).toBe(true);
    expect(isMovUrl(`${BASE}/x/IMG_1.MOV?v=2`)).toBe(true);
    expect(isMovUrl(`${BASE}/x/a.mp4`)).toBe(false);
    expect(isMovUrl(`${BASE}/x/a.mov.mp4`)).toBe(false);
    expect(isMovUrl(null)).toBe(false);
    expect(isMovUrl("not a url")).toBe(false);
  });

  it("mp4KeyForMovKey keeps the owner segment and swaps only the extension", () => {
    expect(mp4KeyForMovKey("post-video/user1/abc.mov")).toBe("post-video/user1/abc.mp4");
    expect(mp4KeyForMovKey("post-video/user1/abc.MOV")).toBe("post-video/user1/abc.mp4");
    expect(mp4KeyForMovKey("post-video/user1/abc.mp4")).toBeNull();
  });

  it("only fetches the converted file from Cloudflare Stream over https", () => {
    expect(isCloudflareStreamUrl(DL)).toBe(true);
    expect(isCloudflareStreamUrl("http://customer-x.cloudflarestream.com/a.mp4")).toBe(false);
    expect(isCloudflareStreamUrl("https://evil.example.com/a.mp4")).toBe(false);
    expect(isCloudflareStreamUrl("https://cloudflarestream.com.evil.com/a.mp4")).toBe(false);
  });
});

describe("advanceConversion", () => {
  let deps: ReturnType<typeof makeDeps>;
  beforeEach(() => {
    deps = makeDeps();
  });

  it("step 1: hands the .mov to Stream and remembers the uid", async () => {
    const step = await advanceConversion(fresh(), deps);
    expect(step).toEqual({ kind: "waiting", patch: { streamUid: "uid1" } });
    expect(deps.createStreamCopy).toHaveBeenCalledWith(SRC);
  });

  it("a Stream copy that can't be created counts as a failed attempt", async () => {
    deps.createStreamCopy.mockResolvedValue(null);
    const step = await advanceConversion(fresh(), deps);
    expect(step).toMatchObject({ kind: "failed", terminal: false, patch: { attempts: 1 } });
  });

  it("waits while Stream is still encoding, and on a transient status error", async () => {
    deps.getStreamStatus.mockResolvedValue({ ready: false, failed: false });
    expect(await advanceConversion(fresh({ streamUid: "uid1" }), deps)).toEqual({ kind: "waiting", patch: {} });
    deps.getStreamStatus.mockResolvedValue(null);
    expect(await advanceConversion(fresh({ streamUid: "uid1" }), deps)).toEqual({ kind: "waiting", patch: {} });
    expect(deps.copyToR2).not.toHaveBeenCalled();
  });

  it("an unreadable video fails the attempt and cleans up the Stream copy", async () => {
    deps.getStreamStatus.mockResolvedValue({ ready: false, failed: true });
    const step = await advanceConversion(fresh({ streamUid: "uid1" }), deps);
    expect(step).toMatchObject({ kind: "failed", reason: "stream_encode_failed", patch: { streamUid: null, attempts: 1 } });
    expect(deps.deleteStreamVideo).toHaveBeenCalledWith("uid1");
  });

  it("step 3: requests the MP4 download when none exists yet, then waits", async () => {
    deps.getMp4Download.mockResolvedValue({ status: "missing", url: null });
    const step = await advanceConversion(fresh({ streamUid: "uid1" }), deps);
    expect(step).toEqual({ kind: "waiting", patch: {} });
    expect(deps.requestMp4Download).toHaveBeenCalledWith("uid1");
  });

  it("waits while the MP4 download is in progress", async () => {
    deps.getMp4Download.mockResolvedValue({ status: "inprogress", url: DL });
    expect(await advanceConversion(fresh({ streamUid: "uid1" }), deps)).toEqual({ kind: "waiting", patch: {} });
    expect(deps.copyToR2).not.toHaveBeenCalled();
  });

  it("step 4: copies the MP4 to the .mp4 key, swaps the URL, deletes the .mov and the Stream copy", async () => {
    const step = await advanceConversion(fresh({ streamUid: "uid1" }), deps);
    expect(step).toEqual({ kind: "done", outputUrl: `${BASE}/post-video/user1/abc.mp4`, swapped: 1 });
    expect(deps.copyToR2).toHaveBeenCalledWith(DL, "post-video/user1/abc.mp4");
    expect(deps.swapUrl).toHaveBeenCalledWith(SRC, `${BASE}/post-video/user1/abc.mp4`);
    expect(deps.deleteObject).toHaveBeenCalledWith("post-video/user1/abc.mov");
    expect(deps.deleteObject).not.toHaveBeenCalledWith("post-video/user1/abc.mp4");
    expect(deps.deleteStreamVideo).toHaveBeenCalledWith("uid1");
  });

  it("swaps BEFORE deleting the original, so no reference ever points at a deleted file", async () => {
    const order: string[] = [];
    deps.swapUrl.mockImplementation(async () => (order.push("swap"), 1));
    deps.deleteObject.mockImplementation(async () => void order.push("delete"));
    await advanceConversion(fresh({ streamUid: "uid1" }), deps);
    expect(order.indexOf("swap")).toBeLessThan(order.indexOf("delete"));
  });

  it("content deleted mid-conversion: the new MP4 is removed too, nothing is left orphaned", async () => {
    deps.swapUrl.mockResolvedValue(0);
    const step = await advanceConversion(fresh({ streamUid: "uid1" }), deps);
    expect(step).toMatchObject({ kind: "done", swapped: 0 });
    expect(deps.deleteObject).toHaveBeenCalledWith("post-video/user1/abc.mp4");
    expect(deps.deleteObject).toHaveBeenCalledWith("post-video/user1/abc.mov");
  });

  it("a failed copy keeps the original .mov and the Stream copy for the retry", async () => {
    deps.copyToR2.mockRejectedValue(new Error("network"));
    const step = await advanceConversion(fresh({ streamUid: "uid1" }), deps);
    expect(step).toMatchObject({ kind: "failed", terminal: false, patch: { attempts: 1 } });
    expect(deps.swapUrl).not.toHaveBeenCalled();
    expect(deps.deleteObject).not.toHaveBeenCalled();
    expect(deps.deleteStreamVideo).not.toHaveBeenCalled();
  });

  it("gives up for good after MAX_CONVERSION_ATTEMPTS, leaving the original playable as-is", async () => {
    deps.copyToR2.mockRejectedValue(new Error("boom"));
    const step = await advanceConversion(fresh({ streamUid: "uid1", attempts: MAX_CONVERSION_ATTEMPTS - 1 }), deps);
    expect(step).toMatchObject({ kind: "failed", terminal: true });
    expect(deps.deleteObject).not.toHaveBeenCalled();
  });

  it("refuses a download URL that isn't Cloudflare Stream's", async () => {
    deps.getMp4Download.mockResolvedValue({ status: "ready", url: "https://evil.example.com/a.mp4" });
    const step = await advanceConversion(fresh({ streamUid: "uid1" }), deps);
    expect(step).toMatchObject({ kind: "failed", reason: "unexpected_download_host" });
    expect(deps.copyToR2).not.toHaveBeenCalled();
  });

  it("ignores a .mov that isn't in our own bucket (terminal, nothing touched)", async () => {
    const step = await advanceConversion(fresh({ sourceUrl: "https://elsewhere.example.com/a.mov" }), deps);
    expect(step).toMatchObject({ kind: "failed", reason: "not_our_mov", terminal: true });
    expect(deps.createStreamCopy).not.toHaveBeenCalled();
  });
});
