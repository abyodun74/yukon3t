import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { callsEn } from "@/lib/i18n/en/calls";
import { canShareScreen, screenShareFailure } from "@/lib/screen-share-support";

describe("canShareScreen", () => {
  const desktop = { isNativeApp: false, hasGetDisplayMedia: true, dailySupportsScreenShare: true };

  it("offers it in a desktop browser with getDisplayMedia", () => {
    expect(canShareScreen(desktop)).toBe(true);
  });

  it("never offers it in the native app, whatever the WebView reports", () => {
    expect(canShareScreen({ ...desktop, isNativeApp: true })).toBe(false);
  });

  it("hides it where getDisplayMedia is missing (Android WebView, mobile Chrome, iOS Safari)", () => {
    expect(canShareScreen({ ...desktop, hasGetDisplayMedia: false })).toBe(false);
    expect(canShareScreen({ ...desktop, hasGetDisplayMedia: false, dailySupportsScreenShare: null })).toBe(false);
  });

  it("follows Daily's own verdict when it says no, and the feature check when Daily's is unknown", () => {
    expect(canShareScreen({ ...desktop, dailySupportsScreenShare: false })).toBe(false);
    expect(canShareScreen({ ...desktop, dailySupportsScreenShare: null })).toBe(true);
  });
});

describe("screenShareFailure", () => {
  it("ignores every non-fatal error that isn't a screen share", () => {
    expect(screenShareFailure(null)).toBeNull();
    expect(screenShareFailure({ type: "input-settings-error", errorMsg: "boom" })).toBeNull();
  });

  it("tells an OS-level block apart (macOS Screen Recording permission)", () => {
    expect(screenShareFailure({ type: "screen-share-error", errorMsg: "NotAllowedError: Permission denied by system" })).toBe(
      "system_denied",
    );
  });

  it("treats the person closing the picker as a choice, not an error", () => {
    expect(screenShareFailure({ type: "screen-share-error", errorMsg: "NotAllowedError: Permission denied" })).toBeNull();
  });

  it("reports an unsupported platform", () => {
    expect(screenShareFailure({ type: "screen-share-error", errorMsg: "getDisplayMedia is not a function" })).toBe("unsupported");
    expect(screenShareFailure({ type: "screen-share-error", errorMsg: "Screen sharing is not supported" })).toBe("unsupported");
  });

  it("falls back to a generic failure, including a missing message", () => {
    expect(screenShareFailure({ type: "screen-share-error", errorMsg: "NotReadableError: Could not start video source" })).toBe("failed");
    expect(screenShareFailure({ type: "screen-share-error" })).toBe("failed");
  });

  it("has a sentence for every failure kind", () => {
    for (const kind of ["system_denied", "unsupported", "failed"] as const) {
      expect(callsEn.controls.screenShareErrors[kind]).toBeTruthy();
    }
  });
});

// The three call UIs used to render a Share screen control unconditionally, which in the native app (no
// getDisplayMedia in Android WebView or WKWebView) was a button that did nothing at all.
describe("call UIs gate screen share on support", () => {
  const read = (file: string) => readFileSync(path.join(process.cwd(), "src/components", file), "utf8");

  it.each(["direct-call-frame.tsx", "live-video-frame.tsx"])("%s hides the button unless supported or already sharing", (file) => {
    const src = read(file);
    expect(src).toContain("useScreenShareSupport()");
    expect(src).toContain("useScreenShareFailure(callObject)");
    expect(src).toContain("(screenShareSupported || localScreenSharing) && (");  });

  it("call-frame.tsx only adds the tray button where supported", () => {
    const src = read("call-frame.tsx");
    expect(src).toContain("canShareScreen(");
    expect(src).toContain("} else if (screenShareSupported) {");
  });
});
