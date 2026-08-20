import { describe, it, expect } from "vitest";
import { isFlagged } from "@/lib/hive";

function response(classes: Array<{ class: string; value: number }>) {
  return { output: [{ classes }] };
}

describe("isFlagged", () => {
  it("does not flag a clean result", () => {
    expect(
      isFlagged(response([{ class: "general_nsfw", value: 0.0000078 }])),
    ).toBe(false);
  });

  it("flags when general_nsfw crosses the threshold", () => {
    expect(isFlagged(response([{ class: "general_nsfw", value: 0.9 }]))).toBe(true);
  });

  it("does not flag a score just under the threshold", () => {
    expect(isFlagged(response([{ class: "general_nsfw", value: 0.74 }]))).toBe(false);
  });

  it("flags a score exactly at the threshold", () => {
    expect(isFlagged(response([{ class: "general_nsfw", value: 0.75 }]))).toBe(true);
  });

  it("ignores unrelated classes with high scores", () => {
    expect(
      isFlagged(response([{ class: "yes_smoking", value: 0.99 }])),
    ).toBe(false);
  });

  it("checks every sampled video frame, not just the first", () => {
    const data = {
      output: [
        { classes: [{ class: "general_nsfw", value: 0.01 }] },
        { classes: [{ class: "general_nsfw", value: 0.01 }] },
        { classes: [{ class: "general_nsfw", value: 0.95 }] },
      ],
    };
    expect(isFlagged(data)).toBe(true);
  });

  it("handles a missing/empty output gracefully", () => {
    expect(isFlagged({})).toBe(false);
    expect(isFlagged({ output: [] })).toBe(false);
  });
});
