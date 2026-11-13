import { beforeEach, describe, expect, it, vi } from "vitest";

// loadGiftOccasions (src/lib/gift-occasions-data.ts): reads the facts for one recipient and viewer, never throws (any
// failure is "no occasions"), asks the holiday dataset only when the recipient's switches allow it, counts the
// connection anniversary only when BOTH opted in, and an event only when the viewer may open it.

let recipient: Record<string, unknown> | null;
let viewerRow: Record<string, unknown> | null;
let connection: { respondedAt: Date | null } | null;
let events: { id: string; eventAt: Date }[];
let failQuery: boolean;
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
