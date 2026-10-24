import { describe, expect, it } from "vitest";
import {
  addCaption,
  captionDisplayText,
  nextExpiryAt,
  setCaptionTranslation,
  visibleCaptions,
} from "./call-caption-queue";
import { CALL_CAPTION_MAX_VISIBLE, CALL_CAPTION_VISIBLE_MS } from "./call-captions";

const pending = { status: "pending" } as const;

describe("caption queue", () => {
  it("keeps only the newest sentences, and ignores a repeated id", () => {
    let items = addCaption([], { id: "1", text: "one", translation: pending }, 0);
    items = addCaption(items, { id: "1", text: "one again", translation: pending }, 10);
    expect(items).toHaveLength(1);
    expect(items[0].original).toBe("one");
    items = addCaption(items, { id: "2", text: "two", translation: pending }, 20);
    items = addCaption(items, { id: "3", text: "three", translation: pending }, 30);
    expect(items).toHaveLength(CALL_CAPTION_MAX_VISIBLE);
    expect(items.map((i) => i.id)).toEqual(["2", "3"]);
  });

  it("fades each caption CALL_CAPTION_VISIBLE_MS after it last changed (a translation restarts its time)", () => {
    let items = addCaption([], { id: "a", text: "hola", translation: pending }, 1000);
    items = addCaption(items, { id: "b", text: "adiós", translation: pending }, 3000);
    expect(nextExpiryAt(items)).toBe(1000 + CALL_CAPTION_VISIBLE_MS);
    items = setCaptionTranslation(items, "a", { status: "translated", text: "hello" }, 5000);
    expect(nextExpiryAt(items)).toBe(3000 + CALL_CAPTION_VISIBLE_MS);
    const later = visibleCaptions(items, 3000 + CALL_CAPTION_VISIBLE_MS);
    expect(later.map((i) => i.id)).toEqual(["a"]);
    expect(visibleCaptions(later, 5000 + CALL_CAPTION_VISIBLE_MS)).toEqual([]);
    expect(nextExpiryAt([])).toBeNull();
  });

  it("returns the same array when nothing expired", () => {
    const items = addCaption([], { id: "a", text: "x", translation: pending }, 0);
    expect(visibleCaptions(items, 10)).toBe(items);
  });

  it("shows the translation, or the original on request, and the original when there is no translation", () => {
    let items = addCaption([], { id: "a", text: "¿Dónde está?", translation: pending }, 0);
    expect(captionDisplayText(items[0], false)).toBe("¿Dónde está?");
    items = setCaptionTranslation(items, "a", { status: "translated", text: "Where is it?" }, 1);
    expect(captionDisplayText(items[0], false)).toBe("Where is it?");
    expect(captionDisplayText(items[0], true)).toBe("¿Dónde está?");
    items = setCaptionTranslation(items, "a", { status: "failed" }, 2);
    expect(captionDisplayText(items[0], false)).toBe("¿Dónde está?");
    expect(setCaptionTranslation(items, "zzz", { status: "same" }, 3)).toEqual(items);
  });
});
