import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The gift picker must fit the visible screen: a bounded panel, one scroll region, and a footer outside it that always
// holds Send (owner report: the list ran past the screen and Send was unreachable).
const picker = readFileSync(join(__dirname, "gift-picker-sheet.tsx"), "utf8");
const sheet = readFileSync(join(__dirname, "sheet.tsx"), "utf8");
const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

function cssRule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
}

describe("gift picker layout", () => {
  it("bounds the panel to the visible viewport (dvh, notch, keyboard) as a flex column", () => {
    expect(picker).toMatch(/panelClassName="gift-picker-panel/);
    const rule = cssRule(".gift-picker-panel");
    expect(rule).toMatch(/max-height:[^;]*100dvh/);
    expect(rule).toMatch(/safe-area-inset-top/);
    expect(rule).toMatch(/--gift-vvh/);
    expect(rule).toMatch(/flex-direction: column/);
    expect(picker).toMatch(/bodyClassName="flex min-h-0 flex-1 flex-col"/);
  });

  it("has one scroll region with overflow-y-auto and min-h-0, labelled", () => {
    const tag = picker.match(/<div\s+ref=\{scrollRef\}[\s\S]*?>/)?.[0] ?? "";
    expect(tag).toMatch(/role="region"/);
    expect(tag).toMatch(/aria-label=\{t\.giftListLabel\}/);
    expect(tag).toMatch(/overflow-y-auto/);
    expect(tag).toMatch(/min-h-0/);
    expect(tag).toMatch(/flex-1/);
    expect(picker.match(/overflow-y-auto/g)).toHaveLength(1);
    expect(cssRule(".gift-picker-scroll")).toMatch(/overscroll-behavior: contain/);
  });

  it("keeps the Send button and the note in a footer outside the scroll region", () => {
    const scrollStart = picker.indexOf("data-gift-scroll");
    const footerStart = picker.indexOf("data-gift-footer");
    expect(scrollStart).toBeGreaterThan(0);
    expect(footerStart).toBeGreaterThan(scrollStart);
    // The scroll region's markup ends before the footer begins (the footer is its sibling, not its child).
    const between = picker.slice(scrollStart, footerStart);
    const opens = (between.match(/<div\b/g) ?? []).length;
    const closes = (between.match(/<\/div>/g) ?? []).length;
    expect(closes).toBeGreaterThan(opens - 1);
    const footer = picker.slice(footerStart);
    expect(footer).toMatch(/onClick=\{send\}/);
    expect(footer).toMatch(/id="gift-note"/);
    expect(footer).toMatch(/shrink-0/);
    expect(picker.slice(0, footerStart)).not.toMatch(/onClick=\{send\}/);
  });

  it("drags to dismiss from the handle only, so the list scrolls", () => {
    expect(picker).toMatch(/\bdragFromHandle\b/);
    expect(sheet).toMatch(/dragListener=\{!dragFromHandle\}/);
  });

  it("has section chips that point at their sections", () => {
    expect(picker).toMatch(/aria-controls=\{giftSectionId\(section\.key\)\}/);
    expect(picker).toMatch(/aria-current=\{current \? "true" : undefined\}/);
    expect(picker).toMatch(/id=\{giftSectionId\(section\.key\)\}/);
  });

  it("never loads the full-size raster art in the list (thumbnails, lazy)", () => {
    expect(picker).not.toMatch(/\beager\b/);
  });
});
