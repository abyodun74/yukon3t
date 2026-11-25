// The birthday moment: the full-screen cinematic reveal the celebrant sees on their own profile on their birthday (with
// the wishes received so far as floating 3D cards) and a sender sees once their wish has gone (with that wish). Pure
// and client-safe: the staged timeline, the plan of every moving piece, which received wishes may be shown, and the
// once-a-day autoplay rule, all unit tested (birthday-moment.test.ts). The overlay is
// src/components/birthday-moment.tsx; the CSS (`.bday-*`, transform and opacity only) is in globals.css.
//
// Nothing here waits on anything: the wish is already sent (or the wishes already delivered as messages) before a
// moment opens, and every control in it works from the first frame.

import type { ModerationStatus, UserStatus } from "@/generated/prisma/enums";

/** When each stage starts, in ms from opening. CSS reads these as inline animation delays. */
export const BIRTHDAY_MOMENT_STAGES = {
  /** The page dims behind it. */
  backdrop: 0,
  /** The slow camera push-in toward the headline. */
  pushIn: 120,
  /** Balloons / light orbs rising through the depth of the scene. */
  risers: 250,
  /** Confetti and light specks falling. */
  particles: 650,
  /** The ribbon unfurls and the name reveals. */
  name: 900,
  /** The first wish card floats in; the rest follow `cardStep` apart. */
  cards: 1500,
} as const;

/** The camera push-in's length. */
export const BIRTHDAY_MOMENT_PUSH_IN_MS = 3200;
/** Every one-shot piece (risers, particles) has finished by then and is taken off the page. */
export const BIRTHDAY_MOMENT_INTRO_MS = 4400;
/** Reduced motion: the whole moment fades in once, in place. */
export const BIRTHDAY_MOMENT_FADE_MS = 300;
/** Cards follow each other this far apart, squeezed so the last one never starts later than CARDS_SPAN after the first. */
export const BIRTHDAY_MOMENT_CARD_STEP_MS = 220;
export const BIRTHDAY_MOMENT_CARDS_SPAN_MS = 1400;
/** How long one card takes to float in. */
export const BIRTHDAY_MOMENT_CARD_IN_MS = 900;

/** Most wish cards shown (the newest), and fewer on a low-end phone (isLowEndDevice in heart-burst.ts). */
export const BIRTHDAY_MOMENT_MAX_WISHES = 12;
export const BIRTHDAY_MOMENT_MAX_WISHES_LOW_END = 6;
/** Pieces in the scene: normal, and on a low-end phone. Reduced motion has none. */
export const BIRTHDAY_MOMENT_PARTICLES = 28;
export const BIRTHDAY_MOMENT_PARTICLES_LOW_END = 10;
export const BIRTHDAY_MOMENT_RISERS = 7;
export const BIRTHDAY_MOMENT_RISERS_LOW_END = 3;
/** Longest text on a card: a custom wish is at most BIRTHDAY_WISH_TEXT_MAX (280) anyway. */
export const BIRTHDAY_MOMENT_TEXT_MAX = 280;
/** The wishes of this birthday: a wish can only be sent within 36h of a reminder sent on the birthday itself. */
export const BIRTHDAY_MOMENT_LOOKBACK_MS = 48 * 60 * 60_000;

/** One wish card. `fromName` null = the person has no name (shown as the unknown-name stand-in). */
export type BirthdayMomentWish = {
  id: string;
  fromName: string | null;
  avatarUrl: string | null;
  text: string;
};

export type BirthdayMomentParticle = {
  id: number;
  /** Start across the width, in %. */
  xPct: number;
  /** px */
  size: number;
  /** Index into the palette (CSS `--bday-c0`..`--bday-c4`). */
  color: number;
  /** A ribbon strip (long) or a square fleck. */
  strip: boolean;
  /** Sideways drift (px, signed), spin (deg), fall (% of the scene's height). */
  drift: number;
  spin: number;
  fall: number;
  delayMs: number;
  durationMs: number;
};

export type BirthdayMomentRiser = {
  id: number;
  xPct: number;
  /** Depth (px): negative is further away, so it looks smaller and moves slower across the screen. */
  z: number;
  size: number;
  color: number;
  sway: number;
  delayMs: number;
  durationMs: number;
};

export type BirthdayMomentCard = {
  /** Tilt around the vertical axis (deg); alternate cards lean the other way, mirrored right-to-left. */
  tiltY: number;
  tiltX: number;
  /** Resting depth (px, <= 0). */
  z: number;
  delayMs: number;
  /** The slow idle float once in (0 = still: reduced motion or a low-end phone). */
  floatPx: number;
  floatMs: number;
};

export type BirthdayMomentPlan = {
  reduced: boolean;
  lowEnd: boolean;
  particles: BirthdayMomentParticle[];
  risers: BirthdayMomentRiser[];
  cards: BirthdayMomentCard[];
};

/** How far apart the cards start: the usual step, squeezed for many cards so the last one isn't kept waiting. */
export function birthdayMomentCardStepMs(count: number): number {
  if (count <= 1) return BIRTHDAY_MOMENT_CARD_STEP_MS;
  return Math.min(BIRTHDAY_MOMENT_CARD_STEP_MS, Math.floor(BIRTHDAY_MOMENT_CARDS_SPAN_MS / (count - 1)));
}

/**
 * Everything that moves, lightly randomised (`random` is injectable for tests). Reduced motion: no particles, no
 * risers, cards flat and all at once (the overlay then only fades in). A low-end phone gets fewer pieces and still
 * cards. Right-to-left mirrors which way the cards lean.
 */
export function planBirthdayMoment(
  random: () => number,
  opts: { reduced: boolean; lowEnd: boolean; cardCount: number; rtl?: boolean },
): BirthdayMomentPlan {
  const r = (min: number, max: number) => min + random() * (max - min);
  const { reduced, lowEnd } = opts;
  const cardCount = Math.max(0, Math.floor(opts.cardCount));
  if (reduced) {
    return {
      reduced,
      lowEnd,
      particles: [],
      risers: [],
      cards: Array.from({ length: cardCount }, () => ({ tiltY: 0, tiltX: 0, z: 0, delayMs: 0, floatPx: 0, floatMs: 0 })),
    };
  }

  const particleCount = lowEnd ? BIRTHDAY_MOMENT_PARTICLES_LOW_END : BIRTHDAY_MOMENT_PARTICLES;
  const particles: BirthdayMomentParticle[] = [];
  for (let i = 0; i < particleCount; i++) {
    const durationMs = Math.round(r(2200, 3000));
    // Never later than the intro allows: every piece is gone by BIRTHDAY_MOMENT_INTRO_MS.
    const delayMs = Math.min(
      Math.round(BIRTHDAY_MOMENT_STAGES.particles + r(0, 700)),
      BIRTHDAY_MOMENT_INTRO_MS - durationMs,
    );
    particles.push({
      id: i,
      xPct: r(2, 98),
      size: Math.round(r(6, 12)),
      color: Math.floor(random() * 5) % 5,
      strip: random() < 0.45,
      drift: Math.round(r(-60, 60)),
      spin: Math.round(r(180, 540)) * (random() < 0.5 ? -1 : 1),
      fall: Math.round(r(75, 110)),
      delayMs,
      durationMs,
    });
  }

  const riserCount = lowEnd ? BIRTHDAY_MOMENT_RISERS_LOW_END : BIRTHDAY_MOMENT_RISERS;
  const risers: BirthdayMomentRiser[] = [];
  for (let i = 0; i < riserCount; i++) {
    const durationMs = Math.round(r(2600, 3400));
    risers.push({
      id: i,
      // Spread across the width in lanes so they don't stack.
      xPct: ((i + 0.5) / riserCount) * 90 + 5 + r(-4, 4),
      z: Math.round(r(-320, 80)),
      size: Math.round(r(30, 56)),
      color: i % 5,
      sway: Math.round(r(10, 26)) * (i % 2 === 0 ? 1 : -1),
      delayMs: Math.min(Math.round(BIRTHDAY_MOMENT_STAGES.risers + r(0, 650)), BIRTHDAY_MOMENT_INTRO_MS - durationMs),
      durationMs,
    });
  }

  const step = birthdayMomentCardStepMs(cardCount);
  const mirror = opts.rtl ? -1 : 1;
  const cards: BirthdayMomentCard[] = [];
  for (let i = 0; i < cardCount; i++) {
    const side = (i % 2 === 0 ? 1 : -1) * mirror;
    cards.push({
      tiltY: Math.round(side * r(7, 12) * 10) / 10,
      tiltX: Math.round(r(3, 7) * 10) / 10,
      z: -Math.round(r(0, 50)),
      delayMs: BIRTHDAY_MOMENT_STAGES.cards + i * step,
      floatPx: lowEnd ? 0 : Math.round(r(4, 8)),
      floatMs: lowEnd ? 0 : Math.round(r(5200, 7200)),
    });
  }
  return { reduced, lowEnd, particles, risers, cards };
}

// ---------- Which received wishes are shown ----------

/** One received wish as read for the celebrant's moment (birthdays-data.ts). */
export type ReceivedWishRow = {
  id: string;
  senderId: string;
  sender: { name: string | null; avatarUrl: string | null; status: UserStatus };
  message: {
    conversationId: string;
    content: string;
    moderationStatus: ModerationStatus;
    deletedForEveryoneAt: Date | null;
    deletedForUserIds: string[];
    viewOnce: boolean;
  } | null;
};

/**
 * The received wishes the celebrant's moment may show, newest first as given: only a wish whose message the celebrant
 * can still read in their chats (PUBLISHED, not deleted for everyone or for them, not view-once, not empty), from an
 * ACTIVE account, with no block either way, and never one from a chat the celebrant has hidden (a hidden chat never
 * shows anywhere outside its PIN-locked area). One card per sender, at most `max`.
 */
export function selectBirthdayMomentWishes(
  rows: ReceivedWishRow[],
  opts: {
    viewerId: string;
    blockedIds: ReadonlySet<string>;
    hiddenConversationIds: ReadonlySet<string>;
    max?: number;
  },
): BirthdayMomentWish[] {
  const max = opts.max ?? BIRTHDAY_MOMENT_MAX_WISHES;
  const out: BirthdayMomentWish[] = [];
  const senders = new Set<string>();
  for (const row of rows) {
    if (out.length >= max) break;
    const message = row.message;
    if (!message) continue;
    if (row.sender.status !== "ACTIVE" || opts.blockedIds.has(row.senderId) || senders.has(row.senderId)) continue;
    if (message.moderationStatus !== "PUBLISHED" || message.deletedForEveryoneAt || message.viewOnce) continue;
    if (message.deletedForUserIds.includes(opts.viewerId)) continue;
    if (opts.hiddenConversationIds.has(message.conversationId)) continue;
    const text = message.content.trim().slice(0, BIRTHDAY_MOMENT_TEXT_MAX);
    if (!text) continue;
    senders.add(row.senderId);
    out.push({ id: row.id, fromName: row.sender.name, avatarUrl: row.sender.avatarUrl, text });
  }
  return out;
}

/** A wish that is only emoji (a reaction from the quick-wish sheet) is shown large on its card. */
export function isEmojiOnlyWish(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 16) return false;
  return /^[\p{Extended_Pictographic}\p{Emoji_Component}\s]+$/u.test(trimmed) && /\p{Extended_Pictographic}/u.test(trimmed);
}

// ---------- Autoplay once a day ----------

/** Device-only (localStorage): the local date the celebrant's moment last played on this device. */
export const BIRTHDAY_MOMENT_SEEN_KEY = "yk-birthday-moment-seen";

/** The device's own calendar date, "YYYY-MM-DD". */
export function birthdayMomentDayKey(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The celebrant's moment plays by itself once per day per device; after that only from its button. */
export function shouldAutoPlayBirthdayMoment(seen: string | null | undefined, today: string): boolean {
  return seen !== today;
}

// ---------- Keyboard ----------

/**
 * Tab inside the moment wraps around: from the last control Tab goes to the first, Shift+Tab from the first (or from
 * the dialog itself, index -1) to the last. Null when the browser's own move is fine.
 */
export function focusWrapIndex(current: number, count: number, shift: boolean): number | null {
  if (count <= 0) return null;
  if (shift && current <= 0) return count - 1;
  if (!shift && (current === count - 1 || current === -1)) return 0;
  return null;
}
