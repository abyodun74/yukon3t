import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BIRTHDAY_MOMENT_CARDS_SPAN_MS,
  BIRTHDAY_MOMENT_CARD_STEP_MS,
  BIRTHDAY_MOMENT_INTRO_MS,
  BIRTHDAY_MOMENT_MAX_WISHES,
  BIRTHDAY_MOMENT_PARTICLES,
  BIRTHDAY_MOMENT_PARTICLES_LOW_END,
  BIRTHDAY_MOMENT_RISERS,
  BIRTHDAY_MOMENT_RISERS_LOW_END,
  BIRTHDAY_MOMENT_STAGES,
  BIRTHDAY_MOMENT_TEXT_MAX,
  birthdayMomentCardStepMs,
  birthdayMomentDayKey,
  focusWrapIndex,
  isEmojiOnlyWish,
  planBirthdayMoment,
  selectBirthdayMomentWishes,
  shouldAutoPlayBirthdayMoment,
  type ReceivedWishRow,
} from "@/lib/birthday-moment";
import { keyframeScales, keyframesOvershoot, cssBeziers, bezierOvershoots } from "@/components/motion-guard";

/** A seeded generator, so a plan is the same on every run. */
function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

describe("planBirthdayMoment", () => {
  it("stages the reveal in order: dim, push-in, risers, particles, name, cards", () => {
    const s = BIRTHDAY_MOMENT_STAGES;
    const order = [s.backdrop, s.pushIn, s.risers, s.particles, s.name, s.cards];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("finishes every one-shot piece inside the intro, so they can be taken off the page", () => {
    for (const lowEnd of [false, true]) {
      for (let seed = 1; seed < 40; seed++) {
        const plan = planBirthdayMoment(seeded(seed), { reduced: false, lowEnd, cardCount: 3 });
        for (const piece of [...plan.particles, ...plan.risers]) {
          expect(piece.delayMs).toBeGreaterThanOrEqual(0);
          expect(piece.delayMs + piece.durationMs).toBeLessThanOrEqual(BIRTHDAY_MOMENT_INTRO_MS);
        }
      }
    }
  });

  it("has fewer pieces and still cards on a low-end phone", () => {
    const full = planBirthdayMoment(seeded(), { reduced: false, lowEnd: false, cardCount: 4 });
    const low = planBirthdayMoment(seeded(), { reduced: false, lowEnd: true, cardCount: 4 });
    expect(full.particles).toHaveLength(BIRTHDAY_MOMENT_PARTICLES);
    expect(full.risers).toHaveLength(BIRTHDAY_MOMENT_RISERS);
    expect(low.particles).toHaveLength(BIRTHDAY_MOMENT_PARTICLES_LOW_END);
    expect(low.risers).toHaveLength(BIRTHDAY_MOMENT_RISERS_LOW_END);
    expect(full.cards.every((c) => c.floatMs > 0 && c.floatPx > 0)).toBe(true);
    expect(low.cards.every((c) => c.floatMs === 0 && c.floatPx === 0)).toBe(true);
  });

  it("is one calm fade under reduced motion: no pieces, flat cards, all at once", () => {
    const plan = planBirthdayMoment(seeded(), { reduced: true, lowEnd: false, cardCount: 5 });
    expect(plan.particles).toEqual([]);
    expect(plan.risers).toEqual([]);
    expect(plan.cards).toHaveLength(5);
    for (const card of plan.cards) expect(card).toEqual({ tiltY: 0, tiltX: 0, z: 0, delayMs: 0, floatPx: 0, floatMs: 0 });
  });

  it("leans alternate cards opposite ways, mirrored right-to-left, gently enough to read", () => {
    const ltr = planBirthdayMoment(seeded(3), { reduced: false, lowEnd: false, cardCount: 4 });
    const rtl = planBirthdayMoment(seeded(3), { reduced: false, lowEnd: false, cardCount: 4, rtl: true });
    expect(ltr.cards.map((c) => Math.sign(c.tiltY))).toEqual([1, -1, 1, -1]);
    expect(rtl.cards.map((c) => c.tiltY)).toEqual(ltr.cards.map((c) => -c.tiltY));
    for (const card of ltr.cards) {
      expect(Math.abs(card.tiltY)).toBeLessThanOrEqual(12);
      expect(card.tiltX).toBeGreaterThan(0);
      expect(card.tiltX).toBeLessThanOrEqual(7);
      expect(card.z).toBeLessThanOrEqual(0);
    }
  });

  it("starts the cards after the name and never keeps the last one waiting long", () => {
    for (const count of [1, 2, 6, BIRTHDAY_MOMENT_MAX_WISHES]) {
      const plan = planBirthdayMoment(seeded(), { reduced: false, lowEnd: false, cardCount: count });
      expect(plan.cards[0].delayMs).toBe(BIRTHDAY_MOMENT_STAGES.cards);
      const last = plan.cards[plan.cards.length - 1].delayMs;
      expect(last - BIRTHDAY_MOMENT_STAGES.cards).toBeLessThanOrEqual(BIRTHDAY_MOMENT_CARDS_SPAN_MS);
    }
    expect(birthdayMomentCardStepMs(1)).toBe(BIRTHDAY_MOMENT_CARD_STEP_MS);
    expect(birthdayMomentCardStepMs(3)).toBe(BIRTHDAY_MOMENT_CARD_STEP_MS);
    expect(birthdayMomentCardStepMs(12)).toBeLessThan(BIRTHDAY_MOMENT_CARD_STEP_MS);
  });

  it("handles no cards", () => {
    expect(planBirthdayMoment(seeded(), { reduced: false, lowEnd: false, cardCount: 0 }).cards).toEqual([]);
  });
});

describe("selectBirthdayMomentWishes", () => {
  type Over = Partial<Omit<ReceivedWishRow, "message">> & {
    message?: Partial<NonNullable<ReceivedWishRow["message"]>> | null;
  };
  const row = (over: Over = {}) => {
    const { message, ...rest } = over;
    return {
      id: "w1",
      senderId: "s1",
      sender: { name: "Ada", avatarUrl: null, status: "ACTIVE" },
      ...rest,
      message:
        message === null
          ? null
          : {
              conversationId: "c1",
              content: "Happy birthday!",
              moderationStatus: "PUBLISHED",
              deletedForEveryoneAt: null,
              deletedForUserIds: [],
              viewOnce: false,
              ...message,
            },
    } as ReceivedWishRow;
  };
  const opts = { viewerId: "me", blockedIds: new Set<string>(), hiddenConversationIds: new Set<string>() };

  it("shows a wish as the chat does now", () => {
    expect(selectBirthdayMomentWishes([row({ message: { content: "  Edited text  " } })], opts)).toEqual([
      { id: "w1", fromName: "Ada", avatarUrl: null, text: "Edited text" },
    ]);
  });

  it("leaves out what the celebrant can't read in their chats", () => {
    const gone = [
      row({ message: null }),
      row({ message: { deletedForEveryoneAt: new Date() } }),
      row({ message: { deletedForUserIds: ["me"] } }),
      row({ message: { moderationStatus: "FLAGGED" } }),
      row({ message: { viewOnce: true } }),
      row({ message: { content: "   " } }),
      row({ sender: { name: "X", avatarUrl: null, status: "SUSPENDED" } }),
    ];
    for (const r of gone) expect(selectBirthdayMomentWishes([r], opts)).toEqual([]);
  });

  it("never shows a wish from a hidden chat or across a block", () => {
    expect(selectBirthdayMomentWishes([row()], { ...opts, hiddenConversationIds: new Set(["c1"]) })).toEqual([]);
    expect(selectBirthdayMomentWishes([row()], { ...opts, blockedIds: new Set(["s1"]) })).toEqual([]);
  });

  it("shows one card per sender, at most max, newest first as given, and caps the text", () => {
    const rows = Array.from({ length: 20 }, (_, i) => row({ id: `w${i}`, senderId: `s${i}` }));
    rows.splice(1, 0, row({ id: "dup", senderId: "s0" }));
    const out = selectBirthdayMomentWishes(rows, { ...opts, max: 5 });
    expect(out.map((w) => w.id)).toEqual(["w0", "w1", "w2", "w3", "w4"]);
    const long = selectBirthdayMomentWishes([row({ message: { content: "a".repeat(400) } })], opts);
    expect(long[0].text).toHaveLength(BIRTHDAY_MOMENT_TEXT_MAX);
  });
});

describe("isEmojiOnlyWish", () => {
  it("is true for a reaction and false for words or digits", () => {
    for (const e of ["🎂", "🎉", "🥳", "🎁", "🎈", "💐", "👍🏽", "👨‍👩‍👧"]) expect(isEmojiOnlyWish(e), e).toBe(true);
    for (const t of ["Happy birthday 🎂", "12", "#", "", "   ", "عيد ميلاد سعيد"]) expect(isEmojiOnlyWish(t), t).toBe(false);
  });
});

describe("autoplay once a day", () => {
  it("keys by the device's own calendar date", () => {
    expect(birthdayMomentDayKey(new Date(2026, 10, 7, 0, 0, 1))).toBe("2026-11-07");
    expect(birthdayMomentDayKey(new Date(2026, 0, 2, 23, 59))).toBe("2026-01-02");
  });

  it("plays when it hasn't played today on this device", () => {
    expect(shouldAutoPlayBirthdayMoment(null, "2026-11-07")).toBe(true);
    expect(shouldAutoPlayBirthdayMoment("2025-11-07", "2026-11-07")).toBe(true);
    expect(shouldAutoPlayBirthdayMoment("2026-11-07", "2026-11-07")).toBe(false);
  });
});

describe("focusWrapIndex", () => {
  it("wraps Tab from the last control to the first and Shift+Tab from the first to the last", () => {
    expect(focusWrapIndex(2, 3, false)).toBe(0);
    expect(focusWrapIndex(0, 3, true)).toBe(2);
    expect(focusWrapIndex(-1, 3, true)).toBe(2);
    expect(focusWrapIndex(-1, 3, false)).toBe(0);
    expect(focusWrapIndex(1, 3, false)).toBeNull();
    expect(focusWrapIndex(1, 3, true)).toBeNull();
    expect(focusWrapIndex(0, 0, false)).toBeNull();
  });
});

describe("the moment's CSS", () => {
  const css = readFileSync(join(import.meta.dirname, "..", "app", "globals.css"), "utf8");
  const start = css.indexOf("/* ---------- The birthday moment");
  const next = css.indexOf("/* ---------- ", start + 1);
  const section = css.slice(start, next === -1 ? undefined : next);

  it("exists, and animates only transform and opacity (no filter, no layout)", () => {
    expect(start).toBeGreaterThan(-1);
    for (const block of section.matchAll(/@keyframes\s+(bday-[\w-]+)\s*\{([\s\S]*?)\n\}/g)) {
      const props = [...block[2].matchAll(/^\s*([a-z-]+)\s*:/gm)].map((m) => m[1]);
      for (const prop of props) expect(["transform", "opacity"], `${block[1]}: ${prop}`).toContain(prop);
    }
    expect(section).not.toMatch(/\bfilter\s*:/);
  });

  it("never bounces: no overshooting curve or scale", () => {
    for (const bezier of cssBeziers(section)) expect(bezierOvershoots(bezier), bezier.join(",")).toBe(false);
    for (const [name, values] of keyframeScales(section)) expect(keyframesOvershoot(values), name).toBe(false);
  });

  it("leaves a single fade under reduced motion", () => {
    expect(section).toMatch(/\.bday-moment\[data-still\] \*\s*\{\s*animation: none !important;/);
    const media = section.slice(section.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(media).toMatch(/\.bday-moment \*\s*\{\s*animation: none !important;/);
    expect(media).toMatch(/\.bday-scene\s*\{\s*display: none;/);
  });
});
