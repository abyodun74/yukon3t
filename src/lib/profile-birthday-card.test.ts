import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// YuKon3t's birthday card on a profile: the pure "is it their birthday, all day, in their own time zone" rule, who
// sees it (loadProfileBirthdayCard against a mocked database), and the card itself (server render).

const connectionFindMany = vi.fn();
const membershipFindMany = vi.fn();
const userFindMany = vi.fn();
const blockFindMany = vi.fn();
const memberFindMany = vi.fn();
const reminderFindFirst = vi.fn();
const wishFindUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    connection: { findMany: (...a: unknown[]) => connectionFindMany(...a) },
    circleMembership: { findMany: (...a: unknown[]) => membershipFindMany(...a) },
    user: { findMany: (...a: unknown[]) => userFindMany(...a) },
    block: { findMany: (...a: unknown[]) => blockFindMany(...a) },
    conversationMember: { findMany: (...a: unknown[]) => memberFindMany(...a) },
    birthdayReminder: { findFirst: (...a: unknown[]) => reminderFindFirst(...a) },
    birthdayWish: { findUnique: (...a: unknown[]) => wishFindUnique(...a) },
  },
}));
vi.mock("@/lib/push", () => ({ sendPushToUsers: vi.fn() }));
vi.mock("@/lib/fcm", () => ({ sendFcmActivityToUsers: vi.fn() }));
vi.mock("@/lib/realtime-server", () => ({ publishEvents: vi.fn() }));
vi.mock("@/lib/error-tracking", () => ({ captureError: vi.fn() }));
// The card's wish sheet calls this Server Action; the render tests never send anything.
vi.mock("@/app/actions/birthdays", () => ({ sendBirthdayWish: vi.fn() }));

import {
  profileBirthdayToday,
  profileBirthdayWishState,
  type ProfileBirthdayCard as Card,
  type ProfileBirthdayOwner,
} from "@/lib/birthdays";
import { loadProfileBirthdayCard } from "@/lib/birthdays-data";
import { ProfileBirthdayCard } from "@/components/profile-birthday-card";

const owner = (over: Partial<ProfileBirthdayOwner> = {}): ProfileBirthdayOwner => ({
  id: "owner",
  status: "ACTIVE",
  isGuestPreview: false,
  birthDate: new Date("1990-11-07T00:00:00.000Z"),
  birthdayAudience: "BOTH",
  isAdmin: false,
  timeZone: "Europe/London",
  ...over,
});

describe("profileBirthdayToday", () => {
  it("is on for the whole local day: from 00:00 through 23:00 and 23:59, in the owner's own time zone", () => {
    const la = owner({ timeZone: "America/Los_Angeles" }); // UTC-8 in November
    expect(profileBirthdayToday(la, new Date("2026-11-07T07:59:59Z"))).toBeNull(); // 23:59 on Nov 6
    expect(profileBirthdayToday(la, new Date("2026-11-07T08:00:00Z"))).toEqual({ year: 2026 }); // 00:00
    expect(profileBirthdayToday(la, new Date("2026-11-08T07:00:00Z"))).toEqual({ year: 2026 }); // 23:00
    expect(profileBirthdayToday(la, new Date("2026-11-08T07:59:59Z"))).toEqual({ year: 2026 }); // 23:59:59
    expect(profileBirthdayToday(la, new Date("2026-11-08T08:00:00Z"))).toBeNull(); // Nov 8
  });

  it("follows the owner's calendar, not UTC's or the viewer's", () => {
    // 20:00 UTC on Nov 6: already 05:00 on the 7th in Tokyo, still noon on the 6th in Los Angeles.
    const now = new Date("2026-11-06T20:00:00Z");
    expect(profileBirthdayToday(owner({ timeZone: "Asia/Tokyo" }), now)).toEqual({ year: 2026 });
    expect(profileBirthdayToday(owner({ timeZone: "America/Los_Angeles" }), now)).toBeNull();
  });

  it("reads no or an unknown time zone as UTC", () => {
    expect(profileBirthdayToday(owner({ timeZone: null }), new Date("2026-11-07T00:00:00Z"))).toEqual({ year: 2026 });
    expect(profileBirthdayToday(owner({ timeZone: "Not/AZone" }), new Date("2026-11-06T23:59:59Z"))).toBeNull();
  });

  it("starts at the first instant of a day whose midnight DST skips", () => {
    // Sao Paulo, Nov 4 2018: clocks went from 00:00 straight to 01:00 (UTC-3 -> UTC-2).
    const sp = owner({ timeZone: "America/Sao_Paulo", birthDate: new Date("1990-11-04T00:00:00.000Z") });
    expect(profileBirthdayToday(sp, new Date("2018-11-04T02:59:59Z"))).toBeNull(); // 23:59:59 on Nov 3
    expect(profileBirthdayToday(sp, new Date("2018-11-04T03:00:00Z"))).toEqual({ year: 2018 }); // 01:00, first instant
    expect(profileBirthdayToday(sp, new Date("2018-11-05T01:59:59Z"))).toEqual({ year: 2018 }); // 23:59:59
    expect(profileBirthdayToday(sp, new Date("2018-11-05T02:00:00Z"))).toBeNull();
  });

  it("celebrates Feb 29 on Feb 28 in other years", () => {
    const leap = owner({ timeZone: "UTC", birthDate: new Date("2000-02-29T00:00:00.000Z") });
    expect(profileBirthdayToday(leap, new Date("2027-02-28T12:00:00Z"))).toEqual({ year: 2027 });
    expect(profileBirthdayToday(leap, new Date("2028-02-28T12:00:00Z"))).toBeNull();
    expect(profileBirthdayToday(leap, new Date("2028-02-29T12:00:00Z"))).toEqual({ year: 2028 });
  });

  it("needs sharing on, an adult, an ACTIVE real account and no site admin", () => {
    const now = new Date("2026-11-07T12:00:00Z");
    expect(profileBirthdayToday(owner({ birthdayAudience: "NONE" }), now)).toBeNull();
    for (const audience of ["CONNECTIONS", "CIRCLES", "BOTH"] as const) {
      expect(profileBirthdayToday(owner({ birthdayAudience: audience }), now)).not.toBeNull();
    }
    expect(profileBirthdayToday(owner({ birthDate: null }), now)).toBeNull();
    expect(profileBirthdayToday(owner({ birthDate: new Date("2009-11-07T00:00:00.000Z") }), now)).toBeNull(); // 17
    expect(profileBirthdayToday(owner({ birthDate: new Date("2008-11-07T00:00:00.000Z") }), now)).not.toBeNull(); // 18 today
    expect(profileBirthdayToday(owner({ isAdmin: true }), now)).toBeNull();
    expect(profileBirthdayToday(owner({ status: "SUSPENDED" }), now)).toBeNull();
    expect(profileBirthdayToday(owner({ isGuestPreview: true }), now)).toBeNull();
  });
});

describe("profileBirthdayWishState", () => {
  it("offers a wish only with an open reminder, and shows one already sent", () => {
    expect(profileBirthdayWishState({ hasOpenReminder: false, alreadyWished: false })).toBe("none");
    expect(profileBirthdayWishState({ hasOpenReminder: true, alreadyWished: false })).toBe("available");
    expect(profileBirthdayWishState({ hasOpenReminder: true, alreadyWished: true })).toBe("wished");
  });
});

describe("loadProfileBirthdayCard", () => {
  const now = new Date("2026-11-07T12:00:00Z");
  const viewer = { id: "viewer", isGuestPreview: false };
  const viewerRow = {
    id: "viewer",
    status: "ACTIVE",
    isGuestPreview: false,
    birthDate: new Date("1985-01-01T00:00:00.000Z"),
    timeZone: "Europe/Paris",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    connectionFindMany.mockResolvedValue([{ requesterId: "owner", targetId: "viewer" }]);
    membershipFindMany.mockResolvedValue([]);
    userFindMany.mockResolvedValue([viewerRow]);
    blockFindMany.mockResolvedValue([]);
    memberFindMany.mockResolvedValue([]);
    reminderFindFirst.mockResolvedValue({ year: 2026 });
    wishFindUnique.mockResolvedValue(null);
  });

  const queries = () =>
    [connectionFindMany, membershipFindMany, userFindMany, blockFindMany, memberFindMany, reminderFindFirst, wishFindUnique]
      .map((fn) => fn.mock.calls.length)
      .reduce((a, b) => a + b, 0);

  it("runs no query at all on any other day", async () => {
    expect(await loadProfileBirthdayCard(viewer, owner(), new Date("2026-11-08T12:00:00Z"))).toBeNull();
    expect(await loadProfileBirthdayCard(viewer, owner({ birthdayAudience: "NONE" }), now)).toBeNull();
    expect(queries()).toBe(0);
  });

  it("greets the owner without a query", async () => {
    expect(await loadProfileBirthdayCard({ id: "owner", isGuestPreview: false }, owner(), now)).toEqual({ kind: "own" });
    expect(queries()).toBe(0);
  });

  it("never shows it to a guest preview session", async () => {
    expect(await loadProfileBirthdayCard({ id: "guest", isGuestPreview: true }, owner(), now)).toBeNull();
    expect(queries()).toBe(0);
  });

  it("shows a connection the card with Send a wish while their reminder is open", async () => {
    expect(await loadProfileBirthdayCard(viewer, owner(), now)).toEqual({ kind: "visitor", wish: "available" });
    expect(reminderFindFirst.mock.calls[0][0].where).toMatchObject({ celebrantId: "owner", recipientId: "viewer" });
    expect(wishFindUnique.mock.calls[0][0].where).toEqual({
      senderId_celebrantId_year: { senderId: "viewer", celebrantId: "owner", year: 2026 },
    });
  });

  it("says when the visitor already wished, and offers no button before their reminder", async () => {
    wishFindUnique.mockResolvedValue({ id: "w" });
    expect(await loadProfileBirthdayCard(viewer, owner(), now)).toEqual({ kind: "visitor", wish: "wished" });
    reminderFindFirst.mockResolvedValue(null);
    expect(await loadProfileBirthdayCard(viewer, owner(), now)).toEqual({ kind: "visitor", wish: "none" });
  });

  it("hides it from anyone outside the chosen audience", async () => {
    // CIRCLES only, and the visitor shares no Circle: their connection doesn't count.
    expect(await loadProfileBirthdayCard(viewer, owner({ birthdayAudience: "CIRCLES" }), now)).toBeNull();
    connectionFindMany.mockResolvedValue([]);
    expect(await loadProfileBirthdayCard(viewer, owner({ birthdayAudience: "CONNECTIONS" }), now)).toBeNull();
    // A fellow Circle member is in a CIRCLES audience.
    membershipFindMany.mockResolvedValue([{ userId: "viewer", circle: { visibility: "PRIVATE" } }]);
    expect(await loadProfileBirthdayCard(viewer, owner({ birthdayAudience: "CIRCLES" }), now)).toEqual({
      kind: "visitor",
      wish: "available",
    });
  });

  it("hides it when either one blocked the other", async () => {
    blockFindMany.mockResolvedValue([{ blockerId: "owner", blockedId: "viewer" }]);
    expect(await loadProfileBirthdayCard(viewer, owner(), now)).toBeNull();
    blockFindMany.mockResolvedValue([{ blockerId: "viewer", blockedId: "owner" }]);
    expect(await loadProfileBirthdayCard(viewer, owner(), now)).toBeNull();
    expect(reminderFindFirst).not.toHaveBeenCalled();
  });

  it("hides it from a visitor under 18, or who hides their chat with the owner", async () => {
    userFindMany.mockResolvedValue([{ ...viewerRow, birthDate: new Date("2010-01-01T00:00:00.000Z") }]);
    expect(await loadProfileBirthdayCard(viewer, owner(), now)).toBeNull();
    userFindMany.mockResolvedValue([viewerRow]);
    memberFindMany.mockResolvedValue([{ userId: "viewer" }]);
    expect(await loadProfileBirthdayCard(viewer, owner(), now)).toBeNull();
  });
});

describe("ProfileBirthdayCard (server render)", () => {
  const render = (card: Card, name: string | null = "Ada") =>
    renderToStaticMarkup(createElement(ProfileBirthdayCard, { card, person: { id: "owner", name } }));

  it("is a region labelled by its heading", () => {
    const html = render({ kind: "own" });
    const labelledBy = html.match(/role="region" aria-labelledby="([^"]+)"/)?.[1];
    expect(labelledBy).toBeTruthy();
    expect(html).toContain(`<h2 id="${labelledBy}"`);
  });

  it("greets the owner from YuKon3t, with a link to the setting", () => {
    const html = render({ kind: "own" });
    expect(html).toContain("Happy birthday from YuKon3t!");
    expect(html).toContain('href="/settings#birthdays"');
    expect(html).not.toContain("Send a wish");
  });

  it("tells a visitor whose birthday it is, with Send a wish only when it can be sent", () => {
    const available = render({ kind: "visitor", wish: "available" });
    expect(available).toContain("It&#x27;s Ada&#x27;s birthday today");
    expect(available).toContain("YuKon3t wishes Ada a happy birthday.");
    expect(available).toContain("Send a wish");
    expect(render({ kind: "visitor", wish: "wished" })).toContain("Wishes sent");
    expect(render({ kind: "visitor", wish: "wished" })).not.toContain("Send a wish");
    expect(render({ kind: "visitor", wish: "none" })).not.toContain("Send a wish");
  });

  it("is still: no animation or confetti, and never a year or an age", () => {
    for (const card of [{ kind: "own" }, { kind: "visitor", wish: "available" }] as Card[]) {
      const html = render(card);
      expect(html).not.toMatch(/animate|transition|confetti/);
      const text = html.replace(/<[^>]*>/g, " ");
      expect(text).not.toMatch(/\b(19|20)\d\d\b/);
      expect(text).not.toMatch(/\bturns?\b|years? old/i);
    }
  });
});
