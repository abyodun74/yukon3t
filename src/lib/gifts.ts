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
