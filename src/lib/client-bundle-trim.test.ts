import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// Keeps the first-load JavaScript trims of Perf Batch B (2026-10-31) from quietly coming back:
// - motion: components use the small `m` (motion/react-m) under MotionProvider's LazyMotion; the animation/drag code
//   (domMax) is only ever loaded through a dynamic import() of src/lib/motion-features.ts. A full `motion.*` component
//   or a static domMax/domAnimation import puts ~36KB gzipped back into the root layout chunk.
// - Supabase: only @supabase/realtime-js is used; the full @supabase/supabase-js client was ~41KB gzipped more.
// - Sentry: tracing and debug code compiled out (next.config.ts), and the SDK reached only through named imports, so
//   no whole-module dynamic import drags Replay/Feedback/Profiling into a chunk.

const ROOT = resolve(__dirname, "../..");
const SRC = join(ROOT, "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "generated" || name === "node_modules") continue;
      walk(full, out);
    } else if (/\.(ts|tsx|mts)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const rel = (f: string) => relative(ROOT, f).replace(/\\/g, "/");
const files = [...walk(SRC), join(ROOT, "instrumentation-client.ts")].map((f) => ({
  path: rel(f),
  src: readFileSync(f, "utf8"),
}));

/** The named bindings of every static `import { ... } from "<spec>"` in a source file. */
function namedImports(src: string, spec: RegExp): string[] {
  const names: string[] = [];
  for (const m of src.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    if (m[1] || !spec.test(m[3])) continue;
    for (const part of m[2].split(",")) {
      const name = part.trim();
      if (name && !name.startsWith("type ")) names.push(name.split(/\s+as\s+/)[0]);
    }
  }
  return names;
}

describe("first-load bundle trims", () => {
  it("never renders a full motion component or loads motion's features statically", () => {
    const problems: string[] = [];
    for (const { path, src } of files) {
      const names = namedImports(src, /^(motion\/react|motion|framer-motion)$/);
      if (names.includes("motion")) problems.push(`${path}: imports the full \`motion\` component (use motion/react-m)`);
      if (/from\s*["']framer-motion["']/.test(src)) problems.push(`${path}: imports framer-motion directly`);
      if (path !== "src/lib/motion-features.ts" && names.some((n) => n === "domMax" || n === "domAnimation")) {
        problems.push(`${path}: imports motion features statically (only src/lib/motion-features.ts may)`);
      }
      if (/import\s[^;]*from\s*["']@\/lib\/motion-features["']/.test(src)) {
        problems.push(`${path}: imports motion-features statically (load it with import())`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("uses Supabase Realtime only, never the full supabase-js client", () => {
    expect(files.filter(({ src }) => /["']@supabase\/supabase-js["']/.test(src)).map((f) => f.path)).toEqual([]);
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["@supabase/supabase-js"]).toBeUndefined();
    expect(pkg.dependencies["@supabase/realtime-js"]).toBeDefined();
  });

  it("compiles Sentry tracing and debug logging out of every bundle", () => {
    const config = readFileSync(join(ROOT, "next.config.ts"), "utf8");
    expect(config).toMatch(/__SENTRY_TRACING__:\s*false/);
    expect(config).toMatch(/__SENTRY_DEBUG__:\s*false/);
    for (const f of ["instrumentation-client.ts", "sentry.server.config.ts", "sentry.edge.config.ts"]) {
      expect(readFileSync(join(ROOT, f), "utf8"), f).not.toMatch(/(tracesSampleRate|tracesSampler)\s*:/);
    }
  });

  it("reaches the Sentry SDK only through named imports", () => {
    const problems = files
      .filter(({ src }) => /const\s+\w+\s*=\s*await\s+import\(\s*["']@sentry\/nextjs["']\s*\)/.test(src))
      .map((f) => f.path);
    expect(problems).toEqual([]);
  });
});
