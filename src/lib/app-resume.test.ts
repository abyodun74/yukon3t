import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RESUME_REFRESH_AFTER_MS,
  hiddenRelockStep,
  isLandingPath,
  planAppReturn,
  shouldRefreshOnReturn,
  staleReloadDestination,
} from "./app-resume";
import { hiddenUnlockPath, safeHiddenNext } from "./hidden-chats-rules";

describe("planAppReturn: returning to the app keeps the screen", () => {
  it("resume with no pending tap stays wherever the person was, on every kind of screen", () => {
    for (const location of ["/messages/c1", "/u/abc", "/circles/hikers", "/settings", "/muse", "/home", "/post/p1?x=1"]) {
      for (const onLandingPage of [true, false]) {
        expect(planAppReturn({ pendingTap: null, location, onLandingPage })).toEqual({ kind: "stay" });
      }
    }
  });

  it("a pending push tap opens its target from a landing page (cold start, or a reload that cut the tap short)", () => {
    expect(planAppReturn({ pendingTap: "/messages/c9", location: "/home", onLandingPage: true })).toEqual({
      kind: "open",
      path: "/messages/c9",
    });
  });

  it("an opened link (appUrlOpen / launch URL, recorded like a tap) opens its target the same way", () => {
    expect(planAppReturn({ pendingTap: "/post/p1#c2", location: "/", onLandingPage: true })).toEqual({
      kind: "open",
      path: "/post/p1#c2",
    });
  });

  it("never moves away from a page chosen since, and doesn't repeat a tap's own in-flight navigation", () => {
    expect(planAppReturn({ pendingTap: "/messages/c9", location: "/u/abc", onLandingPage: false })).toEqual({ kind: "stay" });
  });

  it("is done once on the target (the #fragment doesn't count)", () => {
    expect(planAppReturn({ pendingTap: "/circles/x#polls", location: "/circles/x", onLandingPage: false })).toEqual({
      kind: "stay",
    });
  });

  it("landing pages are Home and /", () => {
    expect(isLandingPath("/home")).toBe(true);
    expect(isLandingPath("/")).toBe(true);
    expect(isLandingPath("/messages")).toBe(false);
    expect(isLandingPath("/home/x")).toBe(false);
  });
});

describe("staleReloadDestination: a stale build reloads the same URL", () => {
  it("reloads in place (same URL, never Home) when nothing is pending", () => {
    expect(staleReloadDestination(null)).toEqual({ kind: "reload" });
  });

  it("goes to a just-tapped notification's page instead of cutting its navigation short", () => {
    expect(staleReloadDestination("/messages/c1")).toEqual({ kind: "replace", path: "/messages/c1" });
  });
});

describe("shouldRefreshOnReturn", () => {
  it("re-reads the route's data after a longer absence, a very long one included (no reset to Home)", () => {
    expect(shouldRefreshOnReturn({ awayMs: RESUME_REFRESH_AFTER_MS, pickerActive: false, reloading: false })).toBe(true);
    expect(shouldRefreshOnReturn({ awayMs: 3 * 24 * 3600_000, pickerActive: false, reloading: false })).toBe(true);
  });

  it("not for a quick trip away (live data resyncs on its own)", () => {
    expect(shouldRefreshOnReturn({ awayMs: RESUME_REFRESH_AFTER_MS - 1, pickerActive: false, reloading: false })).toBe(false);
  });

  it("not for the Android picker's resume, not while reloading, not without a measured pause", () => {
    expect(shouldRefreshOnReturn({ awayMs: 10 * 60_000, pickerActive: true, reloading: false })).toBe(false);
    expect(shouldRefreshOnReturn({ awayMs: 10 * 60_000, pickerActive: false, reloading: true })).toBe(false);
    expect(shouldRefreshOnReturn({ awayMs: null, pickerActive: false, reloading: false })).toBe(false);
  });
});

describe("hidden chats on the way back", () => {
  it("locks as the page is hidden, then shows the PIN prompt on return", () => {
    expect(hiddenRelockStep({ visibility: "hidden", pickerActive: false, relocked: false })).toBe("lock");
    expect(hiddenRelockStep({ visibility: "visible", pickerActive: false, relocked: true })).toBe("show-pin-prompt");
  });

  it("doesn't lock under the Android picker, and does nothing on a return that wasn't locked", () => {
    expect(hiddenRelockStep({ visibility: "hidden", pickerActive: true, relocked: false })).toBe("none");
    expect(hiddenRelockStep({ visibility: "visible", pickerActive: false, relocked: false })).toBe("none");
  });

  it("a hidden thread's PIN prompt path returns to that thread once unlocked", () => {
    const path = hiddenUnlockPath("c123");
    expect(path).toBe("/messages/hidden?next=%2Fmessages%2Fc123");
    const next = new URL(path, "https://yukon3t.com").searchParams.get("next");
    expect(safeHiddenNext(next)).toBe("/messages/c123");
  });
});

describe("source guards", () => {
  const root = join(__dirname, "..");
  const read = (rel: string) => readFileSync(join(root, rel), "utf8");

  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name !== "generated") out.push(...sourceFiles(full));
      } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
    }
    return out;
  }

  /** The text of every `addListener("resume", ...)` call, up to its matching parenthesis. */
  function resumeListeners(source: string): string[] {
    const found: string[] = [];
    let from = 0;
    for (;;) {
      const at = source.indexOf('addListener("resume"', from);
      if (at === -1) return found;
      const open = source.indexOf("(", at);
      let depth = 0;
      let end = open;
      for (; end < source.length; end++) {
        if (source[end] === "(") depth++;
        else if (source[end] === ")" && --depth === 0) break;
      }
      found.push(source.slice(at, end + 1));
      from = end;
    }
  }

  it("no resume listener anywhere navigates (to /home or anywhere else)", () => {
    let listeners = 0;
    for (const file of sourceFiles(root)) {
      for (const body of resumeListeners(readFileSync(file, "utf8"))) {
        listeners++;
        expect(body, file).not.toMatch(/router\.(push|replace)\(|location\.(assign|replace)\(|location\.href\s*=|["']\/home["']/);
      }
    }
    expect(listeners).toBeGreaterThan(0);
  });

  it("capacitor-bridge has no reset to Home and none of its old exceptions", () => {
    const bridge = read("components/capacitor-bridge.tsx");
    expect(bridge).not.toMatch(/router\.(push|replace)\(\s*["']\/home["']/);
    expect(bridge).not.toMatch(/NO_HOME_RESET_PREFIXES|RESUME_HOME_RESET_DELAY_MS|leavingForDocumentAt|resolveStuckImperativePicker/);
    expect(bridge).toMatch(/shouldRefreshOnReturn\(\{ awayMs, pickerActive, reloading \}\)\) router\.refresh\(\)/);
    expect(bridge).toMatch(/planAppReturn\(/);
  });

  it("a stale-build reload keeps the URL (reload in place) unless a tap is pending", () => {
    const client = read("lib/stale-build-client.ts");
    expect(client).toMatch(/staleReloadDestination\(pendingPushTap\(\)\)/);
    expect(client).toMatch(/else window\.location\.reload\(\);/);
    expect(client).not.toMatch(/["']\/home["']/);
  });

  it("HiddenRelock covers the page, re-sends the lock and refreshes in one transition", () => {
    const relock = read("components/hidden-relock.tsx");
    expect(relock).toMatch(/hiddenRelockStep\(/);
    expect(relock).toMatch(/setCovered\(true\)/);
    expect(relock).toMatch(/startTransition\(\(\) => \{\s*setCovered\(false\);\s*router\.refresh\(\);/);
    // Below calls: an active call stays on top of the cover.
    expect(relock).toMatch(/useOverlayZ\("blocking"\)/);
  });

  it("a hidden thread is redirected to the PIN prompt by the server while locked", () => {
    const page = read("app/messages/[id]/page.tsx");
    expect(page).toMatch(/redirect\(hiddenUnlockPath\(id\)\)/);
    expect(page).toMatch(/\{hidden && <HiddenRelock \/>\}/);
  });

  it("an open chat thread catches up on return without marking anything read in the background", () => {
    const thread = read("components/chat-thread.tsx");
    expect(thread).toMatch(/if \(document\.visibilityState === "hidden"\) return;\s*refetch\(\);/);
    expect(thread).toMatch(/\{ resync: "immediate" \}/);
  });
});
