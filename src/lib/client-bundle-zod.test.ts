import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";

// zod v4 plus src/lib/validations.ts is ~65KB gzipped, and validations.ts builds its schemas at module load, so a
// client component importing even one constant from it ships all of zod on that route. Plain constants a client
// component needs live in src/lib/validation-constants.ts instead. This walks the static import graph from every
// "use client" file (type-only imports, dynamic import() chunks and "use server" action modules don't put code in the
// client bundle, so they are not followed) and fails when one reaches zod, unless it is allow-listed below because it
// genuinely runs a schema in the browser.

const ROOT = resolve(__dirname, "../..");
const SRC = join(ROOT, "src");

/**
 * Modules that run a zod schema in the browser on purpose, each with its reason. The walk stops at them, so only the
 * sign-up / phone-verification / collab-invite screens that use them carry zod; nothing else may reach it.
 */
const ZOD_ALLOWED_MODULES: Record<string, string> = {
  "src/lib/sign-up-form.ts": "the sign-up form checks username/password with signUpSchema's own rules as you type",
  "src/lib/phone-number.ts": "phone fields check E.164 with phoneSchema before a code is sent",
  "src/lib/collab-session-start.ts": "the collab start-session sheet validates its picks before submitting",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "generated" || name === "node_modules") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function directive(src: string): "client" | "server" | null {
  const stripped = src.replace(/^(\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, "");
  if (/^["']use client["']/.test(stripped)) return "client";
  if (/^["']use server["']/.test(stripped)) return "server";
  return null;
}

/** Specifiers of the static, value-carrying imports and re-exports of a module. */
function staticImports(src: string): string[] {
  const specs: string[] = [];
  const re = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^;]*?)\s*from\s*["']([^"']+)["']/g;
  for (const m of src.matchAll(re)) {
    if (m[2]) continue; // import type / export type
    // `import { type A, type B } from` brings in no values either.
    const clause = m[3].trim();
    const named = clause.match(/^\{([\s\S]*)\}$/);
    if (named && named[1].split(",").every((part) => !part.trim() || /^type\s/.test(part.trim()))) continue;
    specs.push(m[4]);
  }
  for (const m of src.matchAll(/(?:^|\n)\s*import\s+["']([^"']+)["']/g)) specs.push(m[1]);
  return specs;
}

function resolveSpec(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const rel = (f: string) => relative(ROOT, f).replace(/\\/g, "/");
const files = walk(SRC);
const source = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));

function zodPath(entry: string): string[] | null {
  const seen = new Set<string>();
  const stack: { file: string; path: string[] }[] = [{ file: entry, path: [entry] }];
  while (stack.length) {
    const { file, path } = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const src = source.get(file) ?? readFileSync(file, "utf8");
    if (file !== entry && directive(src) === "server") continue;
    if (ZOD_ALLOWED_MODULES[rel(file)]) continue;
    for (const spec of staticImports(src)) {
      if (spec === "zod" || spec.startsWith("zod/")) return path;
      const next = resolveSpec(file, spec);
      if (next && !seen.has(next)) stack.push({ file: next, path: [...path, next] });
    }
  }
  return null;
}

describe("client bundles stay free of zod", () => {
  const clientFiles = files.filter((f) => directive(source.get(f)!) === "client");

  it("finds the client components to check", () => {
    expect(clientFiles.length).toBeGreaterThan(50);
  });

  it("no client component reaches zod except the allow-listed ones", () => {
    const problems: string[] = [];
    for (const file of clientFiles) {
      const path = zodPath(file);
      if (path) problems.push(`${path.map(rel).join(" -> ")} -> zod`);
    }
    expect(problems).toEqual([]);
  });

  it("validation-constants.ts imports nothing", () => {
    expect(staticImports(source.get(join(SRC, "lib", "validation-constants.ts"))!)).toEqual([]);
  });
});
