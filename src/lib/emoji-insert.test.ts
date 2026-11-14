import { describe, expect, it } from "vitest";
import {
  RECENT_EMOJI_MAX,
  RECENT_EMOJI_STORAGE_KEY,
  insertAtSelection,
  parseRecentEmoji,
  pushRecentEmoji,
  readRecentEmoji,
  snapToCharacter,
  writeRecentEmoji,
} from "@/lib/emoji-insert";

const FAMILY = "👨‍👩‍👧"; // a ZWJ sequence: 8 UTF-16 units, one character
const FLAG = "🇳🇬"; // two regional indicators: 4 units, one character

describe("insertAtSelection", () => {
  it("inserts at the caret and puts the caret after the emoji", () => {
    expect(insertAtSelection("hello world", { start: 5, end: 5 }, "🔥")).toEqual({ text: "hello🔥 world", caret: 7 });
  });

  it("appends when the field never had a caret", () => {
    expect(insertAtSelection("hi", null, "😂")).toEqual({ text: "hi😂", caret: 4 });
  });

  it("replaces a selection, whichever way it was made", () => {
    expect(insertAtSelection("good day", { start: 0, end: 4 }, "👍")).toEqual({ text: "👍 day", caret: 2 });
    expect(insertAtSelection("good day", { start: 4, end: 0 }, "👍")).toEqual({ text: "👍 day", caret: 2 });
  });

  it("never splits a surrogate pair", () => {
    // Offset 1 is between the two halves of 😀.
    expect(insertAtSelection("😀", { start: 1, end: 1 }, "!")).toEqual({ text: "!😀", caret: 1 });
    expect(snapToCharacter("😀", 1, 1)).toBe(2);
  });

  it("never splits a ZWJ sequence or a flag", () => {
    const text = `a${FAMILY}b`;
    const inside = 1 + 3; // in the middle of the family
    expect(insertAtSelection(text, { start: inside, end: inside }, "X")).toEqual({ text: `aX${FAMILY}b`, caret: 2 });
    const selection = insertAtSelection(text, { start: inside, end: inside + 1 }, "X");
    expect(selection).toEqual({ text: "aXb", caret: 2 });
    expect(insertAtSelection(FLAG, { start: 2, end: 2 }, "!")).toEqual({ text: `!${FLAG}`, caret: 1 });
  });

  it("inserts a ZWJ emoji whole and counts its UTF-16 length for the caret", () => {
    expect(insertAtSelection("hey ", { start: 4, end: 4 }, FAMILY)).toEqual({ text: `hey ${FAMILY}`, caret: 4 + FAMILY.length });
  });

  it("refuses an emoji that would pass the length cap instead of cutting it", () => {
    expect(insertAtSelection("abc", null, "😀", 4)).toBeNull();
    expect(insertAtSelection("abc", { start: 0, end: 1 }, "😀", 4)).toEqual({ text: "😀bc", caret: 2 });
  });
});

describe("recently used emoji", () => {
  it("moves a used emoji to the front, without duplicates, capped", () => {
    expect(pushRecentEmoji(["😂", "🔥"], "🔥")).toEqual(["🔥", "😂"]);
    expect(pushRecentEmoji([], FAMILY)).toEqual([FAMILY]);
    const many = Array.from({ length: RECENT_EMOJI_MAX }, (_, i) => String.fromCodePoint(0x1f600 + i));
    const next = pushRecentEmoji(many, "❤️");
    expect(next).toHaveLength(RECENT_EMOJI_MAX);
    expect(next[0]).toBe("❤️");
    expect(next).not.toContain(many[many.length - 1]);
    expect(pushRecentEmoji(["😂"], "  ")).toEqual(["😂"]);
  });

  it("reads back only a clean list from storage", () => {
    expect(parseRecentEmoji(null)).toEqual([]);
    expect(parseRecentEmoji("not json")).toEqual([]);
    expect(parseRecentEmoji('{"a":1}')).toEqual([]);
    expect(parseRecentEmoji(JSON.stringify(["😂", 3, "", "😂", "x".repeat(40), "🔥"]))).toEqual(["😂", "🔥"]);
  });

  it("never throws when storage is missing or blocked", () => {
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(readRecentEmoji(throwing)).toEqual([]);
    expect(() => writeRecentEmoji(throwing, ["😂"])).not.toThrow();
    expect(readRecentEmoji(null)).toEqual([]);

    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    writeRecentEmoji(storage, ["🔥", "😂"]);
    expect(store.has(RECENT_EMOJI_STORAGE_KEY)).toBe(true);
    expect(readRecentEmoji(storage)).toEqual(["🔥", "😂"]);
  });
});
