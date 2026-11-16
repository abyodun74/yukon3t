import { describe, expect, it } from "vitest";
import {
  TEXT_STORY_MAX_SLIDES,
  addSlide,
  canAddSlide,
  nextBackgroundIndex,
  postableSlides,
  removeSlide,
  slidesAfterPosting,
  textStoryExcerpt,
  textStoryNeedsCaption,
  updateSlide,
  type TextStorySlide,
} from "./story-text";

const s = (id: string, text = "", bgIndex = 0): TextStorySlide => ({ id, text, bgIndex });
const empty = () => s("fresh");

describe("text story list", () => {
  it("posts only slides with text, in order", () => {
    expect(postableSlides([s("a", "one"), s("b", "   \n"), s("c", "three")]).map((x) => x.id)).toEqual(["a", "c"]);
  });
  it("picks the next background, wrapping", () => {
    expect(nextBackgroundIndex([], 6)).toBe(0);
    expect(nextBackgroundIndex([s("a", "x", 2)], 6)).toBe(3);
    expect(nextBackgroundIndex([s("a", "x", 5)], 6)).toBe(0);
  });
  it("only adds when the active slide has text and there is room", () => {
    expect(canAddSlide([s("a", " ")], "a")).toBe("empty");
    expect(canAddSlide([s("a", "x")], "missing")).toBe("empty");
    expect(canAddSlide([s("a", "x")], "a")).toBe("ok");
    const full = Array.from({ length: TEXT_STORY_MAX_SLIDES }, (_, i) => s(`s${i}`, "x"));
    expect(canAddSlide(full, "s0")).toBe("full");
    expect(addSlide(full, s("extra"))).toHaveLength(TEXT_STORY_MAX_SLIDES);
    expect(addSlide([s("a", "x")], s("b")).map((x) => x.id)).toEqual(["a", "b"]);
  });
  it("updates one slide", () => {
    expect(updateSlide([s("a"), s("b")], "b", { text: "hi", bgIndex: 3 })).toEqual([s("a"), s("b", "hi", 3)]);
  });
  it("removes a slide and keeps a sensible active one", () => {
    const list = [s("a", "1"), s("b", "2"), s("c", "3")];
    expect(removeSlide(list, "b", "b", empty)).toEqual({ slides: [list[0], list[2]], activeId: "c" });
    expect(removeSlide(list, "c", "c", empty)).toEqual({ slides: [list[0], list[1]], activeId: "b" });
    expect(removeSlide(list, "a", "c", empty)).toEqual({ slides: [list[1], list[2]], activeId: "c" });
    expect(removeSlide([s("a", "1")], "a", "a", empty)).toEqual({ slides: [s("fresh")], activeId: "fresh" });
    expect(removeSlide(list, "zzz", "a", empty).slides).toHaveLength(3);
  });
  it("drops posted slides after a run so a retry never posts them twice", () => {
    const list = [s("a", "1"), s("b", "2"), s("c", "3"), s("d", "4")];
    const afterFail = slidesAfterPosting(list, new Set(["a", "b"]), "c", empty);
    expect(afterFail.slides.map((x) => x.id)).toEqual(["c", "d"]);
    expect(afterFail.activeId).toBe("c");
    const allDone = slidesAfterPosting(list, new Set(["a", "b", "c", "d"]), null, empty);
    expect(allDone).toEqual({ slides: [s("fresh")], activeId: "fresh" });
    expect(slidesAfterPosting(list, new Set(), null, empty).activeId).toBe("a");
  });
});

describe("textStoryExcerpt", () => {
  it("returns short text unchanged", () => {
    expect(textStoryExcerpt("hello world", 20)).toBe("hello world");
    expect(textStoryNeedsCaption("hello world", 20)).toBe(false);
  });
  it("cuts at a word boundary with an ellipsis", () => {
    const out = textStoryExcerpt("aaaa bbbb cccc dddd eeee", 12);
    expect(out).toBe("aaaa bbbb…");
    expect(textStoryNeedsCaption("aaaa bbbb cccc dddd eeee", 12)).toBe(true);
  });
  it("hard-cuts an unbroken run", () => {
    expect(textStoryExcerpt("x".repeat(50), 10)).toBe("x".repeat(10) + "…");
  });
  it("does not split emoji", () => {
    const out = textStoryExcerpt("\u{1F600}".repeat(30), 10);
    expect(out).toBe("\u{1F600}".repeat(10) + "…");
  });
  it("keeps newlines-as-whitespace boundaries", () => {
    expect(textStoryExcerpt("one two\nthree four five", 14)).toBe("one two\nthree…");
  });
});
