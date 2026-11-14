import { describe, expect, it } from "vitest";
import {
  CARD_LONG_PRESS_MS,
  CARD_PRESS_IGNORE_SELECTOR,
  LONG_PRESS_IDLE,
  cardLongPressStep,
  isContextMenuShortcut,
  isDuplicateContextMenu,
  isIgnoredCardPressTarget,
  type LongPressEvent,
  type LongPressState,
} from "@/lib/long-press";

function run(events: LongPressEvent[]) {
  let state: LongPressState = LONG_PRESS_IDLE;
  let fired = 0;
  for (const e of events) {
    const r = cardLongPressStep(state, e);
    state = r.state;
    if (r.fire) fired++;
  }
  return { state, fired };
}

const down = (at = 0, touches = 1): LongPressEvent => ({ type: "down", id: 1, x: 100, y: 100, at, touches });

describe("card long press timing", () => {
  it("opens after about 500 ms held still", () => {
    expect(CARD_LONG_PRESS_MS).toBe(500);
    expect(run([down(0), { type: "timeout", id: 1, at: 500 }]).fired).toBe(1);
  });

  it("does nothing for a timer that ran early or belongs to an earlier press", () => {
    expect(run([down(0), { type: "timeout", id: 1, at: 499 }]).fired).toBe(0);
    expect(run([down(0), { type: "timeout", id: 7, at: 600 }]).fired).toBe(0);
  });

  it("fires once per press", () => {
    expect(
      run([down(0), { type: "timeout", id: 1, at: 500 }, { type: "timeout", id: 1, at: 900 }]).fired,
    ).toBe(1);
  });

  it("tolerates a finger that drifts up to 10 px", () => {
    expect(run([down(0), { type: "move", x: 110, y: 90 }, { type: "timeout", id: 1, at: 500 }]).fired).toBe(1);
  });
});

describe("card long press cancellation", () => {
  it.each<[string, LongPressEvent]>([
    ["moving more than 10 px (a scroll or swipe)", { type: "move", x: 100, y: 111 }],
    ["a scroll", { type: "scroll" }],
    ["lifting the finger", { type: "up" }],
    ["a touchcancel", { type: "cancel" }],
  ])("is cancelled by %s", (_label, event) => {
    const { state, fired } = run([down(0), event, { type: "timeout", id: 1, at: 500 }]);
    expect(fired).toBe(0);
    expect(state.phase).toBe("idle");
  });

  it("never starts with a second finger on the screen (pinch)", () => {
    expect(run([down(0, 2), { type: "timeout", id: 1, at: 500 }]).fired).toBe(0);
  });
});

describe("card press helpers", () => {
  it("knows the keyboard context-menu shortcuts", () => {
    expect(isContextMenuShortcut({ key: "ContextMenu", shiftKey: false })).toBe(true);
    expect(isContextMenuShortcut({ key: "F10", shiftKey: true })).toBe(true);
    expect(isContextMenuShortcut({ key: "F10", shiftKey: false })).toBe(false);
    expect(isContextMenuShortcut({ key: "Enter", shiftKey: true })).toBe(false);
  });

  it("leaves presses on controls inside a card alone", () => {
    const inside = (match: boolean) => ({
      closest: (selector: string) => (match && selector === CARD_PRESS_IGNORE_SELECTOR ? {} : null),
    });
    expect(isIgnoredCardPressTarget(inside(true))).toBe(true);
    expect(isIgnoredCardPressTarget(inside(false))).toBe(false);
    expect(isIgnoredCardPressTarget(null)).toBe(false);
    expect(CARD_PRESS_IGNORE_SELECTOR).toContain("button");
    expect(CARD_PRESS_IGNORE_SELECTOR).not.toMatch(/(^|,\s*)a(\[|,|$)/);
  });

  it("ignores the contextmenu Android sends for a press that already opened the sheet", () => {
    expect(isDuplicateContextMenu(1000, 1500)).toBe(true);
    expect(isDuplicateContextMenu(1600, 1500)).toBe(false);
  });
});
