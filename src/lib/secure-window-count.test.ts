import { describe, expect, it } from "vitest";
import { createSecureWindowCounter } from "@/lib/secure-window-count";

describe("createSecureWindowCounter", () => {
  it("turns protection on with the first holder and off only after the last", () => {
    const calls: boolean[] = [];
    const counter = createSecureWindowCounter((on) => calls.push(on));
    const a = counter.acquire();
    const b = counter.acquire();
    expect(calls).toEqual([true]);
    a();
    expect(calls).toEqual([true]);
    b();
    expect(calls).toEqual([true, false]);
    expect(counter.holders).toBe(0);
  });

  it("counts a release only once, so a double cleanup can't switch it off under another holder", () => {
    const calls: boolean[] = [];
    const counter = createSecureWindowCounter((on) => calls.push(on));
    const a = counter.acquire();
    const b = counter.acquire();
    a();
    a();
    expect(calls).toEqual([true]);
    expect(counter.holders).toBe(1);
    b();
    expect(calls).toEqual([true, false]);
  });

  it("re-enables after being fully released (open, close, open again)", () => {
    const calls: boolean[] = [];
    const counter = createSecureWindowCounter((on) => calls.push(on));
    counter.acquire()();
    counter.acquire();
    expect(calls).toEqual([true, false, true]);
  });
});
