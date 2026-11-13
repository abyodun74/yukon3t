import { beforeEach, describe, expect, it, vi } from "vitest";

// loadGiftOccasions (src/lib/gift-occasions-data.ts): reads the facts for one recipient and viewer, never throws (any
// failure is "no occasions"), asks the holiday dataset only when the recipient's switches allow it, counts the
// connection anniversary only when BOTH opted in, and an event only when the viewer may open it.

let recipient: Record<string, unknown> | null;
let viewerRow: Record<string, unknown> | null;
let connection: { respondedAt: Date | null } | null;
let events: { id: string; eventAt: Date }[];
let failQuery: boolean;
let wins: { challenge: Record<string, unknown> }[];
let blocks: { blockerId: string; blockedId: string }[];
const holidaysTodayForGifts = vi.fn(() => 1);
const loadCircleEventAccess = vi.fn(async () => ({}) as unknown);
const captureError = vi.fn();

const NOW = new Date("2026-11-13T12:00:00Z");

vi.mock("@/lib/error-tracking", () => ({ captureError: (...a: unknown[]) => captureError(...a) }));
vi.mock("@/lib/holidays-data", () => ({ holidaysTodayForGifts: () => holidaysTodayForGifts() }));
vi.mock("@/lib/circle-events-data", () => ({ loadCircleEventAccess: () => loadCircleEventAccess() }));
vi.mock("@/lib/birthdays-data", () => ({ eligibleBirthdayRecipients: async () => [{ id: "viewer", timeZone: null }] }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        if (failQuery) throw new Error("database down");
        return where.id === "viewer" ? viewerRow : recipient;
      },
    },
    connection: { findFirst: async () => connection },
    circleMembership: { findMany: async () => [] },
    post: { findMany: async () => events },
    giftSelfOccasion: { findMany: async () => [] },
    challengeWinner: { findMany: async () => wins },
    block: { findMany: async () => blocks },
  },
}));

import { loadGiftOccasions } from "@/lib/gift-occasions-data";

const VIEWER = { id: "viewer", isAdmin: true };

beforeEach(() => {
  vi.clearAllMocks();
  failQuery = false;
  recipient = {
    id: "r",
    status: "ACTIVE",
    isAdmin: false,
    isGuestPreview: false,
    birthDate: new Date("1990-11-13T00:00:00Z"),
    birthdayAudience: "BOTH",
    timeZone: null,
    onboardedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    country: "Nigeria",
    holidayReminders: true,
    giftCultureOccasions: true,
    giftAnniversaryOptIn: true,
  };
  viewerRow = { giftAnniversaryOptIn: true };
  connection = { respondedAt: new Date("2025-11-13T08:00:00Z") };
  events = [];
  wins = [];
  blocks = [];
});

describe("loadGiftOccasions", () => {
  it("finds the birthday (same audience check as the card), the holiday and the mutual anniversary", async () => {
    const kinds = (await loadGiftOccasions("r", VIEWER, NOW)).map((o) => o.kind);
    expect(kinds).toEqual(["BIRTHDAY", "CONNECTION_ANNIVERSARY", "HOLIDAY"]);
  });

  it("asks for holidays only when the recipient's reminders and Culture prompts are both on", async () => {
    recipient = { ...recipient!, giftCultureOccasions: false };
    expect((await loadGiftOccasions("r", VIEWER, NOW)).map((o) => o.kind)).not.toContain("HOLIDAY");
    recipient = { ...recipient!, giftCultureOccasions: true, holidayReminders: false };
    expect((await loadGiftOccasions("r", VIEWER, NOW)).map((o) => o.kind)).not.toContain("HOLIDAY");
    expect(holidaysTodayForGifts).not.toHaveBeenCalled();
  });

  it("counts the connection anniversary only when both people opted in", async () => {
    viewerRow = { giftAnniversaryOptIn: false };
    expect((await loadGiftOccasions("r", VIEWER, NOW)).map((o) => o.kind)).not.toContain("CONNECTION_ANNIVERSARY");
    viewerRow = { giftAnniversaryOptIn: true };
    recipient = { ...recipient!, giftAnniversaryOptIn: false };
    expect((await loadGiftOccasions("r", VIEWER, NOW)).map((o) => o.kind)).not.toContain("CONNECTION_ANNIVERSARY");
  });

  it("counts an event only if the viewer may open it", async () => {
    events = [{ id: "e1", eventAt: new Date(NOW.getTime() + 60 * 60_000) }];
    expect((await loadGiftOccasions("r", VIEWER, NOW)).map((o) => o.kind)).toContain("CIRCLE_EVENT_DAY");
    loadCircleEventAccess.mockResolvedValueOnce(null);
    expect((await loadGiftOccasions("r", VIEWER, NOW)).map((o) => o.kind)).not.toContain("CIRCLE_EVENT_DAY");
  });

  it("never throws: a database failure, a missing or inactive recipient, or yourself is no occasions", async () => {
    failQuery = true;
    await expect(loadGiftOccasions("r", VIEWER, NOW)).resolves.toEqual([]);
    expect(captureError).toHaveBeenCalled();
    failQuery = false;
    recipient = null;
    expect(await loadGiftOccasions("r", VIEWER, NOW)).toEqual([]);
    recipient = { id: "r", status: "SUSPENDED", isGuestPreview: false };
    expect(await loadGiftOccasions("r", VIEWER, NOW)).toEqual([]);
    expect(await loadGiftOccasions("viewer", VIEWER, NOW)).toEqual([]);
  });

  it("copes with a recipient missing time zone, country and birth date", async () => {
    recipient = { ...recipient!, timeZone: null, country: null, birthDate: null };
    holidaysTodayForGifts.mockReturnValueOnce(0);
    const out = await loadGiftOccasions("r", VIEWER, NOW);
    expect(out.map((o) => o.kind)).toEqual(["CONNECTION_ANNIVERSARY"]);
  });
});

// Phase B: a host-declared challenge win, visible to this viewer, is the CHALLENGE_WIN occasion (Gaming only).
describe("loadGiftOccasions: challenge wins", () => {
  const HOUR = 60 * 60_000;
  const member = (yes: boolean) => (yes ? [{ id: "m" }] : []);
  const circleWin = (visibility: string, viewerIsMember: boolean, over: Record<string, unknown> = {}) => ({
    challenge: {
      decidedAt: new Date(NOW.getTime() - 2 * HOUR),
      hostId: "host",
      circle: { visibility, members: member(viewerIsMember) },
      liveStream: null,
      ...over,
    },
  });

  it("counts a win in a public Circle, and in a private one only for its members", async () => {
    wins = [circleWin("PUBLIC", false)];
    expect((await loadGiftOccasions("r", VIEWER, NOW)).map((o) => o.kind)).toContain("CHALLENGE_WIN");
    wins = [circleWin("PRIVATE", false)];
    expect((await loadGiftOccasions("r", VIEWER, NOW)).map((o) => o.kind)).not.toContain("CHALLENGE_WIN");
    wins = [circleWin("PRIVATE", true)];
    expect((await loadGiftOccasions("r", VIEWER, NOW)).map((o) => o.kind)).toContain("CHALLENGE_WIN");
  });

  it("never across a block with the challenge's host, and never past 72h", async () => {
    wins = [circleWin("PUBLIC", true)];
    blocks = [{ blockerId: "host", blockedId: "viewer" }];
    expect((await loadGiftOccasions("r", VIEWER, NOW)).map((o) => o.kind)).not.toContain("CHALLENGE_WIN");
    blocks = [];
    wins = [circleWin("PUBLIC", true, { decidedAt: new Date(NOW.getTime() - 73 * HOUR) })];
    expect((await loadGiftOccasions("r", VIEWER, NOW)).map((o) => o.kind)).not.toContain("CHALLENGE_WIN");
  });

  it("follows the stream's audience for a live challenge", async () => {
    const live = (stream: Record<string, unknown>) => ({
      challenge: { decidedAt: new Date(NOW.getTime() - HOUR), hostId: "host", circle: null, liveStream: stream },
    });
    wins = [live({ hostId: "host", targetUserId: null, circle: null })];
    expect((await loadGiftOccasions("r", VIEWER, NOW)).map((o) => o.kind)).toContain("CHALLENGE_WIN");
    wins = [live({ hostId: "host", targetUserId: "someone-else", circle: null })];
    expect((await loadGiftOccasions("r", VIEWER, NOW)).map((o) => o.kind)).not.toContain("CHALLENGE_WIN");
    wins = [live({ hostId: "host", targetUserId: null, circle: { visibility: "PRIVATE", members: [] } })];
    expect((await loadGiftOccasions("r", VIEWER, NOW)).map((o) => o.kind)).not.toContain("CHALLENGE_WIN");
  });

  it("returns only the kind and a coarse window: no title, no Circle, no date", async () => {
    wins = [circleWin("PUBLIC", true, { title: "Secret Circle Cup" } as never)];
    const out = await loadGiftOccasions("r", VIEWER, NOW);
    const win = out.find((o) => o.kind === "CHALLENGE_WIN")!;
    expect(win).toEqual({
      kind: "CHALLENGE_WIN",
      universes: ["GAMING"],
      tags: ["tournament_win", "achievement"],
      reasonKey: "CHALLENGE_WIN",
      window: "this_week",
    });
    expect(JSON.stringify(out)).not.toMatch(/Secret|Circle Cup|\d/);
  });
});
