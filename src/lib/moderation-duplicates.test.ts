import { describe, expect, it } from "vitest";
import { rowsByDuplicateSet, splitKeeperAndDuplicates } from "./moderation-duplicates";

const at = (iso: string) => new Date(iso);

describe("splitKeeperAndDuplicates", () => {
  it("keeps the thread with the most recent message", () => {
    const older = { id: "a", createdAt: at("2026-01-01T00:00:00Z") };
    const newer = { id: "b", createdAt: at("2026-02-01T00:00:00Z") };
    const lastMessageAt = new Map([
      ["a", at("2026-03-05T00:00:00Z")],
      ["b", at("2026-03-01T00:00:00Z")],
    ]);
    const { keeper, duplicates } = splitKeeperAndDuplicates([older, newer], lastMessageAt);
    expect(keeper.id).toBe("a");
    expect(duplicates.map((c) => c.id)).toEqual(["b"]);
  });

  it("falls back to createdAt for a thread with no messages", () => {
    const withMessages = { id: "a", createdAt: at("2026-01-01T00:00:00Z") };
    const empty = { id: "b", createdAt: at("2026-02-01T00:00:00Z") };
    const lastMessageAt = new Map([["a", at("2026-01-15T00:00:00Z")]]);
    const { keeper, duplicates } = splitKeeperAndDuplicates([withMessages, empty], lastMessageAt);
    expect(keeper.id).toBe("b");
    expect(duplicates.map((c) => c.id)).toEqual(["a"]);
  });

  it("keeps the most recently created when none has messages", () => {
    const first = { id: "a", createdAt: at("2026-01-01T00:00:00Z") };
    const second = { id: "b", createdAt: at("2026-01-02T00:00:00Z") };
    const third = { id: "c", createdAt: at("2026-01-03T00:00:00Z") };
    const { keeper, duplicates } = splitKeeperAndDuplicates([second, third, first], new Map());
    expect(keeper.id).toBe("c");
    expect(duplicates.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("keeps the one created first when last activity ties, whatever the input order", () => {
    const first = { id: "a", createdAt: at("2026-01-01T00:00:00Z") };
    const second = { id: "b", createdAt: at("2026-01-02T00:00:00Z") };
    const same = at("2026-03-01T00:00:00Z");
    const lastMessageAt = new Map([
      ["a", same],
      ["b", same],
    ]);
    expect(splitKeeperAndDuplicates([second, first], lastMessageAt).keeper.id).toBe("a");
    expect(splitKeeperAndDuplicates([first, second], lastMessageAt).keeper.id).toBe("a");
  });

  it("does not reorder the array it was given", () => {
    const input = [
      { id: "a", createdAt: at("2026-01-02T00:00:00Z") },
      { id: "b", createdAt: at("2026-01-01T00:00:00Z") },
    ];
    splitKeeperAndDuplicates(input, new Map());
    expect(input.map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("rowsByDuplicateSet", () => {
  it("returns rows in the order of each set's ids, whatever order the rows came back in", () => {
    const rows = [{ id: "c" }, { id: "a" }, { id: "d" }, { id: "b" }];
    expect(
      rowsByDuplicateSet(
        [
          ["a", "b"],
          ["c", "d"],
        ],
        rows,
      ),
    ).toEqual([
      [{ id: "a" }, { id: "b" }],
      [{ id: "c" }, { id: "d" }],
    ]);
  });

  it("drops a set left with one row after a delete in between", () => {
    const rows = [{ id: "a" }, { id: "c" }, { id: "d" }, { id: "e" }];
    expect(
      rowsByDuplicateSet(
        [
          ["a", "b"],
          ["c", "d", "e"],
        ],
        rows,
      ),
    ).toEqual([[{ id: "c" }, { id: "d" }, { id: "e" }]]);
  });

  it("keeps the remaining rows of a larger set when one is gone", () => {
    expect(rowsByDuplicateSet([["a", "b", "c"]], [{ id: "c" }, { id: "a" }])).toEqual([[{ id: "a" }, { id: "c" }]]);
  });
});
