// Source-level checks used by the "no bouncing on open" guard tests (sheet-springs.test.ts, gift-picker-layout.test.ts).
// Pure string analysis of component source; nothing here runs in the app.
//
// The rule they enforce follows motion's own spring resolution (motion-dom's getSpringOptions, motion 14): ANY of
// stiffness / damping / mass makes a spring physics-based, defaults stiffness 100, damping 10, mass 1, and then
// `duration`/`bounce` are ignored. So `{ type: "spring", damping: 1, duration: 0.3 }` is a damping RATIO of
// 1 / (2 * sqrt(100)) = 0.05: a long wobble, not "critically damped". Without physics keys, `bounce` decides
// (defaults to 0.3 when only a duration is given); only `bounce <= 0` never overshoots.

const NUM = (literal: string, key: string): number | undefined => {
  const m = literal.match(new RegExp(`\\b${key}:\\s*(-?[0-9.]+)`));
  return m ? Number(m[1]) : undefined;
};

/** Every `{ ... type: "spring" ... }` object literal in `source` (flat literals, no nested braces). */
export function springLiterals(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/type:\s*["']spring["']/g)) {
    const at = m.index ?? 0;
    const open = source.lastIndexOf("{", at);
    const close = source.indexOf("}", at);
    out.push(source.slice(open, close + 1));
  }
  return out;
}

/** True when a spring transition literal would overshoot its target (damping ratio below 1). */
export function springOvershoots(literal: string): boolean {
  const stiffness = NUM(literal, "stiffness");
  const damping = NUM(literal, "damping");
  const mass = NUM(literal, "mass");
  if (stiffness !== undefined || damping !== undefined || mass !== undefined) {
    const ratio = (damping ?? 10) / (2 * Math.sqrt((stiffness ?? 100) * (mass ?? 1)));
    return !(ratio >= 1);
  }
  const bounce = NUM(literal, "bounce");
  return bounce === undefined || bounce > 0;
}

/** True when a drag constraint spring (`bounceStiffness`/`bounceDamping`, motion's defaults 500/10) would wobble. */
export function dragBounceOvershoots(literal: string): boolean {
  const stiffness = NUM(literal, "bounceStiffness") ?? 500;
  const damping = NUM(literal, "bounceDamping") ?? 10;
  return damping / (2 * Math.sqrt(stiffness)) < 1;
}

/** Every `ease: [x1, y1, x2, y2]` cubic-bezier in `source`. */
export function bezierEases(source: string): number[][] {
  return [...source.matchAll(/ease:\s*\[([^\]]+)\]/g)].map((m) => m[1].split(",").map((n) => Number(n.trim())));
}

/** A cubic-bezier overshoots when either y control point leaves 0..1. */
export function bezierOvershoots([, y1, , y2]: number[]): boolean {
  return y1 < 0 || y1 > 1 || y2 < 0 || y2 > 1;
}

/** Every CSS `cubic-bezier(x1, y1, x2, y2)` in `source`, as numbers. */
export function cssBeziers(source: string): number[][] {
  return [...source.matchAll(/cubic-bezier\(([^)]+)\)/g)].map((m) => m[1].split(",").map((n) => Number(n.trim())));
}

/** Every number a `scale` / `scaleX` / `scaleY` key takes in a motion target literal (single value or keyframes). */
export function motionScaleValues(literal: string): number[] {
  const out: number[] = [];
  for (const m of literal.matchAll(/\bscale[XY]?:\s*(\[[^\]]*\]|-?[0-9.]+)/g)) {
    for (const n of m[1].replace(/[[\]]/g, "").split(",")) if (n.trim() !== "") out.push(Number(n.trim()));
  }
  return out;
}

/** `name -> scale values in keyframe order` for every `@keyframes` block in CSS that scales (via transform or `scale:`). */
export function keyframeScales(css: string): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
    // Walk braces to the end of this @keyframes block.
    let depth = 0;
    let end = m.index! + m[0].length - 1;
    for (; end < css.length; end++) {
      if (css[end] === "{") depth++;
      else if (css[end] === "}" && --depth === 0) break;
    }
    const body = css.slice(m.index!, end);
    const values = [...body.matchAll(/(?:\bscale\(|\bscale:\s*)(-?[0-9.]+)/g)].map((v) => Number(v[1]));
    if (values.length > 0) out.set(m[1], values);
  }
  return out;
}

/** True when some intermediate value passes outside the range between the first and last one (overshoot-and-settle). */
export function keyframesOvershoot(values: number[]): boolean {
  if (values.length < 3) return false;
  const lo = Math.min(values[0], values[values.length - 1]);
  const hi = Math.max(values[0], values[values.length - 1]);
  return values.slice(1, -1).some((v) => v < lo || v > hi);
}
