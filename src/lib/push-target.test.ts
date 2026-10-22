import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PUSH_TAP_KEY,
  PUSH_TAP_TTL_MS,
  clearPushTap,
  isAtPushTarget,
  isPushTapPending,
  parsePushTap,
  pendingPushTap,
  rememberPushTap,
  safeInAppPath,
} from "@/lib/push-target";

describe("safeInAppPath", () => {
  it("keeps a path on this site, with its query and fragment", () => {
    expect(safeInAppPath("/post/p1")).toBe("/post/p1");
    expect(safeInAppPath("/u/me?story=s1")).toBe("/u/me?story=s1");
    expect(safeInAppPath("/circles/runners#polls")).toBe("/circles/runners#polls");
    expect(safeInAppPath("/circles/runners?channel=lounge")).toBe("/circles/runners?channel=lounge");
  });
  it("refuses anything that could leave the site", () => {
    for (const raw of [
      "https://evil.example/x",
      "//evil.example/x",
      "/\\evil.example/x",
      "\\\\evil.example",
      "javascript:alert(1)",
      "post/p1",
      "/post/p1\n",
      "",
      "/" + "a".repeat(600),
      null,
      undefined,
      42,
    ]) {
      expect(safeInAppPath(raw)).toBeNull();
    }
  });
});

describe("pending push tap", () => {
  afterEach(() => {
    clearPushTap();
    vi.unstubAllGlobals();
  });

  it("is pending for PUSH_TAP_TTL_MS after the tap, then not", () => {
    const tap = { url: "/post/p1", at: 1_000 };
    expect(isPushTapPending(tap, 1_000)).toBe(true);
    expect(isPushTapPending(tap, 1_000 + PUSH_TAP_TTL_MS - 1)).toBe(true);
    expect(isPushTapPending(tap, 1_000 + PUSH_TAP_TTL_MS)).toBe(false);
    expect(isPushTapPending(tap, 999)).toBe(false);
    expect(isPushTapPending(null, 1_000)).toBe(false);
  });

  it("parses only a well-formed, safe stored tap", () => {
    expect(parsePushTap(JSON.stringify({ url: "/muse/m1", at: 5 }))).toEqual({ url: "/muse/m1", at: 5 });
    expect(parsePushTap(JSON.stringify({ url: "//evil.example", at: 5 }))).toBeNull();
    expect(parsePushTap(JSON.stringify({ url: "/muse/m1" }))).toBeNull();
    expect(parsePushTap("{")).toBeNull();
    expect(parsePushTap(null)).toBeNull();
  });

  it("survives a reload through sessionStorage, and clears", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    rememberPushTap("/messages/c1", 10_000);
    expect(JSON.parse(store.get(PUSH_TAP_KEY)!)).toEqual({ url: "/messages/c1", at: 10_000 });
    expect(pendingPushTap(10_500)).toBe("/messages/c1");
    expect(pendingPushTap(10_000 + PUSH_TAP_TTL_MS)).toBeNull();
    clearPushTap();
    expect(store.has(PUSH_TAP_KEY)).toBe(false);
    expect(pendingPushTap(10_500)).toBeNull();
    // A fresh page (the reload) reads it back from storage.
    store.set(PUSH_TAP_KEY, JSON.stringify({ url: "/post/p1", at: 20_000 }));
    expect(pendingPushTap(20_100)).toBe("/post/p1");
  });

  it("still works in memory when storage is blocked", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    rememberPushTap("/post/p1", 1_000);
    expect(pendingPushTap(1_500)).toBe("/post/p1");
  });

  it("matches the target page ignoring the #fragment", () => {
    expect(isAtPushTarget("/circles/runners#polls", "/circles/runners")).toBe(true);
    expect(isAtPushTarget("/u/me?story=s1", "/u/me?story=s1")).toBe(true);
    expect(isAtPushTarget("/u/me?story=s1", "/u/me")).toBe(false);
    expect(isAtPushTarget("/post/p1", "/home")).toBe(false);
  });
});
