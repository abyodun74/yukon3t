import { describe, expect, it } from "vitest";
import {
  BUILD_CHECK_MIN_INTERVAL_MS,
  ERROR_BUILD_CHECK_MIN_INTERVAL_MS,
  STALE_BUILD_RELOAD_COOLDOWN_MS,
  holdReload,
  isBuildCheckThrottled,
  isReloadHeld,
  isReloadSafe,
  looksLikeStaleBuildError,
  looksLikeStaleServerActionError,
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

  it("matches a Server Action the new deploy no longer has", () => {
    // Next's client router: UnrecognizedActionError, server-action-reducer.js.
    expect(
      looksLikeStaleBuildError(
        errorWith('Server Action "40a1b2c3d4e5f6" was not found on the server. \nRead more:https://nextjs.org/docs/messages/failed-to-find-server-action'),
      ),
    ).toBe(true);
    expect(looksLikeStaleBuildError(errorWith("minified away", "", "UnrecognizedActionError"))).toBe(true);
    expect(
      looksLikeStaleBuildError(errorWith("Failed to find Server Action. This request might be from an older or newer deployment.")),
    ).toBe(true);
    expect(looksLikeStaleBuildError(errorWith("An unexpected response was received from the server."))).toBe(false);
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

describe("looksLikeStaleServerActionError", () => {
  it("matches a Server Action the new deploy no longer has, by name or message", () => {
    expect(
      looksLikeStaleServerActionError(
        errorWith('Server Action "40a1b2c3d4e5f6" was not found on the server. \nRead more:https://nextjs.org/docs/messages/failed-to-find-server-action'),
      ),
    ).toBe(true);
    expect(looksLikeStaleServerActionError(errorWith("minified away", "", "UnrecognizedActionError"))).toBe(true);
    expect(
      looksLikeStaleServerActionError(errorWith("Failed to find Server Action. This request might be from an older or newer deployment.")),
    ).toBe(true);
  });

  it("leaves chunk-load failures and ordinary network errors to their own handling", () => {
    expect(looksLikeStaleServerActionError(errorWith("whatever", "", "ChunkLoadError"))).toBe(false);
    expect(looksLikeStaleServerActionError(errorWith("Loading chunk 4821 failed."))).toBe(false);
    expect(looksLikeStaleServerActionError(errorWith("i[e] is not a function", NEXT_STACK, "TypeError"))).toBe(false);
    expect(looksLikeStaleServerActionError(errorWith("Failed to fetch"))).toBe(false);
    expect(looksLikeStaleServerActionError(errorWith("An unexpected response was received from the server."))).toBe(false);
    expect(looksLikeStaleServerActionError(null)).toBe(false);
    expect(looksLikeStaleServerActionError(undefined)).toBe(false);
    expect(looksLikeStaleServerActionError({})).toBe(false);
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

describe("isBuildCheckThrottled", () => {
  it("allows the first check and then one per interval", () => {
    expect(isBuildCheckThrottled("foreground", null, 5)).toBe(false);
    expect(isBuildCheckThrottled("foreground", 1_000, 1_000 + BUILD_CHECK_MIN_INTERVAL_MS - 1)).toBe(true);
    expect(isBuildCheckThrottled("foreground", 1_000, 1_000 + BUILD_CHECK_MIN_INTERVAL_MS)).toBe(false);
  });

  it("gives errors a shorter interval of their own", () => {
    expect(isBuildCheckThrottled("error", null, 5)).toBe(false);
    expect(isBuildCheckThrottled("error", 1_000, 1_000 + ERROR_BUILD_CHECK_MIN_INTERVAL_MS - 1)).toBe(true);
    expect(isBuildCheckThrottled("error", 1_000, 1_000 + ERROR_BUILD_CHECK_MIN_INTERVAL_MS)).toBe(false);
  });

  it("never throttles an error boundary", () => {
    expect(isBuildCheckThrottled("boundary", 1_000, 1_001)).toBe(false);
  });
});

describe("isReloadSafe", () => {
  const idle = { call: false, work: false, unsentText: false };

  it("reloads from any trigger when nothing is in progress", () => {
    for (const trigger of ["foreground", "error", "boundary", "hidden"] as const) {
      expect(isReloadSafe(trigger, idle)).toBe(true);
    }
  });

  it("never reloads during a call, even from an error boundary", () => {
    for (const trigger of ["foreground", "error", "boundary", "hidden"] as const) {
      expect(isReloadSafe(trigger, { ...idle, call: true })).toBe(false);
    }
  });

  it("holds off for an upload or recording unless the page has already crashed", () => {
    expect(isReloadSafe("foreground", { ...idle, work: true })).toBe(false);
    expect(isReloadSafe("error", { ...idle, work: true })).toBe(false);
    expect(isReloadSafe("hidden", { ...idle, work: true })).toBe(false);
    expect(isReloadSafe("boundary", { ...idle, work: true })).toBe(true);
  });

  it("never discards unsent text unless the page has already crashed", () => {
    expect(isReloadSafe("foreground", { ...idle, unsentText: true })).toBe(false);
    expect(isReloadSafe("error", { ...idle, unsentText: true })).toBe(false);
    expect(isReloadSafe("hidden", { ...idle, unsentText: true })).toBe(false);
    expect(isReloadSafe("boundary", { ...idle, unsentText: true })).toBe(true);
  });
});

describe("holdReload", () => {
  it("counts overlapping holds per kind and ignores a double release", () => {
    expect(isReloadHeld("work")).toBe(false);
    const first = holdReload("work");
    const second = holdReload("work");
    expect(isReloadHeld("work")).toBe(true);
    expect(isReloadHeld("call")).toBe(false);
    first();
    first();
    expect(isReloadHeld("work")).toBe(true);
    second();
    expect(isReloadHeld("work")).toBe(false);
  });
});
