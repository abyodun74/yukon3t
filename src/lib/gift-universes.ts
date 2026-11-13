import type { GiftUniverseName } from "@/lib/gifts-data";

// The five gift universes (Phase A, "Yukon3t Gift Universe"): the gift picker's sections. Pure and client-safe. Each
// has its own look in the picker (the `.gift-universe-*` classes in src/app/globals.css: header colours and one tiny
// header motion, every one of them still under prefers-reduced-motion) and its own rules:
// - LOVE (Love & Emotion): warm rose and blush, soft lines, slow blooms. Mostly private 1:1: never offered in a public
//   live room.
// - CELEBRATE (Celebrate & Inspire): a bright confetti palette and bursts.
// - GAMING (Gaming Arena): neon arcade, crisp short level-up effects, trophy frames. Phase B: promotable, but only one
//   occasion lists it, a host-declared challenge win (CHALLENGE_WIN, src/lib/gift-occasions.ts); otherwise an
//   ordinary shelf.
// - LUXURY (Luxury Universe): black and gold, slow reveals, numbered pieces.
// - CULTURE (Culture & Community): regional patterns and lanterns, neutral wording, no religious iconography; the
//   recipient can turn its occasion prompts off (User.giftCultureOccasions).

/** The picker's section order. */
export const GIFT_UNIVERSES = ["LOVE", "CELEBRATE", "GAMING", "LUXURY", "CULTURE"] as const satisfies readonly GiftUniverseName[];

export type GiftUniverseStyle = {
  /** The section's class (src/app/globals.css). */
  className: string;
  /** The small header ornament (an inline SVG drawn by the picker). */
  ornament: "bloom" | "burst" | "pixel" | "diamond" | "lantern";
  /** May this universe be offered in a public live room? */
  inLiveRooms: boolean;
  /** May an occasion put this universe on the "Right now" shelf? (Gaming: only CHALLENGE_WIN lists it.) */
  promotable: boolean;
};

export const GIFT_UNIVERSE_STYLES: Readonly<Record<GiftUniverseName, GiftUniverseStyle>> = {
  LOVE: { className: "gift-universe-love", ornament: "bloom", inLiveRooms: false, promotable: true },
  CELEBRATE: { className: "gift-universe-celebrate", ornament: "burst", inLiveRooms: true, promotable: true },
  GAMING: { className: "gift-universe-gaming", ornament: "pixel", inLiveRooms: true, promotable: true },
  LUXURY: { className: "gift-universe-luxury", ornament: "diamond", inLiveRooms: true, promotable: true },
  CULTURE: { className: "gift-universe-culture", ornament: "lantern", inLiveRooms: true, promotable: true },
};

export function isGiftUniverse(value: unknown): value is GiftUniverseName {
  return typeof value === "string" && (GIFT_UNIVERSES as readonly string[]).includes(value);
}
