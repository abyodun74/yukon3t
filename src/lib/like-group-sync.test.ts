import { afterEach, describe, expect, it, vi } from "vitest";
import { announceLikeGroup, likeGroupChangeApplies, type LikeGroupChange } from "@/lib/like-group-sync";

// Same-tab like sync (like-group-sync.ts): a card takes another card's like only when both are in the same like group.
// Groups are single-author (like-groups.ts), so someone else's copy of the same video never moves this card.

const me = Symbol("me");
const other = Symbol("other");
const change = (likeGroupId: string, source = other): LikeGroupChange => ({ likeGroupId, liked: true, likeCount: 3, source });

describe("likeGroupChangeApplies", () => {
  it("a card takes a change from another card of its own group", () => {
    expect(likeGroupChangeApplies("g-ada", me, change("g-ada"))).toBe(true);
  });

  it("a card never takes a change from another group (someone else's copy of the video)", () => {
    expect(likeGroupChangeApplies("g-ada", me, change("g-bo"))).toBe(false);
  });

  it("a card with no group (an independent copy) listens to nothing", () => {
    expect(likeGroupChangeApplies(null, me, change("g-ada"))).toBe(false);
  });

  it("ignores its own announcement and empty events", () => {
    expect(likeGroupChangeApplies("g-ada", me, change("g-ada", me))).toBe(false);
    expect(likeGroupChangeApplies("g-ada", me, null)).toBe(false);
  });

  it("a list listening to any group gets every change (it filters per card by likeGroupId)", () => {
    expect(likeGroupChangeApplies("any", me, change("g-bo"))).toBe(true);
  });
});

describe("announceLikeGroup", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("dispatches one same-tab event carrying the change", () => {
    const target = new EventTarget();
    vi.stubGlobal("window", target);
    const seen: LikeGroupChange[] = [];
    target.addEventListener("yk:like-group-changed", (e) => seen.push((e as CustomEvent<LikeGroupChange>).detail));
    const c = change("g-ada");
    announceLikeGroup(c);
    expect(seen).toEqual([c]);
  });
});
