import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { assertSessionSecretUsable, MIN_SESSION_SECRET_BYTES, sessionSecretProblem } from "@/lib/auth-cookie";

// A production server must refuse to run with an AUTH_SECRET anyone can know or guess, but `next build` (also
// NODE_ENV=production, often without runtime secrets), dev and tests must keep working.

const GOOD = "q3V9kLx2mN7pR4sT8uW1yZ5aB6cD0eF+gH/iJ=="; // 40 bytes, random-looking, not a real secret

/** .env.example's AUTH_SECRET hint: the one published placeholder still in the repo. */
function exampleEnvPlaceholder(): string {
  const text = readFileSync(path.join(process.cwd(), ".env.example"), "utf8");
  const match = text.match(/^AUTH_SECRET="([^"]*)"/m);
  if (!match) throw new Error(".env.example has no AUTH_SECRET line");
  return match[1];
}

describe("sessionSecretProblem", () => {
  it("accepts a long random secret", () => {
    expect(sessionSecretProblem(GOOD)).toBeNull();
  });

  it("flags a missing secret", () => {
    expect(sessionSecretProblem("")).toBe("missing");
  });

  it("flags a secret shorter than 32 bytes", () => {
    expect(sessionSecretProblem("x".repeat(MIN_SESSION_SECRET_BYTES - 1))).toBe("too_short");
    expect(sessionSecretProblem("x".repeat(MIN_SESSION_SECRET_BYTES))).toBeNull();
  });

  it("flags the published .env.example placeholder", () => {
    expect(sessionSecretProblem(exampleEnvPlaceholder())).toBe("placeholder");
  });

  it("flags the local .env placeholder when that file exists (it is the old SECURITY.md value)", () => {
    let local: string | null = null;
    try {
      const text = readFileSync(path.join(process.cwd(), ".env"), "utf8");
      local = text.match(/^AUTH_SECRET="?([^"\r\n]*)"?/m)?.[1] ?? null;
    } catch {
      // No local .env (CI): nothing to check.
    }
    if (local && /CHANGE-ME/.test(local)) expect(sessionSecretProblem(local)).toBe("placeholder");
  });
});

describe("assertSessionSecretUsable", () => {
  it("throws a clear error in production for a placeholder, short or missing secret", () => {
    expect(() => assertSessionSecretUsable({ NODE_ENV: "production", AUTH_SECRET: exampleEnvPlaceholder() })).toThrow(
      /AUTH_SECRET is a publicly documented placeholder/,
    );
    expect(() => assertSessionSecretUsable({ NODE_ENV: "production", AUTH_SECRET: "short" })).toThrow(/shorter than 32 bytes/);
    expect(() => assertSessionSecretUsable({ NODE_ENV: "production" })).toThrow(/is not set/);
  });

  it("never puts the secret itself in the error", () => {
    const secret = "abc-short-secret";
    try {
      assertSessionSecretUsable({ NODE_ENV: "production", AUTH_SECRET: secret });
      throw new Error("expected a throw");
    } catch (err) {
      expect(String(err)).not.toContain(secret);
    }
  });

  it("reads NEXTAUTH_SECRET when AUTH_SECRET is unset, like next-auth", () => {
    expect(() => assertSessionSecretUsable({ NODE_ENV: "production", NEXTAUTH_SECRET: GOOD })).not.toThrow();
    expect(() => assertSessionSecretUsable({ NODE_ENV: "production", NEXTAUTH_SECRET: "short" })).toThrow();
  });

  it("passes a real secret in production", () => {
    expect(() => assertSessionSecretUsable({ NODE_ENV: "production", AUTH_SECRET: GOOD })).not.toThrow();
  });

  it("does nothing during `next build`, in development or in tests", () => {
    for (const env of [
      { NODE_ENV: "production", NEXT_PHASE: "phase-production-build" },
      { NODE_ENV: "development", AUTH_SECRET: exampleEnvPlaceholder() },
      { NODE_ENV: "test", AUTH_SECRET: "short" },
    ]) {
      expect(() => assertSessionSecretUsable(env)).not.toThrow();
    }
  });
});

describe("SECURITY.md", () => {
  it("doesn't print a usable AUTH_SECRET value", () => {
    const text = readFileSync(path.join(process.cwd(), "SECURITY.md"), "utf8");
    expect(text).not.toMatch(/dev-only-secret/);
  });
});
