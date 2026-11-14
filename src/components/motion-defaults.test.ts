import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_DEFAULT_TRANSITION } from "@/lib/motion-defaults";
import {
  bezierEases,
  bezierOvershoots,
  cssBeziers,
  dragBounceOvershoots,
  keyframeScales,
  keyframesOvershoot,
  motionScaleValues,
  springLiterals,
  springOvershoots,
} from "./motion-guard";

// Owner, 2026-11-13: no picker, sheet, menu, dialog or press may bounce anywhere in the app. This scans every source
// file, so a new component can't bring a spring or an overshooting curve back without failing here.

const SRC = join(__dirname, "..");
const files = (readdirSync(SRC, { recursive: true }) as string[])
  .map((f) => join(SRC, f))
  .filter((f) => /\.(tsx?|css)$/.test(f))
  .filter((f) => !/\.test\.tsx?$/.test(f))
  .filter((f) => !f.includes(`${sep}generated${sep}`))
  .filter((f) => !f.endsWith(`${sep}motion-guard.ts`));
const read = (f: string) => readFileSync(f, "utf8");
const rel = (f: string) => relative(SRC, f).split(sep).join("/");
const code = files.filter((f) => /\.tsx?$/.test(f)).map((f) => ({ file: rel(f), source: read(f) }));
const styles = files.filter((f) => f.endsWith(".css")).map((f) => ({ file: rel(f), source: read(f) }));
const globalsCss = read(join(SRC, "app", "globals.css"));

/**
 * Springs that are allowed, each with its reason. Every entry must still have a damping ratio >= 1 with motion's real
 * physics (springOvershoots). Empty: the app uses tweens everywhere.
 */
const SPRING_ALLOW: Record<string, string> = {};

/** `@keyframes` that may pass their end scale on the way, with the reason. Nothing that opens or closes a picker. */
const KEYFRAME_ALLOW: Record<string, string> = {
  "splash-logo-in": "the app-launch wordmark wobble, which the owner explicitly wants kept",
  "aurora-drift": "the page background's slow ambient drift loop (34-50s, infinite, reduced-motion off), not an entrance",
  "logo-aurora-drift": "the wordmark's ambient glow drift loop (9-11s, infinite, reduced-motion off), not an entrance",
};

describe("the app-wide default transition", () => {
  it("is a non-overshooting tween, not motion's default spring", () => {
    expect(APP_DEFAULT_TRANSITION.type).toBe("tween");
    expect(APP_DEFAULT_TRANSITION.duration).toBeGreaterThan(0);
    expect(APP_DEFAULT_TRANSITION.duration).toBeLessThanOrEqual(0.3);
    expect(bezierOvershoots([...APP_DEFAULT_TRANSITION.ease])).toBe(false);
    expect(APP_DEFAULT_TRANSITION).not.toHaveProperty("bounce");
    expect(APP_DEFAULT_TRANSITION).not.toHaveProperty("stiffness");
    expect(APP_DEFAULT_TRANSITION).not.toHaveProperty("damping");
  });

  it("is set on the root MotionConfig, and no other MotionConfig can replace it", () => {
    const provider = read(join(__dirname, "motion-provider.tsx"));
    expect(provider).toMatch(/<MotionConfig\b[^>]*\btransition=\{APP_DEFAULT_TRANSITION\}/);
    expect(provider).toMatch(/<MotionConfig\b[^>]*\breducedMotion="user"/);
    const others = code.filter(({ file, source }) => file !== "components/motion-provider.tsx" && /<MotionConfig\b/.test(source));
    expect(others.map((o) => o.file)).toEqual([]);
    const layout = read(join(SRC, "app", "layout.tsx"));
    expect(layout).toMatch(/<MotionProvider>/);
  });
});

describe("no bounce anywhere in src", () => {
  it("has no spring transition (unless allow-listed and critically damped)", () => {
    for (const { file, source } of code) {
      for (const literal of springLiterals(source)) {
        expect(SPRING_ALLOW[file], `${file}: ${literal}`).toBeDefined();
        expect(springOvershoots(literal), `${file}: ${literal}`).toBe(false);
      }
    }
  });

  it("uses no bounce option, useSpring or bounce/ping animation classes", () => {
    for (const { file, source } of code) {
      expect(source, file).not.toMatch(/\bbounce:\s/);
      expect(source, file).not.toMatch(/\buseSpring\(/);
      expect(source, file).not.toMatch(/\banimate-(bounce|ping)\b/);
    }
    for (const { file, source } of styles) expect(source, file).not.toMatch(/\banimation:\s*(bounce|ping)\b/);
  });

  it("never scales past 1 on press, hover or an animated target", () => {
    for (const { file, source } of code) {
      for (const m of source.matchAll(/\b(whileTap|whileHover|whileFocus|whileDrag|whileInView|animate|initial|exit)=\{\{([\s\S]*?)\}\}/g)) {
        for (const v of motionScaleValues(m[2])) expect(v, `${file}: ${m[1]}={{${m[2]}}}`).toBeLessThanOrEqual(1);
      }
      expect(source, file).not.toMatch(/(?:^|[\s"'`])(?:[\w-]+:)*scale-(?:1\d\d|\[1(?:\.\d+)?\])(?=[\s"'`])/);
    }
  });

  it("only uses easing curves whose control points stay within 0..1", () => {
    for (const { file, source } of [...code, ...styles]) {
      for (const ease of [...bezierEases(source), ...cssBeziers(source)]) {
        expect(bezierOvershoots(ease), `${file}: ${ease.join(", ")}`).toBe(false);
      }
      expect(source, file).not.toMatch(/\blinear\(/);
    }
  });

  it("gives every drag a non-wobbling snap-back", () => {
    for (const { file, source } of code) {
      if (!/\bdrag(Elastic|Transition|Constraints)=/.test(source)) continue;
      const uses = [...source.matchAll(/\bdragTransition=\{([\s\S]*?)\}(?=\s|\/|>)/g)];
      expect(uses.length, `${file}: a drag with elastic/constraints needs an explicit dragTransition`).toBeGreaterThan(0);
      for (const use of uses) {
        const expr = use[1].trim();
        const literal = expr.startsWith("{")
          ? expr
          : source.match(new RegExp(`\\b${expr} = (\\{[^}]*\\})`))?.[1];
        expect(literal, `${file}: dragTransition={${expr}}`).toBeDefined();
        expect(dragBounceOvershoots(literal!), `${file}: ${literal}`).toBe(false);
      }
    }
  });

  it("gives every motion animation its own transition too (the default is the backstop, not the plan)", () => {
    for (const { file, source } of code) {
      if (!/from "motion\/react(-m)?"/.test(source) && !/<m\.\w+/.test(source)) continue;
      const targets = source.match(/\b(animate|exit)=\{/g)?.length ?? 0;
      const transitions = source.match(/\btransition=\{/g)?.length ?? 0;
      expect(transitions, file).toBeGreaterThanOrEqual(source.match(/\banimate=\{/g)?.length ?? 0);
      if (targets > 0) expect(transitions, file).toBeGreaterThan(0);
    }
  });

  it("has no CSS keyframes that overshoot their end scale and settle back (splash and ambient loops excepted)", () => {
    for (const { file, source } of styles) {
      for (const [name, values] of keyframeScales(source)) {
        if (KEYFRAME_ALLOW[name]) continue;
        expect(keyframesOvershoot(values), `${file}: @keyframes ${name} ${values.join(" -> ")}`).toBe(false);
      }
    }
    // The splash stays exactly as the owner wants it.
    expect(keyframesOvershoot(keyframeScales(globalsCss).get("splash-logo-in") ?? [])).toBe(true);
  });
});

describe("button press feedback", () => {
  function rule(selector: string): string {
    const start = globalsCss.indexOf(`${selector} {`);
    expect(start, selector).toBeGreaterThanOrEqual(0);
    return globalsCss.slice(start, globalsCss.indexOf("}", start));
  }

  it("presses down gently (0.97..1) and never above its size", () => {
    const press = rule("button:not(:disabled):active");
    const scale = Number(press.match(/\bscale:\s*([0-9.]+)/)?.[1]);
    expect(scale).toBeGreaterThanOrEqual(0.97);
    expect(scale).toBeLessThan(1);
  });

  it("eases the press in 100ms with ease-out", () => {
    const base = rule("textarea");
    expect(base).toMatch(/\btransform 100ms ease-out\b/);
    expect(base).toMatch(/\bscale 100ms ease-out\b/);
  });
});
