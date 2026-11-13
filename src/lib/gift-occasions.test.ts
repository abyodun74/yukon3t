import { describe, expect, it } from "vitest";
import {
  OCCASION_KIND_ORDER,
  OCCASION_REGISTRY,
  RIGHT_NOW_SHELF_MAX,
  SELF_OCCASION_COOLDOWN_MS,
  buildGiftShelves,
  isAnniversaryToday,
  occasionsFor,
  selfOccasionActive,
  selfOccasionRefusal,
  type Occasion,
  type OccasionRecipient,
  type OccasionViewer,
  type ShelfProduct,
} from "@/lib/gift-occasions";
import { CHAMPION_AWARD_SKU, GIFT_PRODUCTS } from "@/lib/gifts-data";
import { isAwardProduct } from "@/lib/gifts";
import { CHALLENGE_WIN_OCCASION_WINDOW_MS } from "@/lib/challenges";

// The occasion engine (src/lib/gift-occasions.ts): each kind, the recipient-local day across time zones, the opt-ins
// and switches, deterministic ranking, privacy of what comes out, and that it never throws.

const NOW = new Date("2026-11-13T12:00:00Z");
const DAY = 24 * 60 * 60_000;
const adult = new Date("1990-11-13T00:00:00Z");

function recipient(over: Partial<OccasionRecipient> = {}): OccasionRecipient {
  return {
    id: "r",
    timeZone: "UTC",
    joinedAt: new Date("2026-01-05T10:00:00Z"),
    birthday: null,
    cultureOccasions: true,
    holidayReminders: true,
    holidaysToday: 0,
    selfDeclared: [],
    ...over,
  };
}
function viewer(over: Partial<OccasionViewer> = {}): OccasionViewer {
  return { id: "v", birthdayEligible: false, connection: null, sharedCircleJoins: [], visibleEventStarts: [], ...over };
}
const birthdayOwner = (over: Record<string, unknown> = {}) => ({
  id: "r",
  status: "ACTIVE",
  isGuestPreview: false,
  birthDate: adult,
  birthdayAudience: "BOTH" as const,
  isAdmin: false,
  timeZone: "UTC",
  ...over,
});
const kinds = (list: Occasion[]) => list.map((o) => o.kind);

describe("BIRTHDAY", () => {
  it("applies on the recipient's birthday, for a viewer the birthday is shared with", () => {
    const out = occasionsFor(recipient({ birthday: birthdayOwner() }), viewer({ birthdayEligible: true }), NOW);
    expect(out[0]).toEqual({ kind: "BIRTHDAY", universes: ["CELEBRATE", "LOVE"], tags: ["birthday"], reasonKey: "BIRTHDAY", window: "today" });
  });
  it("never for a viewer outside the audience, sharing NONE, an admin, a minor or the guest identity", () => {
    expect(occasionsFor(recipient({ birthday: birthdayOwner() }), viewer({ birthdayEligible: false }), NOW)).toEqual([]);
    const v = viewer({ birthdayEligible: true });
    expect(occasionsFor(recipient({ birthday: birthdayOwner({ birthdayAudience: "NONE" }) }), v, NOW)).toEqual([]);
    expect(occasionsFor(recipient({ birthday: birthdayOwner({ isAdmin: true }) }), v, NOW)).toEqual([]);
    expect(occasionsFor(recipient({ birthday: birthdayOwner({ birthDate: new Date("2010-11-13T00:00:00Z") }) }), v, NOW)).toEqual([]);
    expect(occasionsFor(recipient({ birthday: birthdayOwner({ isGuestPreview: true }) }), v, NOW)).toEqual([]);
    expect(occasionsFor(recipient({ birthday: birthdayOwner({ birthDate: null }) }), v, NOW)).toEqual([]);
  });
  it("follows the recipient's own calendar day, not the viewer's or UTC's", () => {
    // 23:30 UTC on Nov 12 is already Nov 13 in Tokyo.
    const late = new Date("2026-11-12T23:30:00Z");
    const v = viewer({ birthdayEligible: true });
    expect(kinds(occasionsFor(recipient({ birthday: birthdayOwner({ timeZone: "Asia/Tokyo" }) }), v, late))).toEqual(["BIRTHDAY"]);
    expect(occasionsFor(recipient({ birthday: birthdayOwner({ timeZone: "UTC" }) }), v, late)).toEqual([]);
    // No (or a bad) time zone reads as UTC.
    expect(kinds(occasionsFor(recipient({ birthday: birthdayOwner({ timeZone: null }) }), v, NOW))).toEqual(["BIRTHDAY"]);
    expect(kinds(occasionsFor(recipient({ birthday: birthdayOwner({ timeZone: "Not/AZone" }) }), v, NOW))).toEqual(["BIRTHDAY"]);
  });
});

describe("anniversaries", () => {
  it("JOINED_ANNIVERSARY: the join day and month, a year or more later, on the recipient's calendar", () => {
    expect(kinds(occasionsFor(recipient({ joinedAt: new Date("2024-11-13T08:00:00Z") }), viewer(), NOW))).toEqual(["JOINED_ANNIVERSARY"]);
    expect(occasionsFor(recipient({ joinedAt: new Date("2026-11-13T08:00:00Z") }), viewer(), NOW)).toEqual([]);
    expect(occasionsFor(recipient({ joinedAt: new Date("2024-11-12T08:00:00Z") }), viewer(), NOW)).toEqual([]);
    expect(occasionsFor(recipient({ joinedAt: null }), viewer(), NOW)).toEqual([]);
  });
  it("isAnniversaryToday marks a Feb 29 date on Feb 28 in other years", () => {
    expect(isAnniversaryToday(new Date("2024-02-29T12:00:00Z"), new Date("2026-02-28T12:00:00Z"), "UTC")).toBe(true);
    expect(isAnniversaryToday(new Date("2024-02-29T12:00:00Z"), new Date("2028-02-29T12:00:00Z"), "UTC")).toBe(true);
    expect(isAnniversaryToday(new Date("2024-02-29T12:00:00Z"), new Date("2028-02-28T12:00:00Z"), "UTC")).toBe(false);
    expect(isAnniversaryToday(new Date("invalid"), NOW, "UTC")).toBe(false);
  });
  it("CONNECTION_ANNIVERSARY needs BOTH people opted in, and an answered request", () => {
    const at = new Date("2025-11-13T09:00:00Z");
    expect(kinds(occasionsFor(recipient(), viewer({ connection: { respondedAt: at, bothOptedIn: true } }), NOW))).toEqual([
      "CONNECTION_ANNIVERSARY",
    ]);
    expect(occasionsFor(recipient(), viewer({ connection: { respondedAt: at, bothOptedIn: false } }), NOW)).toEqual([]);
    expect(occasionsFor(recipient(), viewer({ connection: { respondedAt: null, bothOptedIn: true } }), NOW)).toEqual([]);
    expect(occasionsFor(recipient(), viewer({ connection: null }), NOW)).toEqual([]);
  });
  it("CIRCLE_JOIN_ANNIVERSARY: a Circle the viewer shares; Culture off keeps only its Celebrate side", () => {
    const joins = [new Date("2023-11-13T10:00:00Z")];
    const on = occasionsFor(recipient(), viewer({ sharedCircleJoins: joins }), NOW);
    expect(on).toEqual([
      { kind: "CIRCLE_JOIN_ANNIVERSARY", universes: ["CULTURE", "CELEBRATE"], tags: ["community", "anniversary"], reasonKey: "CIRCLE_JOIN_ANNIVERSARY", window: "today" },
    ]);
    const off = occasionsFor(recipient({ cultureOccasions: false }), viewer({ sharedCircleJoins: joins }), NOW);
    expect(off[0].universes).toEqual(["CELEBRATE"]);
  });
});

describe("HOLIDAY", () => {
  it("only with a holiday of the recipient's own country today, their holiday reminders on and Culture prompts on", () => {
    expect(kinds(occasionsFor(recipient({ holidaysToday: 1 }), viewer(), NOW))).toEqual(["HOLIDAY"]);
    expect(occasionsFor(recipient({ holidaysToday: 0 }), viewer(), NOW)).toEqual([]);
    expect(occasionsFor(recipient({ holidaysToday: 2, holidayReminders: false }), viewer(), NOW)).toEqual([]);
    expect(occasionsFor(recipient({ holidaysToday: 2, cultureOccasions: false }), viewer(), NOW)).toEqual([]);
  });
});

describe("CIRCLE_EVENT_DAY", () => {
  it("from 24h before the recipient's visible event to 24h after", () => {
    for (const offset of [-DAY, -DAY / 2, 0, DAY / 2, DAY]) {
      const out = occasionsFor(recipient(), viewer({ visibleEventStarts: [new Date(NOW.getTime() + offset)] }), NOW);
      expect(kinds(out), String(offset)).toEqual(["CIRCLE_EVENT_DAY"]);
      expect(out[0].window).toBe("around_now");
    }
    for (const offset of [-DAY - 60_000, DAY + 60_000]) {
      expect(occasionsFor(recipient(), viewer({ visibleEventStarts: [new Date(NOW.getTime() + offset)] }), NOW)).toEqual([]);
    }
  });
});

describe("SELF_DECLARED", () => {
  it("shows for 7 days after the recipient declared it", () => {
    const at = (ms: number) => new Date(NOW.getTime() - ms);
    expect(kinds(occasionsFor(recipient({ selfDeclared: [{ kind: "GRADUATION", declaredAt: at(DAY) }] }), viewer(), NOW))).toEqual([
      "SELF_GRADUATION",
    ]);
    expect(occasionsFor(recipient({ selfDeclared: [{ kind: "GRADUATION", declaredAt: at(8 * DAY) }] }), viewer(), NOW)).toEqual([]);
    expect(occasionsFor(recipient({ selfDeclared: [{ kind: "NEW_JOB", declaredAt: at(-DAY) }] }), viewer(), NOW)).toEqual([]);
    const all = occasionsFor(
      recipient({
        selfDeclared: (["GRADUATION", "NEW_JOB", "ACHIEVEMENT", "MILESTONE"] as const).map((kind) => ({ kind, declaredAt: at(DAY) })),
      }),
      viewer(),
      NOW,
    );
    expect(kinds(all)).toEqual(["SELF_GRADUATION", "SELF_NEW_JOB", "SELF_ACHIEVEMENT", "SELF_MILESTONE"]);
    expect(all.every((o) => o.window === "this_week")).toBe(true);
  });
  it("one per kind per 30 days, a removed one still counting", () => {
    const old = [{ kind: "GRADUATION" as const, declaredAt: new Date(NOW.getTime() - 10 * DAY) }];
    expect(selfOccasionRefusal(old, "GRADUATION", NOW)).toBe("too_soon");
    expect(selfOccasionRefusal(old, "NEW_JOB", NOW)).toBeNull();
    expect(selfOccasionRefusal([{ kind: "GRADUATION", declaredAt: new Date(NOW.getTime() - SELF_OCCASION_COOLDOWN_MS - 1) }], "GRADUATION", NOW)).toBeNull();
    expect(selfOccasionActive({ declaredAt: new Date(NOW.getTime() - DAY), removedAt: new Date() }, NOW)).toBe(false);
    expect(selfOccasionActive({ declaredAt: new Date(NOW.getTime() - DAY), removedAt: null }, NOW)).toBe(true);
  });
});

describe("ranking", () => {
  const everything = () =>
    occasionsFor(
      recipient({
        birthday: birthdayOwner(),
        joinedAt: new Date("2024-11-13T00:00:00Z"),
        holidaysToday: 1,
        selfDeclared: [{ kind: "ACHIEVEMENT", declaredAt: new Date(NOW.getTime() - 2 * DAY) }],
      }),
      viewer({
        birthdayEligible: true,
        connection: { respondedAt: new Date("2025-11-13T00:00:00Z"), bothOptedIn: true },
        sharedCircleJoins: [new Date("2025-11-13T00:00:00Z")],
        visibleEventStarts: [new Date(NOW.getTime() + 6 * 60 * 60_000)],
      }),
      NOW,
    );

  it("orders by source weight x closeness, ties by the registry's fixed order", () => {
    expect(kinds(everything())).toEqual([
      // verified (3) x today (1), in registry order
      "BIRTHDAY",
      "CONNECTION_ANNIVERSARY",
      "JOINED_ANNIVERSARY",
      "CIRCLE_JOIN_ANNIVERSARY",
      "HOLIDAY",
      // host (2) x 0.875
      "CIRCLE_EVENT_DAY",
      // self (1) x ~0.86
      "SELF_ACHIEVEMENT",
    ]);
  });
  it("is deterministic", () => {
    expect(everything()).toEqual(everything());
    expect(OCCASION_KIND_ORDER).toEqual(OCCASION_REGISTRY.map((d) => d.kind));
  });
  it("a closer event outranks a farther one of the same weight; verified beats self-declared", () => {
    const near = occasionsFor(recipient(), viewer({ visibleEventStarts: [new Date(NOW.getTime() + DAY)] }), NOW);
    expect(kinds(near)).toEqual(["CIRCLE_EVENT_DAY"]);
    const mixed = occasionsFor(
      recipient({ joinedAt: new Date("2025-11-13T00:00:00Z"), selfDeclared: [{ kind: "MILESTONE", declaredAt: NOW }] }),
      viewer(),
      NOW,
    );
    expect(kinds(mixed)).toEqual(["JOINED_ANNIVERSARY", "SELF_MILESTONE"]);
  });
  it("only a challenge win promotes the Gaming universe (Phase B registers exactly one such kind)", () => {
    for (const o of everything()) expect(o.universes).not.toContain("GAMING");
    const gaming = OCCASION_REGISTRY.filter((d) => d.universes.includes("GAMING")).map((d) => d.kind);
    expect(gaming).toEqual(["CHALLENGE_WIN"]);
    expect(OCCASION_KIND_ORDER.filter((k) => /TOURNAMENT|CHALLENGE/.test(k))).toEqual(["CHALLENGE_WIN"]);
  });
});

describe("privacy and robustness", () => {
  it("never puts a date, a year, an age or a score in what it returns", () => {
    const out = occasionsFor(
      recipient({ birthday: birthdayOwner(), joinedAt: new Date("2020-11-13T00:00:00Z"), holidaysToday: 3 }),
      viewer({ birthdayEligible: true }),
      NOW,
    );
    expect(out.length).toBeGreaterThan(0);
    const json = JSON.stringify(out);
    expect(json).not.toMatch(/\d/);
    for (const o of out) expect(Object.keys(o).sort()).toEqual(["kind", "reasonKey", "tags", "universes", "window"]);
  });
  it("never throws, whatever is missing or malformed, and gives nothing for a gift to yourself", () => {
    const broken = recipient({
      timeZone: "%%%",
      joinedAt: new Date("nope"),
      birthday: { ...birthdayOwner(), birthDate: new Date("nope") } as never,
      selfDeclared: [{ kind: "GRADUATION", declaredAt: new Date("nope") }, null as never],
      holidaysToday: Number.NaN,
    });
    const bad = viewer({
      birthdayEligible: true,
      connection: { respondedAt: new Date("nope"), bothOptedIn: true },
      sharedCircleJoins: [new Date("nope"), null as never],
      visibleEventStarts: [undefined as never],
    });
    expect(() => occasionsFor(broken, bad, NOW)).not.toThrow();
    expect(occasionsFor(broken, bad, new Date("nope"))).toEqual([]);
    expect(occasionsFor(recipient({ id: "same" }), viewer({ id: "same" }), NOW)).toEqual([]);
  });
});

describe("buildGiftShelves", () => {
  // The picker never receives an award (getGiftCatalog offers price 0 only for appreciation gifts).
  const products: ShelfProduct[] = GIFT_PRODUCTS.filter((p) => !isAwardProduct(p)).map((p) => ({
    sku: p.sku,
    universe: p.universe,
    occasionTags: p.occasionTags,
    free: p.webPriceMinor === 0,
    items: p.items.map((i) => ({ kind: i.slug === "confetti" || i.slug === "aurora-sweep" || i.slug === "level-up" ? "LIVE_EFFECT" : "STICKER" })),
  }));
  const birthday: Occasion = { kind: "BIRTHDAY", universes: ["CELEBRATE", "LOVE"], tags: ["birthday"], reasonKey: "BIRTHDAY", window: "today" };

  it("without occasions: no Right now shelf, kind words, then the five universes in order", () => {
    const shelves = buildGiftShelves(products, [], "DIRECT");
    expect(shelves.rightNow).toBeNull();
    expect(shelves.kindWords).toEqual(["free.thank-you", "free.appreciate-you", "free.cheering-you-on", "free.proud-of-you"]);
    expect(shelves.universes.map((u) => u.universe)).toEqual(["LOVE", "CELEBRATE", "GAMING", "LUXURY", "CULTURE"]);
    for (const shelf of shelves.universes) for (const sku of shelf.skus) expect(sku.startsWith("free.")).toBe(false);
  });

  it("puts birthday gifts of the occasion's universes on Right now, with the reason", () => {
    const shelves = buildGiftShelves(products, [birthday], "CHAT");
    expect(shelves.rightNow?.occasions).toEqual([birthday]);
    expect(shelves.rightNow!.skus.length).toBeGreaterThan(0);
    expect(shelves.rightNow!.skus.length).toBeLessThanOrEqual(RIGHT_NOW_SHELF_MAX);
    for (const sku of shelves.rightNow!.skus) {
      const p = GIFT_PRODUCTS.find((x) => x.sku === sku)!;
      expect(p.occasionTags).toContain("birthday");
      expect(["CELEBRATE", "LOVE"]).toContain(p.universe);
      expect(p.webPriceMinor).toBeGreaterThan(0);
    }
  });

  it("puts Gaming on Right now only for a challenge win, tournament_win gifts first, paid only (never the award)", () => {
    const win = occasionsFor(recipient(), viewer({ visibleChallengeWins: [new Date(NOW.getTime() - 60 * 60_000)] }), NOW);
    expect(kinds(win)).toEqual(["CHALLENGE_WIN"]);
    const shelves = buildGiftShelves(products, win, "DIRECT");
    const skus = shelves.rightNow!.skus;
    expect(skus.length).toBeGreaterThan(0);
    const tagged = (sku: string) => GIFT_PRODUCTS.find((x) => x.sku === sku)!.occasionTags.includes("tournament_win");
    // Every tournament_win gift comes before any other match.
    const firstOther = skus.findIndex((sku) => !tagged(sku));
    if (firstOther !== -1) expect(skus.slice(firstOther).some(tagged)).toBe(false);
    expect(tagged(skus[0])).toBe(true);
    for (const sku of skus) {
      const p = GIFT_PRODUCTS.find((x) => x.sku === sku)!;
      expect(p.universe).toBe("GAMING");
      expect(p.webPriceMinor).toBeGreaterThan(0);
      expect(sku).not.toBe(CHAMPION_AWARD_SKU);
    }
    // Self-declared achievements never list Gaming, so nothing else puts it on the shelf.
    const achievement = occasionsFor(recipient({ selfDeclared: [{ kind: "ACHIEVEMENT", declaredAt: NOW }] }), viewer(), NOW);
    const other = buildGiftShelves(products, achievement, "DIRECT").rightNow?.skus ?? [];
    for (const sku of other) expect(GIFT_PRODUCTS.find((x) => x.sku === sku)!.universe).not.toBe("GAMING");
  });

  it("keeps the catalog order for occasions without a lead tag", () => {
    const shelves = buildGiftShelves(products, [birthday], "DIRECT");
    const order = GIFT_PRODUCTS.map((p) => p.sku);
    const idx = shelves.rightNow!.skus.map((sku) => order.indexOf(sku));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
  });

  it("in a live room: live effects only, never Love & Emotion, never free", () => {
    const shelves = buildGiftShelves(products, [birthday], "LIVE");
    expect(shelves.kindWords).toEqual([]);
    const all = [...(shelves.rightNow?.skus ?? []), ...shelves.universes.flatMap((u) => u.skus)];
    expect(all.length).toBeGreaterThan(0);
    for (const sku of all) {
      const p = GIFT_PRODUCTS.find((x) => x.sku === sku)!;
      expect(p.universe).not.toBe("LOVE");
      expect(p.webPriceMinor).toBeGreaterThan(0);
    }
    expect(shelves.universes.map((u) => u.universe)).not.toContain("LOVE");
  });
});

describe("CHALLENGE_WIN (Phase B)", () => {
  const HOUR = 60 * 60_000;
  const win = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * HOUR);

  it("applies for 72h from a visible win, host-declared weight, promoting Gaming only, with a coarse window", () => {
    const out = occasionsFor(recipient(), viewer({ visibleChallengeWins: [win(1)] }), NOW);
    expect(out).toEqual([
      { kind: "CHALLENGE_WIN", universes: ["GAMING"], tags: ["tournament_win", "achievement"], reasonKey: "CHALLENGE_WIN", window: "this_week" },
    ]);
    expect(kinds(occasionsFor(recipient(), viewer({ visibleChallengeWins: [win(71.9)] }), NOW))).toEqual(["CHALLENGE_WIN"]);
    expect(occasionsFor(recipient(), viewer({ visibleChallengeWins: [win(72.1)] }), NOW)).toEqual([]);
    expect(occasionsFor(recipient(), viewer({ visibleChallengeWins: [] }), NOW)).toEqual([]);
    expect(occasionsFor(recipient(), viewer(), NOW)).toEqual([]);
    // A future "win" (clock skew) is ignored.
    expect(occasionsFor(recipient(), viewer({ visibleChallengeWins: [win(-2)] }), NOW)).toEqual([]);
  });

  it("is one window per 72h per recipient: more wins inside it never extend it", () => {
    // First win 70h ago opens the window; a win 10h ago is inside it and neither restarts nor extends it.
    const out = occasionsFor(recipient(), viewer({ visibleChallengeWins: [win(10), win(70)] }), NOW);
    expect(kinds(out)).toEqual(["CHALLENGE_WIN"]);
    const later = new Date(NOW.getTime() + 3 * HOUR); // 73h after the first win
    expect(occasionsFor(recipient(), viewer({ visibleChallengeWins: [win(10), win(70)] }), later)).toEqual([]);
    // A win after the window closed opens a new one.
    expect(kinds(occasionsFor(recipient(), viewer({ visibleChallengeWins: [win(100), win(5)] }), NOW))).toEqual(["CHALLENGE_WIN"]);
    expect(CHALLENGE_WIN_OCCASION_WINDOW_MS).toBe(72 * HOUR);
  });

  it("ranks below verified occasions of the day and above self-declared ones", () => {
    const out = occasionsFor(
      recipient({ joinedAt: new Date("2025-11-13T00:00:00Z"), selfDeclared: [{ kind: "ACHIEVEMENT", declaredAt: NOW }] }),
      viewer({ visibleChallengeWins: [win(1)] }),
      NOW,
    );
    expect(kinds(out)).toEqual(["JOINED_ANNIVERSARY", "CHALLENGE_WIN", "SELF_ACHIEVEMENT"]);
  });

  it("never leaks a date, a title or a Circle, and never throws on bad input", () => {
    const out = occasionsFor(recipient(), viewer({ visibleChallengeWins: [win(3)] }), NOW);
    expect(JSON.stringify(out)).not.toMatch(/\d/);
    for (const o of out) expect(Object.keys(o).sort()).toEqual(["kind", "reasonKey", "tags", "universes", "window"]);
    const bad = viewer({ visibleChallengeWins: [new Date("nope"), null as never, undefined as never, "x" as never] });
    expect(() => occasionsFor(recipient(), bad, NOW)).not.toThrow();
    expect(occasionsFor(recipient(), bad, NOW)).toEqual([]);
    expect(occasionsFor(recipient(), viewer({ visibleChallengeWins: null as never }), NOW)).toEqual([]);
  });
});