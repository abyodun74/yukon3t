import { describe, expect, it, vi } from "vitest";
import { createPreviewSlot } from "@/lib/live-preview-slot";

describe("createPreviewSlot", () => {
  it("gives the slot to the newest claimant and hands it back on release", () => {
    const slot = createPreviewSlot();
    expect(slot.owner()).toBeNull();
    slot.claim("a");
    slot.claim("b");
    expect(slot.owner()).toBe("b");
    slot.release("b");
    expect(slot.owner()).toBe("a");
    slot.release("a");
    expect(slot.owner()).toBeNull();
  });

  it("releasing a non-owner leaves the owner alone", () => {
    const slot = createPreviewSlot();
    slot.claim("a");
    slot.claim("b");
    slot.release("a");
    expect(slot.owner()).toBe("b");
    slot.release("b");
    expect(slot.owner()).toBeNull();
  });

  it("re-claiming moves a card to the top", () => {
    const slot = createPreviewSlot();
    slot.claim("a");
    slot.claim("b");
    slot.claim("a");
    expect(slot.owner()).toBe("a");
  });

  it("notifies only when the owner changes", () => {
    const slot = createPreviewSlot();
    const listener = vi.fn();
    const unsubscribe = slot.subscribe(listener);
    slot.claim("a");
    slot.claim("b");
    slot.release("a"); // not the owner
    slot.release("zzz"); // never claimed
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    slot.release("b");
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
