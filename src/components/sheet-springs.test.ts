import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bezierEases, bezierOvershoots, dragBounceOvershoots, springLiterals, springOvershoots } from "./motion-guard";

// Opening a sheet or dialog must never bounce (owner, 2026-11-13: the gift picker still bounced on open after an
// earlier "damping: 1" fix, because motion reads `damping` as the raw physics coefficient, not a ratio).
describe("motion-guard", () => {
  it("treats a `damping: 1` spring as the wobble it is (ratio 0.05 with motion's default stiffness)", () => {
    expect(springOvershoots('{ type: "spring", damping: 1, duration: 0.3 }')).toBe(true);
    expect(springOvershoots('{ type: "spring", damping: 0.8, duration: 0.3 }')).toBe(true);
    expect(springOvershoots('{ type: "spring", duration: 0.3 }')).toBe(true);
    expect(springOvershoots('{ type: "spring", stiffness: 500, damping: 25 }')).toBe(true);
    expect(springOvershoots('{ type: "spring", stiffness: 400, damping: 40 }')).toBe(false);
    expect(springOvershoots('{ type: "spring", bounce: 0, visualDuration: 0.3 }')).toBe(false);
    expect(bezierOvershoots([0.34, 1.56, 0.64, 1])).toBe(true);
    expect(bezierOvershoots([0.32, 0.72, 0, 1])).toBe(false);
    expect(dragBounceOvershoots("{ bounceStiffness: 600, bounceDamping: 50 }")).toBe(false);
    expect(dragBounceOvershoots("{ bounceStiffness: 600 }")).toBe(true);
  });
});

describe("sheet.tsx open/close motion", () => {
  const source = readFileSync(join(__dirname, "sheet.tsx"), "utf8");

  it("has no overshooting spring", () => {
    for (const literal of springLiterals(source)) expect(springOvershoots(literal), literal).toBe(false);
  });

  it("enters along non-overshooting curves", () => {
    const eases = bezierEases(source);
    expect(eases.length).toBeGreaterThanOrEqual(2);
    for (const ease of eases) expect(bezierOvershoots(ease), ease.join(",")).toBe(false);
  });

  it("gives every animated panel an explicit transition (motion's default for y/scale is an underdamped spring)", () => {
    const animated = source.match(/\banimate=\{/g)?.length ?? 0;
    const transitions = source.match(/\btransition=\{/g)?.length ?? 0;
    expect(animated).toBeGreaterThan(0);
    expect(transitions).toBeGreaterThanOrEqual(animated);
  });

  it("snaps back from a short drag without wobbling", () => {
    const drag = source.match(/SHEET_DRAG_TRANSITION = (\{[^}]*\})/)?.[1];
    expect(drag).toBeDefined();
    expect(dragBounceOvershoots(drag!)).toBe(false);
  });

  it("keeps the slide-up and fade", () => {
    expect(source).toMatch(/initial=\{\{ y: "100%" \}\}/);
    expect(source).toMatch(/initial=\{\{ opacity: 0 \}\}/);
  });
});
