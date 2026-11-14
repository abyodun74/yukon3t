import { describe, expect, it } from "vitest";
import {
  activeGiftSection,
  chipScrollDelta,
  giftPickerSections,
  giftScrollBehavior,
  giftSectionId,
  giftSectionScrollTop,
  keyboardInset,
  toggleGiftSelection,
  universeSectionKey,
} from "@/lib/gift-picker-nav";

describe("giftPickerSections", () => {
  const universes = [{ universe: "LOVE" as const }, { universe: "CELEBRATE" as const }, { universe: "LUXURY" as const }];

  it("lists Right now, Kind words, then each universe, in render order", () => {
    const sections = giftPickerSections({ rightNow: { occasions: [], skus: [] }, kindWords: ["kw.thanks"], universes });
    expect(sections.map((s) => s.key)).toEqual(["right-now", "kind-words", "universe-love", "universe-celebrate", "universe-luxury"]);
    expect(sections[2]).toEqual({ key: "universe-love", kind: "universe", universe: "LOVE" });
  });

  it("leaves out Right now without an occasion and Kind words when there are none (a live room)", () => {
    const sections = giftPickerSections({ rightNow: null, kindWords: [], universes: [{ universe: "GAMING" }] });
    expect(sections.map((s) => s.key)).toEqual(["universe-gaming"]);
  });

  it("gives every section a stable, unique DOM id", () => {
    const ids = giftPickerSections({ rightNow: {}, kindWords: ["a"], universes }).map((s) => giftSectionId(s.key));
    expect(new Set(ids).size).toBe(ids.length);
    expect(giftSectionId(universeSectionKey("CULTURE"))).toBe("gift-section-universe-culture");
    expect(giftSectionId("right-now")).toBe("gift-section-right-now");
  });
});

describe("activeGiftSection (scroll-spy)", () => {
  const sections = [
    { key: "right-now" as const, top: 0 },
    { key: "kind-words" as const, top: 300 },
    { key: "universe-love" as const, top: 700 },
    { key: "universe-luxury" as const, top: 1400 },
  ];
  const scroll = (scrollTop: number) => ({ scrollTop, clientHeight: 400, scrollHeight: 1600 });

  it("is the first section at the top of the list", () => {
    expect(activeGiftSection(sections, scroll(0))).toBe("right-now");
  });

  it("is the last section whose top has reached the threshold line", () => {
    expect(activeGiftSection(sections, scroll(290))).toBe("kind-words");
    expect(activeGiftSection(sections, scroll(260))).toBe("right-now");
    expect(activeGiftSection(sections, scroll(800))).toBe("universe-love");
  });

  it("is the last section at the bottom of the list, even if it never reaches the top", () => {
    expect(activeGiftSection(sections, scroll(1200))).toBe("universe-luxury");
  });

  it("does not treat a list that does not scroll as 'at the bottom'", () => {
    expect(activeGiftSection(sections, { scrollTop: 0, clientHeight: 2000, scrollHeight: 2000 })).toBe("right-now");
  });

  it("is null with no sections", () => {
    expect(activeGiftSection([], scroll(0))).toBeNull();
  });
});

describe("giftSectionScrollTop", () => {
  it("puts the section's top just under the list's top edge", () => {
    // Section 500px below the region's top while scrolled 100px: scroll to 100 + 500 - 8.
    expect(giftSectionScrollTop(620, 120, 100)).toBe(592);
  });

  it("scrolls up for a section above the view and never below 0", () => {
    expect(giftSectionScrollTop(20, 120, 300)).toBe(192);
    expect(giftSectionScrollTop(120, 120, 0)).toBe(0);
  });
});

describe("giftScrollBehavior", () => {
  it("is instant under reduced motion, smooth otherwise", () => {
    expect(giftScrollBehavior(true)).toBe("auto");
    expect(giftScrollBehavior(false)).toBe("smooth");
  });
});

describe("toggleGiftSelection", () => {
  it("selects, switches and deselects on a second tap", () => {
    expect(toggleGiftSelection(null, "rose")).toBe("rose");
    expect(toggleGiftSelection("rose", "coffee")).toBe("coffee");
    expect(toggleGiftSelection("rose", "rose")).toBeNull();
  });
});

describe("chipScrollDelta", () => {
  const row = { left: 0, right: 360 };

  it("is 0 for a chip already in view", () => {
    expect(chipScrollDelta({ left: 40, right: 120 }, row)).toBe(0);
  });

  it("scrolls right for a chip past the right edge and left for one past the left edge (same in RTL)", () => {
    expect(chipScrollDelta({ left: 320, right: 420 }, row)).toBe(76);
    expect(chipScrollDelta({ left: -80, right: 10 }, row)).toBe(-96);
  });
});

describe("keyboardInset", () => {
  it("is the part of the layout viewport under the visual one (iOS keyboard)", () => {
    expect(keyboardInset({ innerHeight: 844, height: 508, offsetTop: 0 })).toBe(336);
    expect(keyboardInset({ innerHeight: 844, height: 508, offsetTop: 100 })).toBe(236);
  });

  it("ignores small differences (browser bars) and a resized layout viewport (Android)", () => {
    expect(keyboardInset({ innerHeight: 844, height: 800, offsetTop: 0 })).toBe(0);
    expect(keyboardInset({ innerHeight: 500, height: 500, offsetTop: 0 })).toBe(0);
  });
});
