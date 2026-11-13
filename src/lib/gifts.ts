import { isAdultOn, localDateTime } from "@/lib/birthdays";

// Digital gifts: pure rules, unit-tested (gifts.test.ts) and client-safe. The server half is gift-delivery.ts
// (deliverGiftPurchase, the one way a purchase becomes owned gifts) and the actions are app/actions/gifts.ts. The
// catalog is gifts-data.ts.
//
// Owner decisions (2026-11): bought and sent in one step (no coins, no wallet); no cash value, no cash-out, not
// transferable. Sold later on the web (Stripe) and in the apps (Apple / Google billing); Phase 1 is free and admin-only.
// Age policy: only an adult (isAdultOn, an unknown birth date counts as under 18) can buy or send; someone under 18
// receives only from accepted connections and never through a live stream; nobody can send to an under-18 they aren't
// connected with. A block either way refuses, checked when the gift is asked for and again at delivery.

/** Longest note a sender can attach to a gift, in characters (after trimming). */
export const GIFT_MESSAGE_MAX = 140;

/** How far back the live room asks for gift effects when told one arrived (getLiveGiftEffects). */
export const LIVE_GIFT_EFFECT_WINDOW_MS = 30_000;

/** At most this many effects wait their turn on one stream's screen; more are dropped (the oldest kept). */
export const LIVE_GIFT_QUEUE_MAX = 5;

/** How long one live effect plays before the next one starts. */
export const LIVE_GIFT_EFFECT_MS = 3_200;

/**
 * THE feature gate: whether gifts exist for this person at all. Every action (app/actions/gifts.ts) and every UI entry
 * point (profile, chat, live room, Settings) goes through this one function, and a gift can only be sent between two
 * people it is on for. Phase 1: site admins only. Phase 2/3 change this body (and nothing else) to open gifts to
 * everyone; the guest-preview identity never gets them.
 */
export function giftsEnabledFor(user: { isAdmin: boolean; isGuestPreview?: boolean } | null | undefined): boolean {
  if (!user || user.isGuestPreview) return false;
  return user.isAdmin;
}

export type GiftsFromValue = "EVERYONE" | "CONNECTIONS" | "NOBODY";
export type GiftContextValue = "DIRECT" | "CHAT" | "LIVE";

/** Whether `giftsFrom` lets someone send this person a gift, given whether the two are accepted connections. */
export function giftsFromAllows(giftsFrom: GiftsFromValue, connected: boolean): boolean {
  if (giftsFrom === "NOBODY") return false;
  if (giftsFrom === "CONNECTIONS") return connected;
  return true;
}

/** The trimmed note, or null for none. Throws nothing: an over-long note is refused by giftMessageRefusal. */
export function normalizeGiftMessage(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** "too_long" for a note over GIFT_MESSAGE_MAX characters (counted as the user sees them), else null. */
export function giftMessageRefusal(message: string | null): "too_long" | null {
  if (message === null) return null;
  return [...message].length > GIFT_MESSAGE_MAX ? "too_long" : null;
}

export type GiftParty = {
  id: string;
  status: string;
  isAdmin: boolean;
  isGuestPreview: boolean;
  birthDate: Date | null;
};

/**
 * Why `sender` can't give `recipient` a gift, or null when they can. Used when the gift is asked for (createGiftIntent)
 * and again at delivery (deliverGiftPurchase, `atDelivery`), where the sender's own gate is not re-checked: by then the
 * gift has been asked for (and, from Phase 2, paid for), and only the recipient's side decides whether it lands.
 *
 * - "disabled": gifts aren't on for the sender.
 * - "self": a gift to yourself.
 * - "unavailable": the recipient can't take gifts at all (not on for them, inactive, the guest identity) or a block
 *   either way. One answer for all of these, so a refusal never reveals a block.
 * - "adult_only": the sender isn't a known adult.
 * - "not_accepting": the recipient's own rules say no: giftsFrom, or they are under 18 and not connected to the sender
 *   or it would arrive through a live stream.
 */
export function giftSendRefusal(input: {
  sender: GiftParty;
  recipient: GiftParty & { giftsFrom: GiftsFromValue };
  connected: boolean;
  blocked: boolean;
  context: GiftContextValue;
  now: Date;
  atDelivery?: boolean;
}): "disabled" | "self" | "unavailable" | "adult_only" | "not_accepting" | null {
  const { sender, recipient, connected, blocked, context, now, atDelivery = false } = input;
  if (!atDelivery && !giftsEnabledFor(sender)) return "disabled";
  if (sender.id === recipient.id) return "self";
  if (!giftsEnabledFor(recipient) || recipient.status !== "ACTIVE") return "unavailable";
  if (blocked) return "unavailable";
  const today = localDateTime(now, "UTC");
  if (!isAdultOn(sender.birthDate, today)) return "adult_only";
  if (!isAdultOn(recipient.birthDate, today)) {
    if (context === "LIVE" || !connected) return "not_accepting";
  }
  if (!giftsFromAllows(recipient.giftsFrom, connected)) return "not_accepting";
  return null;
}

/** Items a product's contents give, one entry per copy: a box gives each contained item `quantity` times. */
export function expandProductItems(contents: { itemId: string; quantity: number }[]): string[] {
  const out: string[] = [];
  for (const { itemId, quantity } of contents) {
    const copies = Math.min(10, Math.max(1, Math.floor(quantity)));
    for (let i = 0; i < copies; i++) out.push(itemId);
  }
  return out;
}

/** Whether `kind` is something a person wears on their profile. */
export function isEquippableKind(kind: string): kind is "FRAME" | "BADGE" {
  return kind === "FRAME" || kind === "BADGE";
}

/**
 * Whether the person may equip `item`: it is a frame or a badge, and they own a copy of it that hasn't been revoked.
 * `owned` is their OwnedGift rows for that item.
 */
export function canEquip(item: { kind: string } | null, owned: { revokedAt: Date | null }[]): boolean {
  if (!item || !isEquippableKind(item.kind)) return false;
  return owned.some((row) => row.revokedAt === null);
}

/** The live-room effect a delivered product plays: its first live effect, or the plain sparkle for any other gift. */
export function liveEffectFor(items: { kind: string; assetKey: string }[]): string {
  return items.find((item) => item.kind === "LIVE_EFFECT")?.assetKey ?? "sparkle";
}

/** Where a GIFT_RECEIVED notification (bell and push alike) leads: the recipient's own Gifts area on their profile. */
export function giftsHref(recipientId: string): string {
  return `/u/${recipientId}#gifts`;
}

// ---------- Phase A: free gifts, editions, seasons, the showcase ----------

/** Free gifts (sendFreeGift, sendThankYouGift) one sender may send in 24 hours, in all (limiter giftFreeDaily). */
export const FREE_GIFT_DAILY_MAX = 20;
/** Free gifts from one sender to one person in 24 hours (limiter giftFreeToSameRecipient). */
export const FREE_GIFT_PER_RECIPIENT_DAILY_MAX = 3;
/** The occasion tag a free gift must carry: free gifts are appreciation only. */
export const FREE_GIFT_TAG = "appreciation";
/** At most this many owned gifts pinned to a profile's showcase. */
export const GIFT_SHOWCASE_MAX = 3;

/** Whether a product is a free gift: price 0 and an appreciation sentiment. Anything else at 0 is not sendable. */
export function isFreeGiftProduct(product: { webPriceMinor: number; occasionTags: readonly string[] }): boolean {
  return product.webPriceMinor === 0 && product.occasionTags.includes(FREE_GIFT_TAG);
}

/**
 * The next copy number of an EDITION item: the highest number already given plus one, in delivery order (never
 * random). Null when a limited edition (`editionSize`) has given all its copies: the delivery is then refused like any
 * other undeliverable gift, and the catalog simply stops offering it (never "only N left").
 */
export function nextEditionNumber(currentMax: number | null, editionSize: number | null | undefined): number | null {
  const next = (currentMax ?? 0) + 1;
  if (editionSize != null && next > editionSize) return null;
  return next;
}

const MONTH_DAY = /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;

/**
 * Whether a yearly window ("MM-DD" to "MM-DD", inclusive, either end may be open) contains this month and day. A
 * window may wrap the new year ("12-01" to "01-15"). Both null: always available. A malformed bound is treated as
 * open-ended. Seasonal gifts come back every year.
 */
export function inYearlyWindow(
  from: string | null | undefined,
  until: string | null | undefined,
  date: { month: number; day: number },
): boolean {
  const start = from && MONTH_DAY.test(from) ? from : null;
  const end = until && MONTH_DAY.test(until) ? until : null;
  if (!start && !end) return true;
  const today = `${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
  if (start && end) return start <= end ? today >= start && today <= end : today >= start || today <= end;
  if (start) return today >= start;
  return today <= end!;
}

/**
 * Why the recipient of `received` can't send it a free Thank You, or null. Only its recipient; only a gift that was
 * delivered (opened or not, even hidden); not a Thank You itself (no loops); not one already thanked; and only while
 * its sender's account still exists.
 */
export function thankYouRefusal(input: {
  userId: string;
  received: { recipientId: string; senderId: string | null; status: string; thanksForSendId: string | null; thanked: boolean } | null;
}): "not_found" | "already_thanked" | "unavailable" | null {
  const { received } = input;
  if (!received || received.recipientId !== input.userId) return "not_found";
  if (!["DELIVERED", "OPENED", "HIDDEN_BY_RECIPIENT"].includes(received.status)) return "not_found";
  if (received.thanksForSendId !== null) return "unavailable";
  if (received.thanked) return "already_thanked";
  if (!received.senderId) return "unavailable";
  return null;
}

/** Whether an owned gift may be on its owner's showcase: theirs, not revoked, and a gift still shown (opened). */
export function showcaseEligible(input: {
  ownerId: string;
  userId: string;
  revokedAt: Date | null;
  sendStatus: string;
}): boolean {
  return input.ownerId === input.userId && input.revokedAt === null && input.sendStatus === "OPENED";
}

/** The advisory-lock key that serializes one person's showcase changes (pinGiftToShowcase). */
export function giftShowcaseLockKey(userId: string): string {
  return "gift-showcase:" + userId;
}

/** The advisory-lock key that serializes one person's self-declared occasions (declareGiftOccasion). */
export function giftSelfOccasionLockKey(userId: string): string {
  return "gift-self-occasion:" + userId;
}

/** The first free showcase position (0..GIFT_SHOWCASE_MAX-1), or null when it is full. */
export function freeShowcasePosition(taken: number[]): number | null {
  for (let p = 0; p < GIFT_SHOWCASE_MAX; p++) if (!taken.includes(p)) return p;
  return null;
}

/** A store price for display, e.g. "$0.99", in the reader's language. */
export function giftPriceLabel(minor: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

/** Gift statuses the recipient still has: shown in their Gifts area (and, once opened, to visitors). */
export const RECEIVED_GIFT_STATUSES = ["DELIVERED", "OPENED"] as const;

/**
 * Whether a viewer is shown a received gift on someone's profile. The recipient sees every delivered or opened gift
 * (and who sent it); anyone else, only opened ones, never the sender, and nothing at all across a block either way.
 */
export function giftVisibleOnProfile(input: { status: string; viewerIsRecipient: boolean; blocked: boolean }): boolean {
  if (input.blocked) return false;
  if (input.viewerIsRecipient) return input.status === "DELIVERED" || input.status === "OPENED";
  return input.status === "OPENED";
}

/**
 * One live stream's on-screen gift effects: one at a time, in arrival order, each id once however many times a refetch
 * returns it, at most LIVE_GIFT_QUEUE_MAX waiting (a burst beyond that is dropped, newest first). `play` starts an
 * effect and the caller calls `done()` when it has finished (a timer in the overlay); `clear` empties it (unmount).
 */
export function createGiftEffectQueue(play: (effect: { id: string; effect: string }) => void, max = LIVE_GIFT_QUEUE_MAX) {
  const seen = new Set<string>();
  const waiting: { id: string; effect: string }[] = [];
  let playing = false;

  function next() {
    const effect = waiting.shift();
    if (!effect) {
      playing = false;
      return;
    }
    playing = true;
    play(effect);
  }

  return {
    push(effects: { id: string; effect: string }[]) {
      for (const effect of effects) {
        if (seen.has(effect.id)) continue;
        seen.add(effect.id);
        if (waiting.length >= max) continue;
        waiting.push(effect);
      }
      if (!playing) next();
    },
    done() {
      next();
    },
    clear() {
      waiting.length = 0;
      playing = false;
    },
    get size() {
      return waiting.length;
    },
    get playing() {
      return playing;
    },
  };
}
