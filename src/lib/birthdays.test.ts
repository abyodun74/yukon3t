import { describe, expect, it } from "vitest";
import {
  BIRTHDAY_AUDIENCE_VALUES,
  BIRTHDAY_DEFAULT_AUDIENCE,
  ageOn,
  audienceAllows,
  birthdayNoticePendingAtSignUp,
  birthdaySettingsView,
  birthdayCandidateMonthDays,
  birthdayRefusal,
  birthdayReminderDue,
  birthdayReminderKey,
  birthdayWishContent,
  canShareBirthday,
  celebrationDay,
  groupBirthdayPushes,
  isBirthdayOn,
  isBirthdayParticipant,
  isLeapYear,
  isSharingBirthday,
  isValidTimeZone,
  localDateTime,
  localDateToDbDate,
  planBirthdayReminders,
  sharedCircleCounts,
  type BirthdayAudience,
  type BirthdayPerson,
} from "@/lib/birthdays";

// Birth dates are stored as UTC midnight of the date entered.
const born = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("time zones", () => {
  it("accepts IANA zones and refuses anything else", () => {
    expect(isValidTimeZone("Africa/Lagos")).toBe(true);
    expect(isValidTimeZone("America/Los_Angeles")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
    expect(isValidTimeZone("x".repeat(65))).toBe(false);
  });

  it("reads the local date and hour, including across the date line", () => {
    const now = new Date("2026-11-06T20:30:00Z");
    expect(localDateTime(now, "UTC")).toEqual({ year: 2026, month: 11, day: 6, hour: 20 });
    expect(localDateTime(now, "Pacific/Kiritimati")).toEqual({ year: 2026, month: 11, day: 7, hour: 10 });
    expect(localDateTime(now, "Pacific/Pago_Pago")).toEqual({ year: 2026, month: 11, day: 6, hour: 9 });
    expect(localDateTime(now, "Asia/Kolkata")).toEqual({ year: 2026, month: 11, day: 7, hour: 2 });
  });

  it("reads no or an unknown time zone as UTC", () => {
    const now = new Date("2026-11-06T23:59:00Z");
    expect(localDateTime(now, null)).toEqual(localDateTime(now, "UTC"));
    expect(localDateTime(now, "Nowhere/Land")).toEqual(localDateTime(now, "UTC"));
  });

  it("reports midnight as hour 0", () => {
    expect(localDateTime(new Date("2026-11-06T00:00:00Z"), "UTC").hour).toBe(0);
  });
});

describe("reminder timing", () => {
  const birthDate = born("1990-11-07");

  it("is due from midnight on the birthday, in the recipient's own time zone", () => {
    // 23:59 on Nov 6 in Lagos (UTC+1): not yet. 00:00 on Nov 7: due.
    expect(birthdayReminderDue(birthDate, new Date("2026-11-06T22:59:00Z"), "Africa/Lagos")).toBeNull();
    expect(birthdayReminderDue(birthDate, new Date("2026-11-06T23:00:00Z"), "Africa/Lagos")).toEqual({
      year: 2026,
      occasionDate: { year: 2026, month: 11, day: 7 },
    });
  });

  it("is caught by the first 15-minute run after local midnight, in every kind of offset", () => {
    // The cron runs at :00, :15, :30, :45 UTC. Kolkata (UTC+5:30) and Kathmandu (UTC+5:45) reach midnight between runs.
    const runs = (fromIso: string, count: number) =>
      Array.from({ length: count }, (_, i) => new Date(new Date(fromIso).getTime() + i * 15 * 60_000));
    for (const [zone, firstDueRun] of [
      ["Asia/Kolkata", "2026-11-06T18:30:00Z"],
      ["Asia/Kathmandu", "2026-11-06T18:15:00Z"],
      ["America/New_York", "2026-11-07T05:00:00Z"],
    ] as const) {
      const dueRuns = runs("2026-11-06T12:00:00Z", 24 * 4).filter((now) => birthdayReminderDue(birthDate, now, zone));
      expect(dueRuns[0].toISOString(), zone).toBe(new Date(firstDueRun).toISOString());
      // Every due run that day carries the same key; the unique (celebrant, recipient, year) keeps it to one send.
      expect(new Set(dueRuns.map((now) => birthdayReminderDue(birthDate, now, zone)?.year))).toEqual(new Set([2026]));
    }
  });

  it("is still due on a day whose midnight doesn't exist (DST starts at 00:00)", () => {
    // Santiago, Sep 6 2026: 00:00 (UTC-4) jumps to 01:00 (UTC-3), so the day begins at 01:00 local = 04:00 UTC.
    const sep6 = born("1990-09-06");
    expect(localDateTime(new Date("2026-09-06T03:59:00Z"), "America/Santiago")).toMatchObject({ month: 9, day: 5 });
    expect(localDateTime(new Date("2026-09-06T04:00:00Z"), "America/Santiago")).toMatchObject({ month: 9, day: 6, hour: 1 });
    expect(birthdayReminderDue(sep6, new Date("2026-09-06T03:45:00Z"), "America/Santiago")).toBeNull();
    expect(birthdayReminderDue(sep6, new Date("2026-09-06T04:00:00Z"), "America/Santiago")).toEqual({
      year: 2026,
      occasionDate: { year: 2026, month: 9, day: 6 },
    });
  });

  it("keys a day whose last hour repeats (DST ends at 00:00) to one reminder", () => {
    // Santiago, Apr 5 2026: 00:00 (UTC-3) goes back to 23:00 Apr 4 (UTC-4), so 23:00-23:59 Apr 4 happens twice and
    // Apr 5 begins at 04:00 UTC. A run in either copy of that hour isn't the birthday yet; every run on Apr 5 is the
    // same (year 2026) key.
    const apr5 = born("1990-04-05");
    expect(birthdayReminderDue(apr5, new Date("2026-04-05T02:30:00Z"), "America/Santiago")).toBeNull();
    expect(birthdayReminderDue(apr5, new Date("2026-04-05T03:30:00Z"), "America/Santiago")).toBeNull();
    expect(birthdayReminderDue(apr5, new Date("2026-04-05T04:00:00Z"), "America/Santiago")?.year).toBe(2026);
    expect(birthdayReminderDue(apr5, new Date("2026-04-06T03:45:00Z"), "America/Santiago")?.year).toBe(2026);
    expect(birthdayReminderDue(apr5, new Date("2026-04-06T04:00:00Z"), "America/Santiago")).toBeNull();
  });

  it("uses UTC midnight for a recipient whose time zone isn't known yet", () => {
    expect(birthdayReminderDue(birthDate, new Date("2026-11-06T23:59:00Z"), null)).toBeNull();
    expect(birthdayReminderDue(birthDate, new Date("2026-11-07T00:00:00Z"), null)?.year).toBe(2026);
    expect(birthdayReminderDue(birthDate, new Date("2026-11-07T00:00:00Z"), "Nowhere/Land")?.year).toBe(2026);
  });

  it("still sends later the same day when a run was missed, and not the next day", () => {
    expect(birthdayReminderDue(birthDate, new Date("2026-11-07T22:30:00Z"), "Africa/Lagos")).not.toBeNull();
    expect(birthdayReminderDue(birthDate, new Date("2026-11-07T23:30:00Z"), "Africa/Lagos")).toBeNull();
  });

  it("follows each recipient's calendar: the same instant is the birthday for one and not for another", () => {
    const now = new Date("2026-11-06T21:00:00Z");
    // 10:00 on Nov 7 in Auckland (UTC+13): due. 13:00 on Nov 6 in Los Angeles: not the birthday yet.
    expect(birthdayReminderDue(birthDate, now, "Pacific/Auckland")?.occasionDate).toEqual({ year: 2026, month: 11, day: 7 });
    expect(birthdayReminderDue(birthDate, now, "America/Los_Angeles")).toBeNull();
  });

  it("uses the recipient's local year, so a New Year's Eve birthday is keyed to the right year", () => {
    const nye = born("1985-12-31");
    expect(birthdayReminderDue(nye, new Date("2026-12-31T20:00:00Z"), "America/New_York")?.year).toBe(2026);
  });

  it("looks for birthdays dated yesterday, today and tomorrow in UTC, the span of every time zone", () => {
    const days = birthdayCandidateMonthDays(new Date("2026-11-06T12:00:00Z"));
    expect(days).toEqual(
      expect.arrayContaining([
        { month: 11, day: 6 },
        { month: 11, day: 7 },
      ]),
    );
    expect(birthdayCandidateMonthDays(new Date("2026-11-06T02:00:00Z"))).toEqual(
      expect.arrayContaining([
        { month: 11, day: 5 },
        { month: 11, day: 6 },
      ]),
    );
  });
});

describe("Feb 29 birthdays", () => {
  const leapling = born("2000-02-29");

  it("knows leap years", () => {
    expect([2024, 2000, 2028].map(isLeapYear)).toEqual([true, true, true]);
    expect([2026, 1900, 2100].map(isLeapYear)).toEqual([false, false, false]);
  });

  it("are celebrated on Feb 28 in a non-leap year and on Feb 29 in a leap year", () => {
    expect(celebrationDay(2, 29, 2026)).toEqual({ month: 2, day: 28 });
    expect(celebrationDay(2, 29, 2028)).toEqual({ month: 2, day: 29 });
    expect(isBirthdayOn(leapling, { year: 2026, month: 2, day: 28 })).toBe(true);
    expect(isBirthdayOn(leapling, { year: 2026, month: 3, day: 1 })).toBe(false);
    expect(isBirthdayOn(leapling, { year: 2028, month: 2, day: 28 })).toBe(false);
    expect(isBirthdayOn(leapling, { year: 2028, month: 2, day: 29 })).toBe(true);
  });

  it("are reminded on Feb 28 of a non-leap year, once", () => {
    const due = birthdayReminderDue(leapling, new Date("2026-02-28T10:00:00Z"), "UTC");
    expect(due).toEqual({ year: 2026, occasionDate: { year: 2026, month: 2, day: 28 } });
    expect(birthdayReminderDue(leapling, new Date("2026-03-01T10:00:00Z"), "UTC")).toBeNull();
  });

  it("are found by the cron's prefilter on Feb 28 of a non-leap year only", () => {
    expect(birthdayCandidateMonthDays(new Date("2026-02-28T12:00:00Z"))).toContainEqual({ month: 2, day: 29 });
    // A leap year's Feb 28 doesn't stand in for Feb 29 (05:00 UTC: it is Feb 27 or 28 everywhere on Earth).
    expect(birthdayCandidateMonthDays(new Date("2028-02-28T05:00:00Z"))).not.toContainEqual({ month: 2, day: 29 });
    expect(birthdayCandidateMonthDays(new Date("2028-02-29T12:00:00Z"))).toContainEqual({ month: 2, day: 29 });
  });

  it("count a year older on the day they are celebrated", () => {
    expect(ageOn(leapling, { year: 2018, month: 2, day: 27 })).toBe(17);
    expect(ageOn(leapling, { year: 2018, month: 2, day: 28 })).toBe(18);
    expect(ageOn(born("1990-11-07"), { year: 2026, month: 11, day: 6 })).toBe(35);
    expect(ageOn(born("1990-11-07"), { year: 2026, month: 11, day: 7 })).toBe(36);
  });
});

describe("idempotency and grouping", () => {
  const celebrant = { id: "c1", birthDate: born("1990-11-07") };
  const now = new Date("2026-11-07T07:00:00Z");

  it("plans one reminder per due recipient and none for anyone already reminded this year", () => {
    const recipients = [
      { id: "r1", timeZone: "UTC" },
      { id: "r2", timeZone: "Europe/London" },
      { id: "r3", timeZone: "America/Los_Angeles" }, // 23:00 on Nov 6 there: not yet
    ];
    const first = planBirthdayReminders({ celebrant, recipients, now });
    expect(first.map((p) => p.recipientId)).toEqual(["r1", "r2"]);
    expect(first[0]).toEqual({ celebrantId: "c1", recipientId: "r1", year: 2026, occasionDate: { year: 2026, month: 11, day: 7 } });

    // A second run the same day plans nothing for those already sent.
    const sent = new Set(first.map((p) => birthdayReminderKey(p.celebrantId, p.recipientId, p.year)));
    expect(planBirthdayReminders({ celebrant, recipients, alreadySent: sent, now })).toEqual([]);
    // ...but the next year's birthday is a new key.
    expect(birthdayReminderKey("c1", "r1", 2027)).not.toBe(birthdayReminderKey("c1", "r1", 2026));
  });

  it("groups several birthdays into one push per recipient", () => {
    const day = localDateToDbDate({ year: 2026, month: 11, day: 7 });
    const groups = groupBirthdayPushes(
      [
        { celebrantId: "ada", recipientId: "r1", occasionDate: day },
        { celebrantId: "bo", recipientId: "r1", occasionDate: day },
        { celebrantId: "cy", recipientId: "r1", occasionDate: day },
        { celebrantId: "ada", recipientId: "r2", occasionDate: day },
      ],
      new Set(),
    );
    expect(groups).toEqual([
      { recipientId: "r1", celebrantIds: ["ada", "bo", "cy"] },
      { recipientId: "r2", celebrantIds: ["ada"] },
    ]);
  });

  it("doesn't push a recipient again for a birthday found later the same day", () => {
    const day = localDateToDbDate({ year: 2026, month: 11, day: 7 });
    const groups = groupBirthdayPushes(
      [
        { celebrantId: "late", recipientId: "r1", occasionDate: day },
        { celebrantId: "late", recipientId: "r2", occasionDate: day },
      ],
      new Set(["r1|2026-11-07"]),
    );
    expect(groups).toEqual([{ recipientId: "r2", celebrantIds: ["late"] }]);
  });

  it("stores the occasion as a plain date", () => {
    expect(localDateToDbDate({ year: 2026, month: 2, day: 28 }).toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });
});

describe("who may be reminded", () => {
  const today = { year: 2026, month: 11, day: 7 };
  const adult = (id: string, extra: Partial<BirthdayPerson> = {}): BirthdayPerson => ({
    id,
    status: "ACTIVE",
    isGuestPreview: false,
    birthDate: born("1990-11-07"),
    ...extra,
  });
  const celebrant = (audience: BirthdayAudience, extra: Partial<BirthdayPerson> = {}) => ({
    ...adult("c1", extra),
    birthdayAudience: audience,
  });
  const connected = { connected: true, sharesCircle: false };
  const circleOnly = { connected: false, sharesCircle: true };
  const refusal = (overrides: Partial<Parameters<typeof birthdayRefusal>[0]> = {}) =>
    birthdayRefusal({
      celebrant: celebrant("BOTH"),
      recipient: adult("r1"),
      link: connected,
      blocked: false,
      recipientHidesChat: false,
      date: today,
      ...overrides,
    });

  it("lets an adult in the audience be reminded", () => {
    expect(refusal()).toBeNull();
  });

  it("is on by default with connections and Circles, off only when the person chose Off, and needs a birth date", () => {
    expect(BIRTHDAY_DEFAULT_AUDIENCE).toBe("BOTH");
    expect(refusal({ celebrant: celebrant(BIRTHDAY_DEFAULT_AUDIENCE), link: connected })).toBeNull();
    expect(refusal({ celebrant: celebrant(BIRTHDAY_DEFAULT_AUDIENCE), link: circleOnly })).toBeNull();
    expect(refusal({ celebrant: celebrant("NONE") })).toBe("not_sharing");
    expect(refusal({ celebrant: celebrant("BOTH", { birthDate: null }) })).toBe("not_sharing");
  });

  it("treats every value but NONE as sharing", () => {
    expect(BIRTHDAY_AUDIENCE_VALUES.filter(isSharingBirthday)).toEqual(["CONNECTIONS", "CIRCLES", "BOTH"]);
  });

  it("follows the chosen audience", () => {
    expect(audienceAllows("CONNECTIONS", connected)).toBe(true);
    expect(audienceAllows("CONNECTIONS", circleOnly)).toBe(false);
    expect(audienceAllows("CIRCLES", circleOnly)).toBe(true);
    expect(audienceAllows("CIRCLES", connected)).toBe(false);
    expect(audienceAllows("BOTH", connected)).toBe(true);
    expect(audienceAllows("BOTH", circleOnly)).toBe(true);
    expect(audienceAllows("BOTH", { connected: false, sharesCircle: false })).toBe(false);
    expect(audienceAllows("NONE", connected)).toBe(false);
    expect(audienceAllows("NONE", circleOnly)).toBe(false);
    expect(refusal({ celebrant: celebrant("CIRCLES"), link: connected })).toBe("not_in_audience");
  });

  it("never reminds across a block, in either direction, or someone hiding their chat with the person", () => {
    expect(refusal({ blocked: true })).toBe("blocked");
    expect(refusal({ recipientHidesChat: true })).toBe("hidden");
  });

  it("leaves out minors on both sides, and accounts with no known age", () => {
    const seventeen = { birthDate: born("2009-11-08") };
    expect(refusal({ recipient: adult("r1", seventeen) })).toBe("ineligible");
    expect(refusal({ celebrant: celebrant("BOTH", seventeen) })).toBe("ineligible");
    expect(refusal({ recipient: adult("r1", { birthDate: null }) })).toBe("ineligible");
    // Turning 18 on the day counts.
    expect(refusal({ celebrant: celebrant("BOTH", { birthDate: born("2008-11-07") }) })).toBeNull();
  });

  it("leaves out suspended, banned and deactivated accounts and the shared guest identity", () => {
    for (const status of ["SUSPENDED", "BANNED", "DEACTIVATED", "DELETED"]) {
      expect(refusal({ recipient: adult("r1", { status }) }), status).toBe("ineligible");
      expect(refusal({ celebrant: celebrant("BOTH", { status }) }), status).toBe("ineligible");
    }
    expect(isBirthdayParticipant(adult("g", { isGuestPreview: true }), today)).toBe(false);
  });

  it("never reminds someone of their own birthday", () => {
    expect(refusal({ recipient: adult("c1") })).toBe("self");
  });

  it("counts a shared Circle only for a member, who can see its member list (private ones included)", () => {
    expect(sharedCircleCounts({ visibility: "PUBLIC" }, true)).toBe(true);
    expect(sharedCircleCounts({ visibility: "PRIVATE" }, true)).toBe(true);
    expect(sharedCircleCounts({ visibility: "PRIVATE" }, false)).toBe(false);
    expect(sharedCircleCounts({ visibility: "PUBLIC" }, false)).toBe(false);
  });

  it("only lets an adult with a known birth date turn sharing on", () => {
    const now = new Date("2026-11-07T12:00:00Z");
    expect(canShareBirthday(born("1990-01-01"), now)).toBe(true);
    expect(canShareBirthday(born("2008-11-07"), now)).toBe(true);
    expect(canShareBirthday(born("2008-11-08"), now)).toBe(false);
    expect(canShareBirthday(null, now)).toBe(false);
  });
});

describe("wish content", () => {
  const presets = {
    happyBirthday: "Happy birthday!",
    wonderfulYear: "Wonderful year!",
    celebrateYou: "Celebrate!",
    bestWishes: "Best wishes!",
  };

  it("sends the emoji, the preset in the sender's wording, or the trimmed custom text", () => {
    expect(birthdayWishContent({ kind: "emoji", emoji: "🎂" }, presets)).toBe("🎂");
    expect(birthdayWishContent({ kind: "preset", presetId: "bestWishes" }, presets)).toBe("Best wishes!");
    expect(birthdayWishContent({ kind: "custom", text: "  Have a great one  " }, presets)).toBe("Have a great one");
  });
});

describe("birthdaySettingsView (Settings -> Privacy -> Birthday)", () => {
  it("offers an adult who is sharing every way of sharing, plus Turn off", () => {
    expect(birthdaySettingsView("CIRCLES", true)).toEqual({
      sharing: true,
      audiences: ["BOTH", "CONNECTIONS", "CIRCLES"],
      canTurnOn: false,
    });
  });

  it("lets an adult who turned it off turn it back on, choosing who to share it with", () => {
    expect(birthdaySettingsView("NONE", true)).toEqual({
      sharing: false,
      audiences: ["BOTH", "CONNECTIONS", "CIRCLES"],
      canTurnOn: true,
    });
  });

  it("lets an under-18 account (or one without a birth date) keep the default or turn it off, never turn it back on", () => {
    expect(birthdaySettingsView("BOTH", false)).toEqual({ sharing: true, audiences: [], canTurnOn: false });
    expect(birthdaySettingsView("NONE", false)).toEqual({ sharing: false, audiences: [], canTurnOn: false });
  });

  it("never offers Off as a way of sharing (it has its own button)", () => {
    for (const audience of BIRTHDAY_AUDIENCE_VALUES) {
      expect(birthdaySettingsView(audience, true).audiences).not.toContain("NONE");
    }
  });
});

describe("birthdayNoticePendingAtSignUp", () => {
  const now = new Date("2026-11-10T12:00:00Z");

  it("owes an under-18 sign-up the one-time notice for when sharing starts at 18", () => {
    expect(birthdayNoticePendingAtSignUp(born("2010-05-05"), BIRTHDAY_DEFAULT_AUDIENCE, now)).toBe(true);
    // Turns 18 tomorrow: still a minor today.
    expect(birthdayNoticePendingAtSignUp(born("2008-11-11"), "BOTH", now)).toBe(true);
  });

  it("leaves an adult sign-up without it (18 today counts as adult)", () => {
    expect(birthdayNoticePendingAtSignUp(born("1990-03-03"), BIRTHDAY_DEFAULT_AUDIENCE, now)).toBe(false);
    expect(birthdayNoticePendingAtSignUp(born("2008-11-10"), "BOTH", now)).toBe(false);
  });

  it("is never owed without a birth date or while not sharing", () => {
    expect(birthdayNoticePendingAtSignUp(null, "BOTH", now)).toBe(false);
    expect(birthdayNoticePendingAtSignUp(undefined, "BOTH", now)).toBe(false);
    expect(birthdayNoticePendingAtSignUp(born("2010-05-05"), "NONE", now)).toBe(false);
  });
});
