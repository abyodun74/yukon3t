import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bezierEases, bezierOvershoots, springLiterals, springOvershoots } from "./motion-guard";

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

// Owner, 2026-11-13: no bouncing, hopping, pulsing or overshoot when the picker opens. The sheet's own slide is the only
// motion (sheet-springs.test.ts); after it the list is completely still, apart from a small press-down on a tap.
describe("gift picker stays still when it opens", () => {
  const universes = readFileSync(join(__dirname, "..", "lib", "gift-universes.ts"), "utf8");
  const sources = { "gift-picker-sheet.tsx": picker, "gift-universes.ts": universes };

  it.each(Object.entries(sources))("%s has no overshooting spring", (_, source) => {
    for (const literal of springLiterals(source)) expect(springOvershoots(literal), literal).toBe(false);
    for (const ease of bezierEases(source)) expect(bezierOvershoots(ease), ease.join(",")).toBe(false);
  });

  it.each(Object.entries(sources))("%s has no bouncing, looping or ornament animation", (_, source) => {
    expect(source).not.toMatch(/animate-(bounce|pulse|ping|spin|\[)/);
    expect(source).not.toMatch(/\binfinite\b|repeat:\s*Infinity/);
    expect(source).not.toMatch(/gift-(hop|bloom|sway|burst|reveal)\b/);
    expect(source).not.toMatch(/\b(hover:|active:|group-hover:)?scale-1\d\d\b/);
    expect(source).not.toMatch(/\btransition-(all|transform)\b/);
  });

  it("has no motion components of its own (no entrance, stagger, whileTap or layout animation)", () => {
    expect(picker).not.toMatch(/<(m|motion)\.\w+/);
    expect(picker).not.toMatch(/\b(initial|animate|whileTap|whileHover|whileInView|layout)=\{/);
    expect(picker).not.toMatch(/from "motion\/react-m"/);
  });

  it("leaves the universe styles without any CSS animation", () => {
    const section = css.slice(css.indexOf("Gift universes (Phase A"));
    expect(section).not.toMatch(/\banimation(-name)?\s*:/);
  });

  it("keeps press feedback a small, quick press-down that never grows", () => {
    const press = cssRule(".gift-picker-panel button:not(:disabled):active");
    const scale = Number(press.match(/scale\(([0-9.]+)\)/)?.[1]);
    expect(scale).toBeGreaterThanOrEqual(0.97);
    expect(scale).toBeLessThan(1);
    const timing = cssRule(".gift-picker-panel button");
    const ms = Number(timing.match(/transition-duration:\s*([0-9]+)ms/)?.[1]);
    expect(ms).toBeLessThanOrEqual(100);
    expect(timing).toMatch(/transition-timing-function:\s*ease-out/);
  });
});
