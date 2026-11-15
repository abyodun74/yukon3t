import { describe, expect, it } from "vitest";
import {
  DIRECTION_LOCK_PX,
  FLICK_MAX_AGE_MS,
  STORY_DISMISS_DISTANCE_PX,
  STORY_DISMISS_EASING,
  STORY_DISMISS_MIN_OPACITY,
  STORY_DISMISS_VELOCITY_PX_PER_S,
  STORY_GESTURE_CONTROL_SELECTOR,
  canStartStoryDismiss,
  decideStoryDismiss,
  dismissOffset,
  dismissVisual,
  lockGestureAxis,
  releaseIntent,
  releaseVelocity,
  startsOnControl,
  velocityBetween,
} from "./story-dismiss-gesture";

describe("lockGestureAxis", () => {
  it("stays undecided inside the dead zone", () => {
    expect(lockGestureAxis(0, 0)).toBeNull();
    expect(lockGestureAxis(6, 6)).toBeNull(); // ~8.5px
    expect(lockGestureAxis(0, DIRECTION_LOCK_PX - 0.1)).toBeNull();
  });

  it("locks to the dominant axis once past ~10px", () => {
    expect(lockGestureAxis(2, 12)).toBe("vertical");
    expect(lockGestureAxis(-3, -15)).toBe("vertical");
    expect(lockGestureAxis(12, 3)).toBe("horizontal");
    expect(lockGestureAxis(-40, 20)).toBe("horizontal");
  });

  it("treats an exact diagonal as horizontal, so it never starts closing", () => {
    expect(lockGestureAxis(10, 10)).toBe("horizontal");
  });
});

describe("decideStoryDismiss", () => {
  it("dismisses past the distance threshold", () => {
    expect(decideStoryDismiss(STORY_DISMISS_DISTANCE_PX, 0)).toBe("dismiss");
    expect(decideStoryDismiss(300, 0)).toBe("dismiss");
  });

  it("dismisses on a fast downward flick even when short", () => {
    expect(decideStoryDismiss(30, STORY_DISMISS_VELOCITY_PX_PER_S)).toBe("dismiss");
  });

  it("snaps back when short and slow, or when not moved down at all", () => {
    expect(decideStoryDismiss(STORY_DISMISS_DISTANCE_PX - 1, 200)).toBe("snap-back");
    expect(decideStoryDismiss(0, 5000)).toBe("snap-back");
    expect(decideStoryDismiss(40, -2000)).toBe("snap-back");
  });

  it("uses the same thresholds as Sheet's drag-to-dismiss", () => {
    expect(STORY_DISMISS_DISTANCE_PX).toBe(120);
    expect(STORY_DISMISS_VELOCITY_PX_PER_S).toBe(800);
  });
});

describe("velocity", () => {
  it("measures px/s between samples", () => {
    expect(velocityBetween(100, 1000, 150, 1050)).toBe(1000);
    expect(velocityBetween(100, 1000, 100, 1000)).toBe(0);
  });

  it("drops a flick when the finger stopped before lifting", () => {
    expect(releaseVelocity(1500, 16)).toBe(1500);
    expect(releaseVelocity(1500, FLICK_MAX_AGE_MS + 1)).toBe(0);
  });
});

describe("dismiss visuals", () => {
  it("follows the finger down only", () => {
    expect(dismissOffset(-50)).toBe(0);
    expect(dismissOffset(80)).toBe(80);
  });

  it("fades and shrinks but never grows or goes invisible mid-drag", () => {
    expect(dismissVisual(0)).toEqual({ translateY: 0, opacity: 1, scale: 1 });
    for (const y of [10, 120, 400, 2000]) {
      const v = dismissVisual(y);
      expect(v.scale).toBeLessThanOrEqual(1);
      expect(v.opacity).toBeGreaterThanOrEqual(STORY_DISMISS_MIN_OPACITY);
      expect(v.opacity).toBeLessThanOrEqual(1);
    }
  });

  it("eases out without overshoot", () => {
    const [, y1, , y2] = STORY_DISMISS_EASING.match(/cubic-bezier\(([^)]+)\)/)![1].split(",").map(Number);
    expect(y1).toBeGreaterThanOrEqual(0);
    expect(y1).toBeLessThanOrEqual(1);
    expect(y2).toBeGreaterThanOrEqual(0);
    expect(y2).toBeLessThanOrEqual(1);
  });
});

describe("where a drag may start", () => {
  it("never on a control or while a panel/sheet is open", () => {
    expect(canStartStoryDismiss({ onControl: false, layerOpen: false })).toBe(true);
    expect(canStartStoryDismiss({ onControl: true, layerOpen: false })).toBe(false);
    expect(canStartStoryDismiss({ onControl: false, layerOpen: true })).toBe(false);
  });

  // A tiny stand-in for Element.closest: the element matches the selector part named by its "kind".
  const el = (kind: string | null) => ({
    closest: (selector: string) => (kind && selector.split(",").map((p) => p.trim()).includes(kind) ? {} : null),
  });

  it("treats the reply field, buttons and links as controls, but not the tap zones", () => {
    expect(startsOnControl(el("input"))).toBe(true);
    expect(startsOnControl(el("textarea"))).toBe(true);
    expect(startsOnControl(el("a"))).toBe(true);
    expect(startsOnControl(el("button:not([data-story-zone])"))).toBe(true);
    expect(startsOnControl(el(null))).toBe(false);
    expect(startsOnControl(null)).toBe(false);
    expect(STORY_GESTURE_CONTROL_SELECTOR).toContain("button:not([data-story-zone])");
    expect(STORY_GESTURE_CONTROL_SELECTOR).toContain('[role="dialog"]:not([data-story-viewer])');
  });
});

describe("releaseIntent", () => {
  it("a vertical drag never navigates; sideways and still presses keep tap/swipe/hold", () => {
    expect(releaseIntent("vertical")).toBe("dismiss-gesture");
    expect(releaseIntent("horizontal")).toBe("navigate");
    expect(releaseIntent(null)).toBe("navigate");
  });
});
