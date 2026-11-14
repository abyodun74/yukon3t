import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeAllOverlays, openOverlayCount, registerOverlay, sessionStartClosesOverlays } from "./overlay-registry";

const read = (file: string) => readFileSync(join(import.meta.dirname, "..", file), "utf8");

afterEach(() => {
  closeAllOverlays();
});

describe("overlay registry", () => {
  it("closes every registered overlay and forgets them", () => {
    const a = vi.fn();
    const b = vi.fn();
    registerOverlay(a);
    registerOverlay(b, "confirm");
    expect(openOverlayCount()).toBe(2);
    expect(closeAllOverlays()).toBe(2);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(openOverlayCount()).toBe(0);
  });

  it("leaves alone an overlay that already unregistered (closed by itself)", () => {
    const a = vi.fn();
    const unregister = registerOverlay(a);
    unregister();
    unregister();
    expect(closeAllOverlays()).toBe(0);
    expect(a).not.toHaveBeenCalled();
  });

  it("is safe to run twice: a double call start never closes the same overlay twice", () => {
    const a = vi.fn();
    const unregister = registerOverlay(a);
    closeAllOverlays();
    closeAllOverlays();
    // The overlay's own cleanup still runs afterwards (its effect), harmlessly.
    unregister();
    expect(a).toHaveBeenCalledTimes(1);
  });

  it("doesn't close an overlay opened by a close function while it runs", () => {
    const later = vi.fn();
    registerOverlay(() => {
      registerOverlay(later);
    });
    expect(closeAllOverlays()).toBe(1);
    expect(later).not.toHaveBeenCalled();
    expect(openOverlayCount()).toBe(1);
  });

  it("keeps closing the rest when one close function throws", () => {
    const after = vi.fn();
    registerOverlay(() => {
      throw new Error("boom");
    });
    registerOverlay(after);
    expect(closeAllOverlays()).toBe(1);
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("can close only some kinds", () => {
    const sheet = vi.fn();
    const confirm = vi.fn();
    registerOverlay(sheet, "sheet");
    registerOverlay(confirm, "confirm");
    expect(closeAllOverlays((kind) => kind === "sheet")).toBe(1);
    expect(sheet).toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe("a starting call closes the overlays", () => {
  it("for a new 1:1 / group / Collab session, not for the same session again nor a live stream", () => {
    expect(sessionStartClosesOverlays(null, { key: "call:1", renderer: "direct" })).toBe(true);
    expect(sessionStartClosesOverlays(undefined, { key: "collab:1" })).toBe(true);
    expect(sessionStartClosesOverlays("call:1", { key: "call:2", renderer: "direct" })).toBe(true);
    expect(sessionStartClosesOverlays("call:1", { key: "call:1", renderer: "direct" })).toBe(false);
    expect(sessionStartClosesOverlays(null, { key: "live:1", renderer: "custom" })).toBe(false);
  });

  it("is wired into CallSessionProvider.startSession, before its same-session early return", () => {
    const source = read("lib/call-session.tsx");
    const start = source.slice(source.indexOf("const startSession = useCallback"));
    const close = start.indexOf("if (sessionStartClosesOverlays(sessionRef.current?.key, next)) closeAllOverlays();");
    expect(close).toBeGreaterThan(0);
    expect(close).toBeLessThan(start.indexOf("if (sessionRef.current?.key === next.key)"));
  });

  it("closes them when an outgoing call starts ringing, but never through the Calling sheet's own cancel", () => {
    const button = read("components/call-button.tsx");
    const call = button.slice(button.indexOf("async function call("));
    expect(call.indexOf("closeAllOverlays()")).toBeGreaterThan(0);
    expect(call.indexOf("closeAllOverlays()")).toBeLessThan(call.indexOf('phase: "ringing"'));
    expect(button).toMatch(/open=\{state\.phase === "ringing"\}\s*onClose=\{cancel\}[\s\S]{0,200}closeOnCallStart=\{false\}/);
  });

  it("registers every open Sheet (unless it opts out) through its latest onClose", () => {
    const sheet = read("components/sheet.tsx");
    expect(sheet).toMatch(/closeOnCallStart = true/);
    expect(sheet).toMatch(/if \(!open \|\| !closeOnCallStart\) return undefined;/);
    expect(sheet).toMatch(/return registerOverlay\(\(\) => onCloseRef\.current\(\), kind\);/);
  });
});
