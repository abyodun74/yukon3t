import { describe, expect, it } from "vitest";
import { APP_DEFAULT_TRANSITION } from "@/lib/motion-defaults";
import { bezierOvershoots } from "@/components/motion-guard";
import {
  FULL_FRAME,
  MUSE_CARD_MAX_ASPECT,
  MUSE_COMMENTS_INSTANT,
  MUSE_COMMENTS_TRANSITION,
  museCommentsFrame,
} from "@/lib/muse-comments-layout";

/** Where the clip's rectangle ends up on screen, from the frame (scale about the centre, then move by y). */
function onScreen(frame: ReturnType<typeof museCommentsFrame>, width: number, height: number) {
  const [top, right, bottom, left] = [...frame.clipPath.matchAll(/(-?[0-9.]+)px/g)].map((m) => Number(m[1]));
  const s = frame.scale;
  const toY = (y: number) => height / 2 + (y - height / 2) * s + frame.y;
  const toX = (x: number) => width / 2 + (x - width / 2) * s;
  return { top: toY(top), bottom: toY(height - bottom), left: toX(left), right: toX(width - right) };
}

describe("museCommentsFrame", () => {
  it("shrinks a phone-sized Muse into a centred rounded card above a ~60% sheet", () => {
    const [w, h, inset] = [390, 844, 47];
    const frame = museCommentsFrame({ width: w, height: h, topInset: inset });
    expect(frame.scale).toBeGreaterThan(0);
    expect(frame.scale).toBeLessThanOrEqual(1);
    expect(frame.sheetHeight).toBe(Math.round(h * 0.6));
    const card = onScreen(frame, w, h);
    expect(card.top).toBeCloseTo(inset + 12, 0);
    expect(card.bottom).toBeCloseTo(h - frame.sheetHeight - 12, 0);
    expect(card.left + card.right).toBeCloseTo(w, 0);
    expect(card.right - card.left).toBeCloseTo(frame.card.width, 0);
    expect((card.right - card.left) / (card.bottom - card.top)).toBeLessThanOrEqual(MUSE_CARD_MAX_ASPECT + 0.01);
    expect(frame.clipPath).toMatch(/^inset\(.+ round .+px\)$/);
  });

  it("never scales up and keeps the card portrait on a wide desktop window", () => {
    const frame = museCommentsFrame({ width: 1440, height: 900, topInset: 64 });
    expect(frame.scale).toBeLessThanOrEqual(1);
    expect(frame.card.width / frame.card.height).toBeLessThanOrEqual(MUSE_CARD_MAX_ASPECT + 0.01);
  });

  it("leaves the video full size under the sheet when there's no room for a card", () => {
    const frame = museCommentsFrame({ width: 390, height: 200, topInset: 47 });
    expect(frame).toMatchObject({ y: FULL_FRAME.y, scale: 1, clipPath: FULL_FRAME.clipPath });
  });

  it("follows a shorter screen (an Android keyboard resizing the WebView) with a smaller card", () => {
    const tall = museCommentsFrame({ width: 390, height: 844, topInset: 47 });
    const short = museCommentsFrame({ width: 390, height: 520, topInset: 47 });
    expect(short.card.height).toBeLessThan(tall.card.height);
    expect(short.scale).toBeLessThanOrEqual(1);
  });
});

describe("the transition", () => {
  it("is a ~0.3s tween on the app's own non-overshooting curve, and instant for reduced motion", () => {
    expect(MUSE_COMMENTS_TRANSITION.type).toBe("tween");
    expect(MUSE_COMMENTS_TRANSITION.duration).toBe(0.3);
    expect([...MUSE_COMMENTS_TRANSITION.ease]).toEqual([...APP_DEFAULT_TRANSITION.ease]);
    expect(bezierOvershoots([...MUSE_COMMENTS_TRANSITION.ease])).toBe(false);
    expect(MUSE_COMMENTS_INSTANT).toEqual({ type: "tween", duration: 0 });
  });
});
