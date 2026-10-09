import { describe, expect, it } from "vitest";
import {
  STALE_BUILD_RELOAD_COOLDOWN_MS,
  looksLikeStaleBuildError,
  parseReloadRecord,
  shouldReloadForBuild,
} from "./stale-build";

function errorWith(message: string, stack = "", name = "Error") {
  const err = new Error(message);
  err.name = name;
  err.stack = stack;
  return err;
}

const NEXT_STACK =
  "TypeError: i[e] is not a function\n    at r (https://yukon3t.com/_next/static/chunks/webpack-6edb35257fe5c6d9.js:1:143)";

describe("looksLikeStaleBuildError", () => {
  it("matches chunk-load failures by name or message", () => {
    expect(looksLikeStaleBuildError(errorWith("whatever", "", "ChunkLoadError"))).toBe(true);
    expect(looksLikeStaleBuildError(errorWith("Loading chunk 4821 failed.\n(error: https://yukon3t.com/_next/static/chunks/4821.js)"))).toBe(true);
    expect(looksLikeStaleBuildError(errorWith("Loading chunk app/admin/page failed."))).toBe(true);
    expect(looksLikeStaleBuildError(errorWith("Loading CSS chunk 112 failed."))).toBe(true);
    expect(looksLikeStaleBuildError(errorWith("Failed to fetch dynamically imported module: https://yukon3t.com/_next/static/chunks/a.js"))).toBe(true);
    expect(looksLikeStaleBuildError(errorWith("error loading dynamically imported module"))).toBe(true);
    expect(looksLikeStaleBuildError(errorWith("Importing a module script failed."))).toBe(true);
    expect(looksLikeStaleBuildError(errorWith("Module 123 was instantiated because it was required from module 456, but the module factory is not available."))).toBe(true);
    expect(looksLikeStaleBuildError("Loading chunk 7 failed.")).toBe(true);
  });

  it("matches a module-factory 'is not a function' only from Next's own bundles", () => {
    expect(looksLikeStaleBuildError(errorWith("i[e] is not a function", NEXT_STACK, "TypeError"))).toBe(true);
    expect(
      looksLikeStaleBuildError(errorWith("i[e] is not a function", "TypeError: i[e] is not a function\n    at https://cdn.example.com/widget.js:1:1", "TypeError")),
    ).toBe(false);
    expect(looksLikeStaleBuildError(errorWith("i[e] is not a function", "", "TypeError"))).toBe(false);
  });

  it("ignores unrelated errors and non-errors", () => {
    expect(looksLikeStaleBuildError(errorWith("Cannot read properties of undefined (reading 'id')", NEXT_STACK))).toBe(false);
    expect(looksLikeStaleBuildError(errorWith("Failed to fetch"))).toBe(false);
    expect(looksLikeStaleBuildError(errorWith("NetworkError when attempting to fetch resource."))).toBe(false);
    expect(looksLikeStaleBuildError(null)).toBe(false);
    expect(looksLikeStaleBuildError(undefined)).toBe(false);
    expect(looksLikeStaleBuildError(42)).toBe(false);
    expect(looksLikeStaleBuildError({})).toBe(false);
  });
});

describe("parseReloadRecord", () => {
  it("round-trips a valid record and rejects garbage", () => {
    expect(parseReloadRecord(JSON.stringify({ target: "abc", at: 5 }))).toEqual({ target: "abc", at: 5 });
    expect(parseReloadRecord(null)).toBeNull();
    expect(parseReloadRecord("")).toBeNull();
    expect(parseReloadRecord("{not json")).toBeNull();
    expect(parseReloadRecord(JSON.stringify({ target: 1, at: "x" }))).toBeNull();
  });
});

describe("shouldReloadForBuild", () => {
  const now = 1_000_000;

  it("reloads when the server is on a different build", () => {
    expect(shouldReloadForBuild({ clientBuildId: "old", serverBuildId: "new", lastReload: null, now })).toBe(true);
  });

  it("never reloads when both sides are on the same build (a real bug)", () => {
    expect(shouldReloadForBuild({ clientBuildId: "same", serverBuildId: "same", lastReload: null, now })).toBe(false);
  });

  it("never reloads without both ids", () => {
    expect(shouldReloadForBuild({ clientBuildId: undefined, serverBuildId: "new", lastReload: null, now })).toBe(false);
    expect(shouldReloadForBuild({ clientBuildId: "old", serverBuildId: null, lastReload: null, now })).toBe(false);
    expect(shouldReloadForBuild({ clientBuildId: "old", serverBuildId: "", lastReload: null, now })).toBe(false);
  });

  it("never reloads twice for the same target build", () => {
    const lastReload = { target: "new", at: now - 10 * STALE_BUILD_RELOAD_COOLDOWN_MS };
    expect(shouldReloadForBuild({ clientBuildId: "old", serverBuildId: "new", lastReload, now })).toBe(false);
  });

  it("caps reloads at one per cooldown window, even for a newer target", () => {
    const recent = { target: "new", at: now - STALE_BUILD_RELOAD_COOLDOWN_MS + 1 };
    expect(shouldReloadForBuild({ clientBuildId: "new", serverBuildId: "newer", lastReload: recent, now })).toBe(false);
    const stale = { target: "new", at: now - STALE_BUILD_RELOAD_COOLDOWN_MS };
    expect(shouldReloadForBuild({ clientBuildId: "new", serverBuildId: "newer", lastReload: stale, now })).toBe(true);
  });
});
