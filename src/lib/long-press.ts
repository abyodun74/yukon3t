// Long press on a card (a Circle in a list, see circle-long-press.tsx): the pure parts, unit-tested in Vitest's node
// environment. The press itself is the app's one long-press state machine, `longPressReducer` (src/lib/link-copy-menu.ts,
// also behind the app-wide link menu), run with this file's delay: movement past the slop, a second finger, a scroll,
// lifting the finger or a cancel all end the press without firing. `useLongPress` (src/lib/use-long-press.ts) feeds it.

import {
  LONG_PRESS_IDLE,
  LONG_PRESS_SLOP_PX,
  longPressReducer,
  type LongPressEvent,
  type LongPressResult,
  type LongPressState,
} from "@/lib/link-copy-menu";

/** How long a finger has to stay on a card before its menu opens. */
export const CARD_LONG_PRESS_MS = 500;
/** How far (px, either axis) the finger may drift before the press counts as a scroll. */
export const CARD_LONG_PRESS_SLOP_PX = LONG_PRESS_SLOP_PX;
/** After a long press fired, the click the release would synthesize within this window is swallowed (no navigation). */
export const LONG_PRESS_CLICK_SUPPRESS_MS = 800;
/** A `contextmenu` this soon after a touch came from that touch (Android fires one during a long press). */
export const CONTEXT_MENU_FROM_TOUCH_MS = 2000;

export { LONG_PRESS_IDLE };
export type { LongPressEvent, LongPressResult, LongPressState };

/** One step of a card's long press: the shared reducer with the card delay and slop. */
export function cardLongPressStep(state: LongPressState, event: LongPressEvent): LongPressResult {
  return longPressReducer(state, event, { delayMs: CARD_LONG_PRESS_MS, slopPx: CARD_LONG_PRESS_SLOP_PX });
}

/**
 * Controls inside a card keep their own press behaviour: a long press that starts on a button, a field or something
 * marked `data-no-card-press` never opens the card's menu (the card's own link is not a control here).
 */
export const CARD_PRESS_IGNORE_SELECTOR =
  'button, input, textarea, select, [role="button"], [contenteditable="true"], [data-no-card-press]';

/** The subset of `Element` this reads. */
export interface PressElementLike {
  closest(selector: string): unknown;
}

/** Should a press starting on `target` be left alone (a control inside the card)? */
export function isIgnoredCardPressTarget(target: PressElementLike | null | undefined): boolean {
  if (!target || typeof target.closest !== "function") return false;
  return target.closest(CARD_PRESS_IGNORE_SELECTOR) !== null;
}

/** The keyboard way to open a context menu: the ContextMenu ("Apps") key, or Shift+F10. */
export function isContextMenuShortcut(event: { key: string; shiftKey: boolean }): boolean {
  return event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");
}

/**
 * Should a `contextmenu` event at `now` be ignored because the long press it belongs to already opened the menu?
 * (Android fires `contextmenu` during a touch long press, before or after our own timer.)
 */
export function isDuplicateContextMenu(now: number, suppressClickUntil: number): boolean {
  return now < suppressClickUntil;
}
