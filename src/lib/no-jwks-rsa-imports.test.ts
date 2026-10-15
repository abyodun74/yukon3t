import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// firebase-admin/app-check and /auth import jwks-rsa, whose require() of
// ESM-only jose throws at module load on Netlify and 500'd every route that
// imported it (2026-10-15). Use src/lib/app-check-rest.ts instead.
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

describe("firebase-admin entry points that pull in jwks-rsa", () => {
  it("are not imported by app code", () => {
    const offenders = sources("src").filter((f) =>
      /from\s+["']firebase-admin\/(app-check|auth)["']|import\(\s*["']firebase-admin\/(app-check|auth)["']/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
