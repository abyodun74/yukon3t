import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CALLKIT_YIELD_INTERVAL_MS,
  callPushTag,
  inAppRingOnScreen,
  systemRingFor,
} from "@/lib/incoming-call-surface";
import { safeReplaceKey } from "@/lib/push-replace";

describe("systemRingFor", () => {
  it("names each platform's own ring UI", () => {
    expect(systemRingFor("ios")).toBe("callKit");
    expect(systemRingFor("android")).toBe("androidRing");
    expect(systemRingFor("web")).toBe("browserNotification");
  });
});

describe("inAppRingOnScreen (should the system ring give way?)", () => {
  it("is the card's call while the card is drawn and the page is visible", () => {
    expect(inAppRingOnScreen({ cardCallId: "c1", pageVisible: true })).toBe("c1");
  });

  it("leaves the system ring alone while the app is in the background or the screen is locked", () => {
    expect(inAppRingOnScreen({ cardCallId: "c1", pageVisible: false })).toBeNull();
  });

  it("leaves it alone with no card (answering, replying, in a call, nothing ringing)", () => {
    expect(inAppRingOnScreen({ cardCallId: null, pageVisible: true })).toBeNull();
    expect(inAppRingOnScreen({ cardCallId: null, pageVisible: false })).toBeNull();
  });
});

describe("callPushTag", () => {
  it("is a valid replacement key per call, so the page can close that call's web push", () => {
    const tag = callPushTag("cmh1abc2d0000xyzabcdefghi");
    expect(tag).toBe("call-cmh1abc2d0000xyzabcdefghi");
    expect(safeReplaceKey(tag)).toBe(tag);
    expect(callPushTag("a")).not.toBe(callPushTag("b"));
  });
});

it("re-ends CallKit's ring often enough that a late VoIP push is gone within a moment", () => {
  expect(CALLKIT_YIELD_INTERVAL_MS).toBeGreaterThan(0);
  expect(CALLKIT_YIELD_INTERVAL_MS).toBeLessThanOrEqual(1_000);
});

// One ring card app-wide: IncomingCallListener is mounted in exactly one place, and the quick-reply panel is only ever
// drawn inside it, so no second incoming-call card or Message panel can render.
describe("one in-app incoming-call card", () => {
  const SRC = join(process.cwd(), "src");

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (name === "generated" || name === "node_modules") return [];
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
  }

  const files = sourceFiles(SRC).map((path) => ({ path, text: readFileSync(path, "utf8") }));

  it("mounts IncomingCallListener once, in the root layout", () => {
    const mounts = files.flatMap(({ path, text }) =>
      (text.match(/<IncomingCallListener\b/g) ?? []).map(() => path.replace(/\\/g, "/")),
    );
    expect(mounts).toHaveLength(1);
    expect(mounts[0]).toMatch(/src\/app\/layout\.tsx$/);
  });

  it("draws the quick-reply panel only inside the incoming-call card", () => {
    const users = files
      .filter(({ text }) => /<CallQuickReplyPicker\b/.test(text))
      .map(({ path }) => path.replace(/\\/g, "/"));
    expect(users).toHaveLength(1);
    expect(users[0]).toMatch(/src\/components\/incoming-call-listener\.tsx$/);
  });

  it("renders a single card (one portal) per listener", () => {
    const listener = files.find(({ path }) => /incoming-call-listener\.tsx$/.test(path))!.text;
    expect(listener.match(/<OverlayPortal\b/g) ?? []).toHaveLength(1);
  });
});
