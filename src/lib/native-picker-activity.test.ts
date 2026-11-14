import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CANCEL_GRACE_MS,
  IMPERATIVE_FAILSAFE_MS,
  IMPERATIVE_FAILSAFE_MS_ANDROID,
  IOS_DOUBLE_TAP_MS,
  SETTLE_MS,
  __resetNativePickerActivityForTests,
  __setPickerPlatformForTests,
  canOpenPicker,
  detectPickerPlatform,
  isNativePickerActive,
  markNativePickerInactive,
  openFilePicker,
  resolveStuckImperativePicker,
  shouldUseAndroidNativePicker,
  withNativePickerActive,
} from "./native-picker-activity";

/** An EventTarget that counts its live listeners, so leaks are visible. */
class CountingTarget extends EventTarget {
  listeners = new Map<string, number>();
  addEventListener(type: string, cb: EventListenerOrEventListenerObject | null, opts?: AddEventListenerOptions | boolean) {
    this.listeners.set(type, (this.listeners.get(type) ?? 0) + 1);
    super.addEventListener(type, cb, opts);
  }
  removeEventListener(type: string, cb: EventListenerOrEventListenerObject | null, opts?: EventListenerOptions | boolean) {
    this.listeners.set(type, Math.max(0, (this.listeners.get(type) ?? 0) - 1));
    super.removeEventListener(type, cb, opts);
  }
  total() {
    let n = 0;
    for (const v of this.listeners.values()) n += v;
    return n;
  }
}

class FakeDocument extends CountingTarget {
  visibilityState: "visible" | "hidden" = "visible";
  setVisibility(state: "visible" | "hidden") {
    this.visibilityState = state;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

class FakeInput extends CountingTarget {
  clicks = 0;
  click() {
    this.clicks++;
  }
}

let win: CountingTarget;
let doc: FakeDocument;

function input() {
  return new FakeInput() as unknown as HTMLInputElement & FakeInput;
}

beforeEach(() => {
  vi.useFakeTimers();
  __resetNativePickerActivityForTests();
  win = new CountingTarget();
  doc = new FakeDocument();
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
});

afterEach(() => {
  __resetNativePickerActivityForTests();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("detectPickerPlatform", () => {
  it("iPhone Safari / WKWebView", () => {
    expect(
      detectPickerPlatform({
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
        platform: "iPhone",
        maxTouchPoints: 5,
      }),
    ).toBe("ios");
  });

  it("iPadOS reporting as a Mac (touch points give it away)", () => {
    expect(
      detectPickerPlatform({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
        platform: "MacIntel",
        maxTouchPoints: 5,
      }),
    ).toBe("ios");
  });

  it("a real Mac is not iOS", () => {
    expect(
      detectPickerPlatform({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
        platform: "MacIntel",
        maxTouchPoints: 0,
      }),
    ).toBe("other");
  });

  it("Capacitor platform wins", () => {
    expect(detectPickerPlatform({ capacitorPlatform: "ios", userAgent: "" })).toBe("ios");
    expect(detectPickerPlatform({ capacitorPlatform: "android", userAgent: "" })).toBe("android");
  });

  it("Android Chrome", () => {
    expect(
      detectPickerPlatform({
        capacitorPlatform: "web",
        userAgent: "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36",
        platform: "Linux armv81",
        maxTouchPoints: 5,
      }),
    ).toBe("android");
  });

  it("desktop Windows Chrome", () => {
    expect(
      detectPickerPlatform({
        capacitorPlatform: "web",
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
        platform: "Win32",
        maxTouchPoints: 0,
      }),
    ).toBe("other");
  });

  it("only Capacitor Android with the plugin uses the native picker (never in a plain browser/node)", () => {
    __setPickerPlatformForTests("ios");
    expect(shouldUseAndroidNativePicker()).toBe(false);
    __setPickerPlatformForTests("other");
    expect(shouldUseAndroidNativePicker()).toBe(false);
    // Override says android, but Capacitor itself reports "web" here.
    __setPickerPlatformForTests("android");
    expect(shouldUseAndroidNativePicker()).toBe(false);
  });
});

describe("iOS", () => {
  beforeEach(() => __setPickerPlatformForTests("ios"));

  it("a dismissed sheet (no change event at all) never blocks the next tap", () => {
    const el = input();
    expect(openFilePicker(el)).toBe(true);
    expect(el.clicks).toBe(1);
    expect(isNativePickerActive()).toBe(false);
    // User dismisses the sheet: iOS fires nothing. Tap again later.
    vi.advanceTimersByTime(IOS_DOUBLE_TAP_MS);
    expect(openFilePicker(el)).toBe(true);
    expect(el.clicks).toBe(2);
    vi.advanceTimersByTime(IOS_DOUBLE_TAP_MS);
    expect(openFilePicker(el)).toBe(true);
    expect(el.clicks).toBe(3);
  });

  it("cancel / focus / visibilitychange are harmless and the next tap opens", () => {
    const el = input();
    openFilePicker(el, 0);
    el.dispatchEvent(new Event("cancel"));
    win.dispatchEvent(new Event("focus"));
    doc.setVisibility("visible");
    vi.advanceTimersByTime(CANCEL_GRACE_MS + 10);
    expect(isNativePickerActive()).toBe(false);
    expect(openFilePicker(el, IOS_DOUBLE_TAP_MS + 1)).toBe(true);
  });

  it("a rapid double tap opens one picker, then the next tap after the window opens again (no deadlock)", () => {
    const el = input();
    expect(openFilePicker(el, 1000)).toBe(true);
    expect(openFilePicker(el, 1000 + 50)).toBe(false);
    expect(el.clicks).toBe(1);
    expect(openFilePicker(el, 1000 + IOS_DOUBLE_TAP_MS)).toBe(true);
    expect(el.clicks).toBe(2);
  });

  it("attaches no listeners at all", () => {
    const el = input();
    openFilePicker(el);
    expect(el.total()).toBe(0);
    expect(win.total()).toBe(0);
    expect(doc.total()).toBe(0);
  });

  it("a real change still works and the next pick is allowed", () => {
    const el = input();
    openFilePicker(el, 0);
    el.dispatchEvent(new Event("change"));
    markNativePickerInactive();
    vi.advanceTimersByTime(SETTLE_MS);
    expect(isNativePickerActive()).toBe(false);
    expect(openFilePicker(el, 5000)).toBe(true);
  });

  it("missing input opens nothing", () => {
    expect(openFilePicker(null)).toBe(false);
    expect(openFilePicker(undefined)).toBe(false);
  });
});

describe("Android (existing Activity hand-off semantics)", () => {
  beforeEach(() => __setPickerPlatformForTests("android"));

  it("blocks a second tap while a pick is in flight", () => {
    const a = input();
    expect(openFilePicker(a)).toBe(true);
    expect(isNativePickerActive()).toBe(true);
    expect(canOpenPicker()).toBe(false);
    expect(openFilePicker(a)).toBe(false);
    expect(a.clicks).toBe(1);
  });

  it("change clears after SETTLE_MS, cancels the failsafe, and removes listeners", () => {
    const a = input();
    openFilePicker(a);
    expect(a.total()).toBeGreaterThan(0);
    a.dispatchEvent(new Event("change"));
    markNativePickerInactive(); // the input's onChange
    expect(isNativePickerActive()).toBe(true); // settle window for a late resume
    vi.advanceTimersByTime(SETTLE_MS);
    expect(isNativePickerActive()).toBe(false);
    expect(a.total()).toBe(0);
    expect(win.total()).toBe(0);
    expect(doc.total()).toBe(0);
    // No delayed failsafe/grace callback flips anything later.
    openFilePicker(a);
    vi.advanceTimersByTime(CANCEL_GRACE_MS * 2);
    expect(isNativePickerActive()).toBe(true);
  });

  it("a dismissed chooser (hidden -> visible, no change) is resolved after the grace", () => {
    const a = input();
    openFilePicker(a);
    doc.setVisibility("hidden");
    doc.setVisibility("visible");
    // A resume landing right now must still see the guard up.
    expect(isNativePickerActive()).toBe(true);
    vi.advanceTimersByTime(CANCEL_GRACE_MS - 1);
    expect(isNativePickerActive()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(isNativePickerActive()).toBe(false);
    expect(a.total() + win.total() + doc.total()).toBe(0);
    expect(openFilePicker(a)).toBe(true);
  });

  it("the input's cancel event resolves it", () => {
    const a = input();
    openFilePicker(a);
    a.dispatchEvent(new Event("cancel"));
    vi.advanceTimersByTime(CANCEL_GRACE_MS);
    expect(isNativePickerActive()).toBe(false);
  });

  it("window focus only counts after the window was left (blur)", () => {
    const a = input();
    openFilePicker(a);
    win.dispatchEvent(new Event("focus"));
    vi.advanceTimersByTime(CANCEL_GRACE_MS * 2);
    expect(isNativePickerActive()).toBe(true);
    win.dispatchEvent(new Event("blur"));
    win.dispatchEvent(new Event("focus"));
    vi.advanceTimersByTime(CANCEL_GRACE_MS);
    expect(isNativePickerActive()).toBe(false);
  });

  it("a change that lands inside the grace wins, with no double clear", () => {
    const a = input();
    openFilePicker(a);
    doc.setVisibility("hidden");
    doc.setVisibility("visible");
    vi.advanceTimersByTime(CANCEL_GRACE_MS / 2);
    a.dispatchEvent(new Event("change"));
    markNativePickerInactive();
    vi.advanceTimersByTime(CANCEL_GRACE_MS);
    // Still within SETTLE_MS of the change: the grace timer did not cut it short.
    expect(isNativePickerActive()).toBe(true);
    vi.advanceTimersByTime(SETTLE_MS);
    expect(isNativePickerActive()).toBe(false);
  });

  it("the resume backstop still force-clears", () => {
    const a = input();
    openFilePicker(a);
    resolveStuckImperativePicker();
    expect(isNativePickerActive()).toBe(false);
    expect(a.total() + win.total() + doc.total()).toBe(0);
  });

  it("failsafe clears after 60s while visible", () => {
    openFilePicker(input());
    vi.advanceTimersByTime(IMPERATIVE_FAILSAFE_MS_ANDROID - 1);
    expect(isNativePickerActive()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(isNativePickerActive()).toBe(false);
  });

  it("a genuine slow pick (document hidden under the Activity) outlives the failsafe", () => {
    const a = input();
    openFilePicker(a);
    doc.setVisibility("hidden");
    vi.advanceTimersByTime(IMPERATIVE_FAILSAFE_MS_ANDROID * 3);
    expect(isNativePickerActive()).toBe(true);
    doc.setVisibility("visible");
    a.dispatchEvent(new Event("change"));
    markNativePickerInactive();
    vi.advanceTimersByTime(SETTLE_MS);
    expect(isNativePickerActive()).toBe(false);
  });

  it("the promise track blocks taps too and clears after settling", async () => {
    let resolve!: () => void;
    const p = withNativePickerActive(() => new Promise<void>((r) => (resolve = r)));
    expect(canOpenPicker()).toBe(false);
    resolve();
    await p;
    vi.advanceTimersByTime(SETTLE_MS);
    expect(canOpenPicker()).toBe(true);
  });
});

describe("desktop / other", () => {
  beforeEach(() => __setPickerPlatformForTests("other"));

  it("uses the 15s failsafe", () => {
    openFilePicker(input());
    vi.advanceTimersByTime(IMPERATIVE_FAILSAFE_MS);
    expect(isNativePickerActive()).toBe(false);
  });

  it("a closed file dialog (blur then focus) frees the next tap", () => {
    const a = input();
    openFilePicker(a);
    win.dispatchEvent(new Event("blur"));
    win.dispatchEvent(new Event("focus"));
    vi.advanceTimersByTime(CANCEL_GRACE_MS);
    expect(openFilePicker(a)).toBe(true);
  });

  it("re-arming for another input removes the first one's listeners", () => {
    const a = input();
    const b = input();
    openFilePicker(a);
    resolveStuckImperativePicker();
    openFilePicker(b);
    expect(a.total()).toBe(0);
    expect(b.total()).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Source guards
// ---------------------------------------------------------------------------

const SRC = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "generated" || name === "node_modules") continue;
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("source guards", () => {
  const files = sourceFiles(SRC).map((p) => ({ rel: relative(SRC, p).replace(/\\/g, "/"), text: readFileSync(p, "utf8") }));
  const HELPER = "lib/native-picker-activity.ts";

  it("no component marks the picker active by hand", () => {
    const offenders = files.filter((f) => f.rel !== HELPER && /\bmarkNativePickerActive\s*\(/.test(f.text)).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("no file input is clicked outside openFilePicker", () => {
    const offenders = files
      .filter((f) => f.rel !== HELPER && /\w+Ref\.current\??\.click\(\)/.test(f.text))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("a handler that opens a file picker never awaits before it, except on the Android-native branch", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (!f.text.includes("openFilePicker(")) continue;
      // An async tap handler whose body reaches openFilePicker.
      const asyncHandler = /(onSelect:\s*async|onClick=\{\s*async)[\s\S]{0,1500}?openFilePicker\(/g;
      for (const m of f.text.matchAll(asyncHandler)) {
        // Allowed only if the first statement is the synchronous Android split.
        if (!/shouldUseAndroidNativePicker\(\)/.test(m[0])) offenders.push(`${f.rel}: async handler`);
      }
      // Every native-picker await must sit behind the synchronous check.
      for (const m of f.text.matchAll(/await\s+pick(?:Images|Video)Native\(/g)) {
        const before = f.text.slice(Math.max(0, (m.index ?? 0) - 1200), m.index);
        if (!/if\s*\(\s*!shouldUseAndroidNativePicker\(\)\s*\)\s*\{\s*openFilePicker\(/.test(before)) {
          offenders.push(`${f.rel}: await pick*Native without the synchronous non-Android openFilePicker branch`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every file input wired to the picker guard resets its value on change", () => {
    const offenders: string[] = [];
    for (const f of files) {
      for (const m of f.text.matchAll(/onChange=\{\(e\) => \{\s*markNativePickerInactive\(\);([\s\S]*?)\n\s*\}\}/g)) {
        if (!/e\.target\.value\s*=\s*""/.test(m[1])) offenders.push(f.rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
