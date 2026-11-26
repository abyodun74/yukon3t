import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  callPushTag,
  inAppRingOnScreen,
  systemRingFor,
  systemRingGivesWay,
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

describe("systemRingGivesWay", () => {
  it("never ends CallKit's ring for the card: its Accept / Decline must keep answering / declining the call", () => {
    expect(systemRingGivesWay("callKit")).toBe(false);
  });

  it("lets the Android ring and the browser push give way to the card", () => {
    expect(systemRingGivesWay("androidRing")).toBe(true);
    expect(systemRingGivesWay("browserNotification")).toBe(true);
  });
});

// The iOS half of the fix for 64b5d61: CallKit's ring is never ended because the card is on screen, and CallKit's own
// Accept / Decline (live events and the native queue) go through the same answer / decline paths as before.
describe("CallKit taps drive the call", () => {
  const listener = readFileSync(join(process.cwd(), "src/components/incoming-call-listener.tsx"), "utf8");
  const ringSync = readFileSync(join(process.cwd(), "src/lib/callkit-ring-sync.ts"), "utf8");

  it("has no page-side end of a CallKit ring just because the card is showing", () => {
    expect(listener).not.toMatch(/yieldToApp|yieldedToApp|CALLKIT_YIELD/);
    expect(ringSync).not.toMatch(/yieldToApp|yieldedToApp|canEndRing/);
  });

  it("answers on CallKit's Accept and declines on its Decline, live and from the native queue", () => {
    expect(listener).toMatch(/addListener\("callAnswered",[\s\S]*?answeredOutOfApp\(event\.callId\)/);
    expect(listener).toMatch(/addListener\("callDeclined",[\s\S]*?declinedOutOfApp\(event\.callId\)/);
    expect(listener).toMatch(/pending\?\.answered\.forEach\(answeredOutOfApp\)/);
    expect(listener).toMatch(/pending\?\.declined\.forEach\(declinedOutOfApp\)/);
  });

  it("answers from the card without telling the server CallKit has no call (its ring is still CallKit's)", () => {
    expect(listener).toMatch(/respondToCall\(callId, true, currentCallDevice\(\)\)/);
  });
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
