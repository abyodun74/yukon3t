import { describe, expect, it } from "vitest";
import {
  base64ToBytes,
  createSerialRunner,
  isShareHandOffUrl,
  readFileInChunks,
  type ShareFileChunk,
} from "@/lib/share-receiver-read";

function fakeNativeFile(content: string) {
  const bytes = Buffer.from(content, "utf8");
  const calls: { offset: number; length: number }[] = [];
  const read = async (offset: number, length: number): Promise<ShareFileChunk> => {
    calls.push({ offset, length });
    const slice = bytes.subarray(offset, offset + length);
    return { data: slice.toString("base64"), size: bytes.length, end: offset + slice.length >= bytes.length };
  };
  return { read, calls };
}

describe("base64ToBytes", () => {
  it("decodes binary data exactly", () => {
    const raw = Buffer.from([0, 1, 127, 128, 254, 255]);
    expect(Array.from(base64ToBytes(raw.toString("base64")))).toEqual([0, 1, 127, 128, 254, 255]);
  });

  it("decodes an empty string to no bytes", () => {
    expect(base64ToBytes("").length).toBe(0);
  });
});

describe("readFileInChunks", () => {
  it("reads a file across several chunks in order", async () => {
    const { read, calls } = fakeNativeFile("hello shared world");
    const parts = await readFileInChunks(read, 5);
    expect(await new Blob(parts).text()).toBe("hello shared world");
    expect(calls.map((c) => c.offset)).toEqual([0, 5, 10, 15]);
  });

  it("reads a file smaller than one chunk in a single call", async () => {
    const { read, calls } = fakeNativeFile("tiny");
    const parts = await readFileInChunks(read, 1024);
    expect(await new Blob(parts).text()).toBe("tiny");
    expect(calls).toHaveLength(1);
  });

  it("handles an empty file", async () => {
    const { read } = fakeNativeFile("");
    const parts = await readFileInChunks(read, 8);
    expect(new Blob(parts).size).toBe(0);
  });

  it("stops with an error when a chunk makes no progress before the end", async () => {
    const read = async (): Promise<ShareFileChunk> => ({ data: "", size: 10, end: false });
    await expect(readFileInChunks(read, 4)).rejects.toThrow("share_read_stalled");
  });

  it("passes a native rejection through", async () => {
    const read = async (): Promise<ShareFileChunk> => {
      throw new Error("read_failed");
    };
    await expect(readFileInChunks(read, 4)).rejects.toThrow("read_failed");
  });
});

describe("createSerialRunner", () => {
  it("never runs the task twice at once and reruns once for triggers that arrived meanwhile", async () => {
    let active = 0;
    let maxActive = 0;
    let runs = 0;
    let release: () => void = () => {};
    const run = createSerialRunner(async () => {
      runs++;
      active++;
      maxActive = Math.max(maxActive, active);
      if (runs === 1) await new Promise<void>((r) => (release = r));
      active--;
    });

    const first = run();
    void run();
    void run();
    release();
    await first;
    await run();

    expect(maxActive).toBe(1);
    // First run, one rerun for the two triggers that arrived during it, then the later trigger.
    expect(runs).toBe(3);
  });

  it("keeps working after the task throws", async () => {
    let runs = 0;
    const run = createSerialRunner(async () => {
      runs++;
      throw new Error("boom");
    });
    await run();
    await run();
    expect(runs).toBe(2);
  });
});

describe("isShareHandOffUrl", () => {
  it("accepts the Share Extension's link", () => {
    expect(isShareHandOffUrl("yukon3t://share")).toBe(true);
    expect(isShareHandOffUrl("yukon3t:///share")).toBe(true);
  });

  it("rejects other links", () => {
    expect(isShareHandOffUrl("yukon3t://open?path=/home")).toBe(false);
    expect(isShareHandOffUrl("yukon3t://call?callId=1")).toBe(false);
    expect(isShareHandOffUrl("https://yukon3t.com/share")).toBe(false);
    expect(isShareHandOffUrl("")).toBe(false);
    expect(isShareHandOffUrl(null)).toBe(false);
    expect(isShareHandOffUrl("not a url")).toBe(false);
  });
});
