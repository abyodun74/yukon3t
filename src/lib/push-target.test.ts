import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HANDLED_LAUNCH_URL_KEY,
  PUSH_TAP_KEY,
  PUSH_TAP_TTL_MS,
  claimLaunchUrl,
  clearPushTap,
  notificationDeepLinkPath,
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

describe("notificationDeepLinkPath", () => {
  it("opens the in-app path of a native notification's yukon3t://open link", () => {
    expect(notificationDeepLinkPath("yukon3t://open?path=%2Fu%2Fcaller&n=call1")).toBe("/u/caller");
    expect(notificationDeepLinkPath("yukon3t://open?path=%2Fmessages%2Fc1%3Fx%3D1&n=1")).toBe("/messages/c1?x=1");
  });

  it("ignores the ring links and anything else", () => {
    for (const raw of [
      "yukon3t://call?callId=c1",
      "yukon3t://call?callId=c1&action=accept",
      "https://yukon3t.com/open?path=%2Fu%2Fx",
      "yukon3t://other?path=%2Fu%2Fx",
      "yukon3t://open",
      "yukon3t://open?path=",
      "not a url",
      "",
      null,
      undefined,
    ]) {
      expect(notificationDeepLinkPath(raw)).toBeNull();
    }
  });

  it("refuses a path that could leave the site, same as a push's url", () => {
    for (const path of ["https://evil.example/x", "//evil.example/x", "/\\evil.example", "javascript:alert(1)", "u/x"]) {
      expect(notificationDeepLinkPath(`yukon3t://open?path=${encodeURIComponent(path)}&n=1`)).toBeNull();
    }
  });
});

describe("claimLaunchUrl", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("acts on a launch URL once per app session, across reloads, and on each new one", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    expect(claimLaunchUrl("yukon3t://open?path=%2Fu%2Fa&n=c1")).toBe(true);
    expect(claimLaunchUrl("yukon3t://open?path=%2Fu%2Fa&n=c1")).toBe(false);
    expect(store.get(HANDLED_LAUNCH_URL_KEY)).toBe("yukon3t://open?path=%2Fu%2Fa&n=c1");
    expect(claimLaunchUrl("yukon3t://open?path=%2Fu%2Fa&n=c2")).toBe(true);
  });

  it("still dedupes in memory when storage is blocked", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(claimLaunchUrl("yukon3t://open?path=%2Fu%2Fb&n=c9")).toBe(true);
    expect(claimLaunchUrl("yukon3t://open?path=%2Fu%2Fb&n=c9")).toBe(false);
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
