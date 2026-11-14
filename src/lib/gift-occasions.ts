import { celebrationDay, localDateTime, profileBirthdayToday, type ProfileBirthdayOwner } from "@/lib/birthdays";
import { GIFT_UNIVERSES, GIFT_UNIVERSE_STYLES } from "@/lib/gift-universes";
import type { GiftOccasionTag, GiftUniverseName } from "@/lib/gifts-data";
import { CHALLENGE_WIN_OCCASION_WINDOW_MS, challengeWinWindowStart } from "@/lib/challenges";

// The occasion engine (Phase A, "occasion-aware gifting"): which occasions make a gift to `recipient` timely for
// `viewer` right now. Pure and client-safe (it never imports the holiday dataset; the server half,
// src/lib/gift-occasions-data.ts, works out the facts and calls occasionsFor). Computed on every request, never stored,
// never scheduled, and it NEVER notifies anyone: it only reorders surfaces that already exist (the gift picker's
// "Right now" shelf, the birthday card's CTA order, a dismissible chip in a 1:1 chat composer).
//
// Privacy: an occasion carries a kind, its universes and tags, a reason key and a coarse window ("today",
// "this_week", "around_now"). Never a date, a year, an age, a holiday's or a Circle's name, or a score.
//
// Ranking is deterministic: score = source weight (verified 3 > host-declared 2 > self-declared 1) x closeness of the
// window (1 at the occasion itself, down to 0.5 at the window's edge), ties broken by the fixed order of
// OCCASION_REGISTRY. Adding an occasion kind is one registry entry. Phase B registered CHALLENGE_WIN (a host-declared
// challenge win, src/lib/challenges.ts), the only occasion that promotes the Gaming universe.

export const SELF_OCCASION_KINDS = ["GRADUATION", "NEW_JOB", "ACHIEVEMENT", "MILESTONE"] as const;
export type SelfOccasionKind = (typeof SELF_OCCASION_KINDS)[number];

/** A self-declared occasion shows for this long after it was declared. */
export const SELF_OCCASION_WINDOW_MS = 7 * 24 * 60 * 60_000;
/** At most one self-declared occasion of each kind in this long (a removed one still counts). */
export const SELF_OCCASION_COOLDOWN_MS = 30 * 24 * 60 * 60_000;

/**
 * Self-declared occasions declared before this instant are past their 30 days (SELF_OCCASION_COOLDOWN_MS) and no
 * longer matter to anything (selfOccasionRefusal only looks at the last 30 days, the picker at the last 7): the daily
 * prune-gift-occasions cron deletes them. A row exactly at the cutoff is kept.
 */
export function selfOccasionRetentionCutoff(now: Date): Date {
  return new Date(now.getTime() - SELF_OCCASION_COOLDOWN_MS);
}
/** A Circle event is an occasion from this long before it starts until this long after. */
export const EVENT_OCCASION_WINDOW_MS = 24 * 60 * 60_000;
/** At most this many reasons are shown at once (the "Right now" shelf's chips). */
export const OCCASION_REASONS_SHOWN = 2;
/** At most this many products on the "Right now" shelf. */
export const RIGHT_NOW_SHELF_MAX = 6;

export type OccasionSource = "verified" | "host" | "self";
export const OCCASION_SOURCE_WEIGHT: Readonly<Record<OccasionSource, number>> = { verified: 3, host: 2, self: 1 };

export type OccasionWindow = "today" | "this_week" | "around_now";

/** What the recipient's side contributes (read from their own row and rows they own). Never sent to a browser. */
export type OccasionRecipient = {
  id: string;
  timeZone: string | null;
  /** When they joined (User.onboardedAt, else createdAt). */
  joinedAt: Date | null;
  /** The birthday-card inputs (profileBirthdayToday), or null when not loaded. */
  birthday: ProfileBirthdayOwner | null;
  /** User.giftCultureOccasions: Culture prompts allowed. */
  cultureOccasions: boolean;
  /** User.holidayReminders. */
  holidayReminders: boolean;
  /** How many holidays of their OWN country fall on their local date today (0 for none, or no country / no data). */
  holidaysToday: number;
  /** Their own declarations (not removed). */
  selfDeclared: { kind: SelfOccasionKind; declaredAt: Date }[];
};

/** What depends on who is looking. Never sent to a browser. */
export type OccasionViewer = {
  id: string;
  /** eligibleBirthdayRecipients admitted this viewer for the recipient's birthday (audience, blocks, hidden chat, adult). */
  birthdayEligible: boolean;
  /** Their accepted connection, with whether BOTH opted in to anniversary prompts; null when not connected. */
  connection: { respondedAt: Date | null; bothOptedIn: boolean } | null;
  /** When the recipient joined each Circle the viewer is a current member of too. */
  sharedCircleJoins: Date[];
  /** Start times of the recipient's own Circle events that the viewer can see. */
  visibleEventStarts: Date[];
  /**
   * Phase B: when each challenge the recipient currently wins (DECIDED, not cancelled or reversed, they are still a
   * declared winner) was decided, for challenges the viewer may see (canViewerSeeChallenge: the Circle's or stream's
   * visibility, no block with its host). Times only: never a title, a Circle or a host.
   */
  visibleChallengeWins?: Date[];
};

export type OccasionKind =
  | "BIRTHDAY"
  | "CONNECTION_ANNIVERSARY"
  | "JOINED_ANNIVERSARY"
  | "CIRCLE_JOIN_ANNIVERSARY"
  | "CIRCLE_EVENT_DAY"
  | "HOLIDAY"
  | "SELF_GRADUATION"
  | "SELF_NEW_JOB"
  | "SELF_ACHIEVEMENT"
  | "SELF_MILESTONE"
  | "CHALLENGE_WIN";

/** One occasion, as any surface may see it. `reasonKey` is gifts.occasions.reasons.<reasonKey> in the dictionary. */
export type Occasion = {
  kind: OccasionKind;
  universes: GiftUniverseName[];
  tags: GiftOccasionTag[];
  reasonKey: OccasionKind;
  window: OccasionWindow;
};

type Hit = { closeness: number; window: OccasionWindow };
type Context = { recipient: OccasionRecipient; viewer: OccasionViewer; now: Date };

export type OccasionDefinition = {
  kind: OccasionKind;
  source: OccasionSource;
  universes: GiftUniverseName[];
  tags: GiftOccasionTag[];
  evaluate: (ctx: Context) => Hit | null;
};

const TODAY: Hit = { closeness: 1, window: "today" };

function validDate(value: Date | null | undefined): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/**
 * Whether today, on the recipient's local calendar, is an anniversary (1 year or more) of `at`, itself read on the
 * recipient's calendar. A Feb 29 date is marked on Feb 28 in other years. No (or an unknown) time zone reads as UTC.
 */
export function isAnniversaryToday(at: Date | null | undefined, now: Date, timeZone: string | null | undefined): boolean {
  if (!validDate(at)) return false;
  const then = localDateTime(at, timeZone);
  const today = localDateTime(now, timeZone);
  if (today.year <= then.year) return false;
  const marked = celebrationDay(then.month, then.day, today.year);
  return marked.month === today.month && marked.day === today.day;
}

function selfDeclared(kind: SelfOccasionKind) {
  return ({ recipient, now }: Context): Hit | null => {
    let best: Hit | null = null;
    for (const row of recipient.selfDeclared) {
      if (row.kind !== kind || !validDate(row.declaredAt)) continue;
      const age = now.getTime() - row.declaredAt.getTime();
      if (age < 0 || age > SELF_OCCASION_WINDOW_MS) continue;
      const closeness = 1 - (age / SELF_OCCASION_WINDOW_MS) * 0.5;
      if (!best || closeness > best.closeness) best = { closeness, window: "this_week" };
    }
    return best;
  };
}

/**
 * Every occasion kind, in tie-break order. One entry per kind: adding a kind is adding an entry here (and its reason
 * in the `gifts` dictionary).
 */
export const OCCASION_REGISTRY: readonly OccasionDefinition[] = [
  {
    // The birthday card's own rule (profileBirthdayToday: sharing on, adult, recipient-local day, never a site admin)
    // AND the viewer is someone the birthday is shared with (eligibleBirthdayRecipients). NONE = never.
    kind: "BIRTHDAY",
    source: "verified",
    universes: ["CELEBRATE", "LOVE"],
    tags: ["birthday"],
    evaluate: ({ recipient, viewer, now }) =>
      recipient.birthday && viewer.birthdayEligible && profileBirthdayToday(recipient.birthday, now) ? TODAY : null,
  },
  {
    // Only when BOTH people opted in (User.giftAnniversaryOptIn), and only ever computed for the two of them.
    kind: "CONNECTION_ANNIVERSARY",
    source: "verified",
    universes: ["LOVE", "CELEBRATE"],
    tags: ["anniversary", "love"],
    evaluate: ({ recipient, viewer, now }) =>
      viewer.connection?.bothOptedIn && isAnniversaryToday(viewer.connection.respondedAt, now, recipient.timeZone) ? TODAY : null,
  },
  {
    kind: "JOINED_ANNIVERSARY",
    source: "verified",
    universes: ["CELEBRATE"],
    tags: ["anniversary"],
    evaluate: ({ recipient, now }) => (isAnniversaryToday(recipient.joinedAt, now, recipient.timeZone) ? TODAY : null),
  },
  {
    // Only Circles the viewer is a current member of too (they can see its member list).
    kind: "CIRCLE_JOIN_ANNIVERSARY",
    source: "verified",
    universes: ["CULTURE", "CELEBRATE"],
    tags: ["community", "anniversary"],
    evaluate: ({ recipient, viewer, now }) =>
      viewer.sharedCircleJoins.some((at) => isAnniversaryToday(at, now, recipient.timeZone)) ? TODAY : null,
  },
  {
    // The recipient's own event, one the viewer can see, from 24h before it starts to 24h after.
    kind: "CIRCLE_EVENT_DAY",
    source: "host",
    universes: ["CULTURE", "CELEBRATE"],
    tags: ["community"],
    evaluate: ({ viewer, now }) => {
      let best: Hit | null = null;
      for (const start of viewer.visibleEventStarts) {
        if (!validDate(start)) continue;
        const distance = Math.abs(start.getTime() - now.getTime());
        if (distance > EVENT_OCCASION_WINDOW_MS) continue;
        const closeness = 1 - (distance / EVENT_OCCASION_WINDOW_MS) * 0.5;
        if (!best || closeness > best.closeness) best = { closeness, window: "around_now" };
      }
      return best;
    },
  },
  {
    // A public holiday of the recipient's OWN country (never inferred from anything else), only while their holiday
    // reminders and Culture prompts are both on. 31 countries have no data: nothing.
    kind: "HOLIDAY",
    source: "verified",
    universes: ["CULTURE"],
    tags: ["holiday"],
    evaluate: ({ recipient }) =>
      recipient.holidayReminders && recipient.cultureOccasions && recipient.holidaysToday > 0 ? TODAY : null,
  },
  { kind: "SELF_GRADUATION", source: "self", universes: ["CELEBRATE"], tags: ["graduation", "achievement"], evaluate: selfDeclared("GRADUATION") },
  { kind: "SELF_NEW_JOB", source: "self", universes: ["CELEBRATE"], tags: ["achievement", "appreciation"], evaluate: selfDeclared("NEW_JOB") },
  { kind: "SELF_ACHIEVEMENT", source: "self", universes: ["CELEBRATE"], tags: ["achievement"], evaluate: selfDeclared("ACHIEVEMENT") },
  { kind: "SELF_MILESTONE", source: "self", universes: ["CELEBRATE", "LOVE"], tags: ["achievement", "anniversary"], evaluate: selfDeclared("MILESTONE") },
  {
    // Phase B: a challenge win, declared by a host (weight 2), for 72h from the decision. One window per 72h per
    // recipient (challengeWinWindowStart): winning again inside it neither restarts nor extends it. The only occasion
    // that promotes Gaming; its gifts tagged tournament_win lead the "Right now" shelf (OCCASION_LEAD_TAG).
    kind: "CHALLENGE_WIN",
    source: "host",
    universes: ["GAMING"],
    tags: ["tournament_win", "achievement"],
    evaluate: ({ viewer, now }) => {
      const start = challengeWinWindowStart(viewer.visibleChallengeWins ?? [], now);
      if (!start) return null;
      const age = now.getTime() - start.getTime();
      return { closeness: 1 - (age / CHALLENGE_WIN_OCCASION_WINDOW_MS) * 0.5, window: "this_week" };
    },
  },
];

/** Occasions whose products carrying this tag go first on the "Right now" shelf (before the rest that match). */
export const OCCASION_LEAD_TAG: Readonly<Partial<Record<OccasionKind, GiftOccasionTag>>> = {
  CHALLENGE_WIN: "tournament_win",
};

/** The fixed tie-break order (the registry's). */
export const OCCASION_KIND_ORDER: readonly OccasionKind[] = OCCASION_REGISTRY.map((d) => d.kind);

/**
 * The occasions that apply to `recipient` for `viewer` at `now`, best first. Never throws (a kind whose facts are
 * missing or malformed simply doesn't apply), and returns nothing for a gift to yourself.
 */
export function occasionsFor(recipient: OccasionRecipient, viewer: OccasionViewer, now: Date): Occasion[] {
  if (!validDate(now) || recipient.id === viewer.id) return [];
  const ctx: Context = { recipient, viewer, now };
  const scored: { occasion: Occasion; score: number; order: number }[] = [];
  OCCASION_REGISTRY.forEach((def, order) => {
    let hit: Hit | null = null;
    try {
      hit = def.evaluate(ctx);
    } catch {
      hit = null;
    }
    if (!hit) return;
    // Culture prompts off: no Culture universe on any occasion (and an occasion left with none is dropped).
    const universes = def.universes.filter(
      (u) => GIFT_UNIVERSE_STYLES[u].promotable && (u !== "CULTURE" || recipient.cultureOccasions),
    );
    if (universes.length === 0) return;
    scored.push({
      occasion: { kind: def.kind, universes, tags: [...def.tags], reasonKey: def.kind, window: hit.window },
      score: OCCASION_SOURCE_WEIGHT[def.source] * hit.closeness,
      order,
    });
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.map((s) => s.occasion);
}

/** Why `kind` can't be declared now: one of that kind (even removed) in the last SELF_OCCASION_COOLDOWN_MS. */
export function selfOccasionRefusal(
  existing: { kind: SelfOccasionKind; declaredAt: Date }[],
  kind: SelfOccasionKind,
  now: Date,
): "too_soon" | null {
  const since = now.getTime() - SELF_OCCASION_COOLDOWN_MS;
  return existing.some((row) => row.kind === kind && row.declaredAt.getTime() > since) ? "too_soon" : null;
}

/** Whether a declaration still shows (not removed, within its 7-day window). */
export function selfOccasionActive(row: { declaredAt: Date; removedAt: Date | null }, now: Date): boolean {
  const age = now.getTime() - row.declaredAt.getTime();
  return row.removedAt === null && age >= 0 && age <= SELF_OCCASION_WINDOW_MS;
}

// ---------- Shelves ----------

export type ShelfProduct = {
  sku: string;
  universe: GiftUniverseName;
  occasionTags: readonly string[];
  free: boolean;
  items: { kind: string }[];
};

export type GiftShelves = {
  /** The occasions (best first, at most OCCASION_REASONS_SHOWN) and the products that suit them. */
  rightNow: { occasions: Occasion[]; skus: string[] } | null;
  /** The free kind words (never in a live room). */
  kindWords: string[];
  /** The five universes, in GIFT_UNIVERSES order, each with its products (empty ones left out). */
  universes: { universe: GiftUniverseName; skus: string[] }[];
};

/**
 * The gift picker's shelves for one recipient, from the products that may be offered (already active, in season and
 * in catalog order) and the occasions (occasionsFor). In a live room only products with a live effect from a universe
 * allowed there (never Love & Emotion) and no free gifts. "Right now" holds paid products of a promoted universe whose
 * occasion tags match an occasion, best occasion first; it is empty (null) without occasions.
 */
export function buildGiftShelves(products: ShelfProduct[], occasions: Occasion[], context: "DIRECT" | "CHAT" | "LIVE"): GiftShelves {
  const live = context === "LIVE";
  const offered = products.filter(
    (p) => !live || (!p.free && GIFT_UNIVERSE_STYLES[p.universe].inLiveRooms && p.items.some((i) => i.kind === "LIVE_EFFECT")),
  );
  const paid = offered.filter((p) => !p.free);

  let rightNow: GiftShelves["rightNow"] = null;
  const shown = occasions.slice(0, OCCASION_REASONS_SHOWN);
  if (shown.length > 0) {
    const skus: string[] = [];
    for (const occasion of shown) {
      // An occasion with a lead tag (a challenge win: tournament_win) puts the products carrying it first, in catalog
      // order, then the rest of its matches. Stable, so everything else keeps the catalog order.
      const lead = OCCASION_LEAD_TAG[occasion.kind];
      const ordered = lead
        ? [...paid.filter((p) => p.occasionTags.includes(lead)), ...paid.filter((p) => !p.occasionTags.includes(lead))]
        : paid;
      for (const product of ordered) {
        if (skus.length >= RIGHT_NOW_SHELF_MAX) break;
        if (skus.includes(product.sku)) continue;
        if (!occasion.universes.includes(product.universe) || !GIFT_UNIVERSE_STYLES[product.universe].promotable) continue;
        if (!product.occasionTags.some((tag) => (occasion.tags as string[]).includes(tag))) continue;
        skus.push(product.sku);
      }
    }
    if (skus.length > 0) rightNow = { occasions: shown, skus };
  }

  return {
    rightNow,
    kindWords: live ? [] : offered.filter((p) => p.free).map((p) => p.sku),
    universes: GIFT_UNIVERSES.map((universe) => ({ universe, skus: paid.filter((p) => p.universe === universe).map((p) => p.sku) })).filter(
      (shelf) => shelf.skus.length > 0,
    ),
  };
}
