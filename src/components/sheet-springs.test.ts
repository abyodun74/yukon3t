import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Opening a sheet or dialog must never bounce: every spring in sheet.tsx has
// to be critically damped (damping >= 1).
describe("sheet.tsx springs", () => {
  const source = readFileSync(join(__dirname, "sheet.tsx"), "utf8");

  it("has no underdamped open/entrance spring", () => {
    const dampings = [...source.matchAll(/type: "spring"[^}]*?damping: ([0-9.]+)/g)].map((m) => Number(m[1]));
    expect(dampings.length).toBeGreaterThanOrEqual(2);
    for (const d of dampings) expect(d).toBeGreaterThanOrEqual(1);
  });
});
