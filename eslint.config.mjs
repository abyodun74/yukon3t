import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Netlify's local build/bundling output (gitignored, not source).
    ".netlify/**",
    // Native platform projects (Capacitor) — their own build output and
    // vendored/generated JS, not this project's source.
    "android/**",
    "ios/**",
  ]),
]);

export default eslintConfig;
