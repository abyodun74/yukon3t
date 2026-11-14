import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// The global `:focus-visible` outline (globals.css) is unlayered, so Tailwind's `outline-none` cannot switch it off. A
// text field inside a wrapper that draws its own ring (`focus-within:border-accent`) therefore showed a square orange
// box inside the rounded wrapper (Muse comments composer, Android). Such fields carry `data-ring-on-wrapper`, which a
// globals.css rule turns into `outline: none`. This guard fails when a wrapper holds a field without it.

const SRC = resolve(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "generated" || name === "node_modules") continue;
      walk(full, out);
    } else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

describe("focus ring wrappers", () => {
  const css = readFileSync(join(SRC, "app", "globals.css"), "utf8");

  it("globals.css switches the outline off for marked fields, after the global rule", () => {
    const global = css.indexOf(":focus-visible {");
    const marked = css.indexOf("input[data-ring-on-wrapper]:focus-visible");
    expect(global).toBeGreaterThan(-1);
    expect(marked).toBeGreaterThan(global);
    expect(css).toMatch(/textarea\[data-ring-on-wrapper\]:focus-visible\s*\{\s*outline:\s*none;/);
  });

  it("every focus-within:border-accent wrapper's text field carries data-ring-on-wrapper", () => {
    const problems: string[] = [];
    for (const file of walk(join(SRC, "components"))) {
      const text = readFileSync(file, "utf8");
      let from = 0;
      for (;;) {
        const at = text.indexOf("focus-within:border-accent", from);
        if (at === -1) break;
        from = at + 1;
        // The wrapper's own element, then the next field after it (within the wrapper's block).
        const rest = text.slice(at, at + 2500);
        const field = rest.match(/<(input|textarea)\b[\s\S]*?(\/>|>)/);
        if (!field) continue;
        if (!field[0].includes("data-ring-on-wrapper")) {
          problems.push(`${file.replace(SRC, "src")} (field after "focus-within:border-accent")`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
