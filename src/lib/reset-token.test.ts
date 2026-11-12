import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { generateResetToken, hashResetToken, resetPasswordUrl } from "@/lib/reset-token";
import { RESET_TOKEN_CAPTURE_SCRIPT, readResetTokenFromHash } from "@/lib/reset-token-client";

describe("reset tokens", () => {
  it("are long, URL-safe and unique", () => {
    const a = generateResetToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateResetToken()).not.toBe(a);
  });

  it("are stored only as a SHA-256, which a raw (legacy) token never matches", () => {
    const token = generateResetToken();
    const stored = hashResetToken(token);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toContain(token);
    expect(hashResetToken(token)).toBe(stored);
    // A row written before hashing holds the raw token: looking up hash(raw) can't find it.
    expect(hashResetToken(token)).not.toBe(token);
  });

  it("travel in the URL fragment, never the query string", () => {
    const url = resetPasswordUrl("https://yukon3t.com", "abc_DEF-1");
    expect(url).toBe("https://yukon3t.com/reset-password#token=abc_DEF-1");
    expect(new URL(url).search).toBe("");
    expect(readResetTokenFromHash(new URL(url).hash)).toBe("abc_DEF-1");
  });

  it("the page script reads the fragment and replaces the URL with the bare path", () => {
    const store: Record<string, unknown> = {};
    let replaced: string | null = null;
    const run = new Function("window", "location", "history", RESET_TOKEN_CAPTURE_SCRIPT);
    run(store, { hash: "#token=abc", search: "", pathname: "/reset-password" }, {
      state: null,
      replaceState: (_s: unknown, _t: string, url: string) => {
        replaced = url;
      },
    });
    expect(store.__ykResetToken).toBe("abc");
    expect(replaced).toBe("/reset-password");
  });

  it("readResetTokenFromHash ignores anything else", () => {
    expect(readResetTokenFromHash("")).toBeNull();
    expect(readResetTokenFromHash("#comments")).toBeNull();
    expect(readResetTokenFromHash("#token=")).toBeNull();
    expect(readResetTokenFromHash("#a=1&token=x%2By")).toBe("x+y");
  });

  it("no code builds a reset link with the token in the query string", () => {
    const source = readFileSync("src/app/actions/password-auth.ts", "utf8");
    expect(source).not.toMatch(/reset-password\?token=/);
    expect(source).toMatch(/hashResetToken\(token\)/);
  });
});
