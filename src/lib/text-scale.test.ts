import { describe, expect, it } from "vitest";
import { TEXT_SCALE_SCRIPT } from "./text-scale";

type Listener = () => void;

/** Runs the inline script against a minimal fake DOM and reports what it did to <html>'s inline font-size. */
function run({
  measuredPx,
  ios = true,
  throwOnMeasure = false,
}: {
  measuredPx: number | (() => number);
  ios?: boolean;
  throwOnMeasure?: boolean;
}) {
  const style: Record<string, string> = {};
  let writes = 0;
  let probesInDom = 0;
  const listeners: Record<string, Listener[]> = {};
  const on = (name: string, fn: Listener) => {
    (listeners[name] ??= []).push(fn);
  };
  const rootStyle = {
    set fontSize(v: string) {
      writes++;
      style.fontSize = v;
    },
    get fontSize() {
      return style.fontSize;
    },
    removeProperty() {
      writes++;
      delete style.fontSize;
    },
  };
  const body = {
    appendChild: () => void probesInDom++,
    removeChild: () => void probesInDom--,
  };
  const document = {
    documentElement: { style: rootStyle },
    body,
    hidden: false,
    createElement: () => ({ style: {} }),
    addEventListener: on,
  };
  const window = {
    CSS: { supports: () => ios },
    getComputedStyle: () => {
      if (throwOnMeasure) throw new Error("blocked");
      return { fontSize: `${typeof measuredPx === "function" ? measuredPx() : measuredPx}px` };
    },
    setTimeout: () => 0,
    addEventListener: on,
  };
  new Function("window", "document", "CSS", TEXT_SCALE_SCRIPT)(window, document, window.CSS);
  return {
    fontSize: () => style.fontSize,
    writes: () => writes,
    probesInDom: () => probesInDom,
    listenerCount: () => Object.values(listeners).flat().length,
    fire: (name: string) => listeners[name]?.forEach((fn) => fn()),
  };
}

describe("TEXT_SCALE_SCRIPT", () => {
  it("leaves the root untouched at the default iOS text size (17px body)", () => {
    const r = run({ measuredPx: 17 });
    expect(r.fontSize()).toBeUndefined();
    expect(r.writes()).toBe(0);
    expect(r.probesInDom()).toBe(0);
  });

  it("scales the root in proportion to the measured body size", () => {
    expect(run({ measuredPx: 23 }).fontSize()).toBe("135.29%");
    expect(run({ measuredPx: 28 }).fontSize()).toBe("164.71%");
    expect(run({ measuredPx: 33 }).fontSize()).toBe("194.12%");
    expect(run({ measuredPx: 15 }).fontSize()).toBe("88.24%");
  });

  it("caps at the third accessibility step and floors at 87.5%", () => {
    expect(run({ measuredPx: 40 }).fontSize()).toBe("235.29%");
    expect(run({ measuredPx: 47 }).fontSize()).toBe("235.29%");
    expect(run({ measuredPx: 53 }).fontSize()).toBe("235.29%");
    expect(run({ measuredPx: 14 }).fontSize()).toBe("87.5%");
  });

  it("is a strict no-op off iOS: no measurement, no style, no listeners", () => {
    const r = run({ measuredPx: 13, ios: false });
    expect(r.fontSize()).toBeUndefined();
    expect(r.writes()).toBe(0);
    expect(r.listenerCount()).toBe(0);
  });

  it("falls back to the default root when measuring fails or returns nothing", () => {
    expect(run({ measuredPx: 33, throwOnMeasure: true }).fontSize()).toBeUndefined();
    expect(run({ measuredPx: 0 }).fontSize()).toBeUndefined();
    expect(run({ measuredPx: NaN }).fontSize()).toBeUndefined();
  });

  it("re-measures when the app comes back, writing only when the size changed", () => {
    let px = 17;
    const r = run({ measuredPx: () => px });
    expect(r.writes()).toBe(0);

    px = 33;
    r.fire("visibilitychange");
    expect(r.fontSize()).toBe("194.12%");
    expect(r.writes()).toBe(1);

    r.fire("focus");
    r.fire("pageshow");
    r.fire("resume");
    expect(r.writes()).toBe(1);

    px = 17;
    r.fire("resume");
    expect(r.fontSize()).toBeUndefined();
    expect(r.writes()).toBe(2);
    expect(r.probesInDom()).toBe(0);
  });
});
