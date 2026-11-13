import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  HOLIDAY_REMINDER_HOUR,
  dueHolidays,
  holidayCountryLabel,
  holidayName,
  holidaySlug,
  holidaysOfYear,
  holidaysOn,
  isHolidayCountry,
  selectHolidays,
} from "./holidays";
import { COUNTRIES } from "./countries";
import { countryCode } from "./i18n/country-names";
import { decodeNotice, encodeNotice, noticeText } from "./notification-notice";
import { holidayPush } from "./push-text";
import { pagesEn } from "./i18n/en/pages";

const names = (cc: string, year: number) => holidaysOfYear(cc, year).map((h) => `${h.date} ${h.englishName}`);
const dueNames = (country: string, timeZone: string | null, iso: string) =>
  dueHolidays(country, timeZone, new Date(iso))?.holidays.map((h) => h.englishName) ?? null;

describe("region: the profile's country", () => {
  it("maps every country in the profile list to an ISO code, except 'Other / Not listed'", () => {
    const missing = COUNTRIES.filter((c) => c !== "Other / Not listed" && !countryCode(c));
    expect(missing).toEqual([]);
    expect(countryCode("Other / Not listed")).toBeNull();
    expect(countryCode(null)).toBeNull();
    expect(countryCode("Nigeria")).toBe("NG");
    expect(countryCode("Congo (DRC)")).toBe("CD");
    expect(countryCode("Palestine")).toBe("PS");
    expect(countryCode("US")).toBe("US");
    // Never a deprecated alias sharing the English name (UK, FX, YU, DD).
    expect(countryCode("United Kingdom")).toBe("GB");
    expect(countryCode("France")).toBe("FR");
    expect(countryCode("Serbia")).toBe("RS");
    expect(countryCode("Germany")).toBe("DE");
  });

  it("covers the large majority of the profile list with holiday data", () => {
    const covered = COUNTRIES.filter((c) => {
      const cc = countryCode(c);
      return cc && isHolidayCountry(cc);
    });
    expect(covered.length).toBeGreaterThan(130);
    for (const c of ["United States", "Nigeria", "United Kingdom", "Brazil", "India", "South Korea", "Mexico", "France"]) {
      expect(isHolidayCountry(countryCode(c)!), c).toBe(true);
    }
  });
});

describe("which holidays are reminded", () => {
  it("United States: federal holidays and notable observances on their actual dates, no trivia", () => {
    const us = names("US", 2026);
    expect(us).toEqual(
      expect.arrayContaining([
        "2026-05-25 Memorial Day",
        "2026-07-04 Independence Day",
        "2026-09-07 Labour Day",
        "2026-11-11 Veterans Day",
        "2026-11-26 Thanksgiving Day",
        "2026-05-10 Mother's Day",
        "2026-06-21 Father's Day",
      ]),
    );
    const joined = us.join("\n");
    // Observed (substitute) day off: the same holiday, so no second reminder on July 3.
    expect(joined).not.toContain("substitute");
    expect(us.filter((n) => n.endsWith("Independence Day"))).toEqual(["2026-07-04 Independence Day"]);
    for (const trivia of ["Valentine", "Halloween", "Tax Day", "Administrative Professionals", "Christmas Eve", "St. Patrick"]) {
      expect(joined, trivia).not.toContain(trivia);
    }
  });

  it("follows the actual date in a year whose observed day falls in the previous year", () => {
    // Jan 1 2028 is a Saturday: the US observes it on Fri Dec 31 2027 (a substitute day), reminded on Jan 1 itself.
    expect(names("US", 2027)).not.toContain("2027-12-31 New Year's Day (substitute day)");
    expect(names("US", 2028)).toContain("2028-01-01 New Year's Day");
  });

  it("Nigeria: Children's Day, Workers' Day, Democracy Day and Independence Day", () => {
    expect(names("NG", 2026)).toEqual(
      expect.arrayContaining([
        "2026-05-01 Worker's Day",
        "2026-05-27 Children's Day",
        "2026-06-12 Democracy Day",
        "2026-10-01 Independence Day",
      ]),
    );
  });

  it("South Korea: Children's Day; a substitute holiday is not a second reminder", () => {
    const kr = names("KR", 2026);
    expect(kr).toContain("2026-05-05 Children's Day");
    expect(kr).toContain("2026-08-15 Liberation Day");
    expect(kr.filter((n) => n.includes("Liberation Day"))).toHaveLength(1);
  });

  it("a holiday spanning two days (Brazil's Carnival) is reminded once, on its first day", () => {
    expect(names("BR", 2026).filter((n) => n.includes("Carnival"))).toEqual(["2026-02-16 Carnival"]);
  });

  it("several holidays on one day are all returned", () => {
    const sameDay = holidaysOn("NG", { year: 2026, month: 5, day: 27 }).map((h) => h.englishName);
    expect(sameDay).toContain("Children's Day");
    expect(sameDay.length).toBeGreaterThanOrEqual(2);
  });

  it("selectHolidays keeps public and bank holidays and notable observances only", () => {
    const picked = selectHolidays(
      [
        { date: "2026-01-01 00:00:00", name: "New Year's Day", type: "public", rule: "01-01" },
        { date: "2026-01-02 00:00:00", name: "Bank Day", type: "bank", rule: "01-02" },
        { date: "2026-01-03 00:00:00", name: "Valentine's Day", type: "observance", rule: "02-14" },
        { date: "2026-01-04 00:00:00", name: "Mother's Day", type: "observance", rule: "x" },
        { date: "2026-01-05 00:00:00", name: "Christmas Eve", type: "optional", rule: "12-24" },
        { date: "2026-01-06 00:00:00", name: "School Day", type: "school", rule: "y" },
        { date: "2026-01-07 00:00:00", name: "New Year's Day (substitute day)", type: "public", rule: "z", substitute: true },
      ],
      "ZZ",
    );
    expect(picked.map((h) => h.key)).toEqual(["ZZ:new-year-s-day", "ZZ:bank-day", "ZZ:mother-s-day"]);
    expect(picked[0].date).toBe("2026-01-01");
  });

  it("slugs any script into a key fragment", () => {
    expect(holidaySlug("Independence Day")).toBe("independence-day");
    expect(holidaySlug("Día de la Independencia")).toBe("dia-de-la-independencia");
    expect(holidaySlug("عيد الفطر")).toBe("عيد-الفطر");
    expect(holidaySlug("!!!")).toBe("holiday");
  });
});

describe("dueHolidays: the recipient's own local date, from 08:00", () => {
  it("Lagos (UTC+1, no DST): due from 08:00 on October 1", () => {
    expect(HOLIDAY_REMINDER_HOUR).toBe(8);
    expect(dueNames("Nigeria", "Africa/Lagos", "2026-10-01T06:59:00Z")).toBeNull();
    expect(dueNames("Nigeria", "Africa/Lagos", "2026-10-01T07:00:00Z")).toEqual(["Independence Day"]);
    // Still due late that evening (a missed run only delays it), not the next day.
    expect(dueNames("Nigeria", "Africa/Lagos", "2026-10-01T22:30:00Z")).toEqual(["Independence Day"]);
    expect(dueNames("Nigeria", "Africa/Lagos", "2026-10-01T23:30:00Z")).toBeNull();
  });

  it("New York: 08:00 is 12:00 UTC in summer (EDT) and 13:00 UTC in winter (EST)", () => {
    expect(dueNames("United States", "America/New_York", "2026-05-25T11:59:00Z")).toBeNull();
    expect(dueNames("United States", "America/New_York", "2026-05-25T12:00:00Z")).toEqual(["Memorial Day"]);
    expect(dueNames("United States", "America/New_York", "2026-11-11T12:59:00Z")).toBeNull();
    expect(dueNames("United States", "America/New_York", "2026-11-11T13:00:00Z")).toEqual(["Veterans Day"]);
  });

  it("uses the recipient's time zone, not the country's: an American in Tokyo hears of July 4 on Tokyo's July 4", () => {
    expect(dueNames("United States", "Asia/Tokyo", "2026-07-03T23:00:00Z")).toEqual(["Independence Day"]);
    expect(dueNames("United States", "America/Los_Angeles", "2026-07-03T23:00:00Z")).toBeNull();
    expect(dueNames("United States", "America/Los_Angeles", "2026-07-04T15:00:00Z")).toEqual(["Independence Day"]);
  });

  it("no (or an unknown) time zone reads as UTC", () => {
    expect(dueNames("United Kingdom", null, "2026-12-25T08:00:00Z")).toEqual(["Christmas Day"]);
    expect(dueNames("United Kingdom", "Not/AZone", "2026-12-25T07:59:00Z")).toBeNull();
  });

  it("nothing for an ordinary day, an unknown country, 'Other / Not listed' or no country", () => {
    expect(dueNames("Nigeria", "Africa/Lagos", "2026-10-02T12:00:00Z")).toBeNull();
    expect(dueNames("Other / Not listed", "UTC", "2026-12-25T12:00:00Z")).toBeNull();
    expect(dueNames("Atlantis", "UTC", "2026-12-25T12:00:00Z")).toBeNull();
    expect(dueHolidays(null, "UTC", new Date("2026-12-25T12:00:00Z"))).toBeNull();
  });

  it("returns the code and the local date", () => {
    expect(dueHolidays("South Korea", "Asia/Seoul", new Date("2026-05-05T00:00:00Z"))).toMatchObject({
      cc: "KR",
      date: { year: 2026, month: 5, day: 5 },
    });
  });
});

describe("names in the reader's language", () => {
  const one = (cc: string, iso: string, name: string) => holidaysOf(cc, iso).find((h) => h.englishName === name)!;
  const holidaysOf = (cc: string, iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return holidaysOn(cc, { year: y, month: m, day: d });
  };

  it("uses the dataset's translation", () => {
    expect(holidayName("BR", one("BR", "2026-09-07", "Independence Day"), "pt")).toBe("Dia da Independência");
    expect(holidayName("MX", one("MX", "2026-09-16", "Independence Day"), "es")).toBe("Día de la Independencia");
    expect(holidayName("US", one("US", "2026-07-04", "Independence Day"), "en")).toBe("Independence Day");
  });

  it("falls back to English rather than the country's own language", () => {
    const name = holidayName("KR", one("KR", "2026-05-05", "Children's Day"), "es");
    expect(name).not.toMatch(/[가-힯]/);
  });

  it("names the country, with 'the' where English needs it", () => {
    expect(holidayCountryLabel("United States", "en")).toBe("the United States");
    expect(holidayCountryLabel("Nigeria", "en")).toBe("Nigeria");
    expect(holidayCountryLabel("United States", "es")).toBe("Estados Unidos");
  });
});

describe("the bell row and the push", () => {
  it("round-trips the holiday notice and words it", () => {
    const notice = { kind: "holiday" as const, holiday: "Independence Day", country: "Nigeria" };
    const encoded = encodeNotice(notice);
    expect(decodeNotice(encoded)).toEqual(notice);
    expect(noticeText(notice, pagesEn.notifications.notices, ", ")).toBe("Today is Independence Day in Nigeria");
    expect(decodeNotice('holiday:["only one"]')).toBeNull();
    expect(decodeNotice("holiday:not json")).toBeNull();
    // A name can hold the separators other notices use.
    const odd = { kind: "holiday" as const, holiday: 'A: "B", C', country: "D" };
    expect(decodeNotice(encodeNotice(odd))).toEqual(odd);
  });

  it("one holiday: its name over the sentence; several: one push listing them", () => {
    expect(holidayPush(["Independence Day"], "Nigeria", "en")).toEqual({
      title: "Independence Day",
      body: "Today is Independence Day in Nigeria",
    });
    expect(holidayPush(["Children's Day", "Id el Kabir"], "Nigeria", "en")).toEqual({
      title: "Holidays today",
      body: "Today in Nigeria: Children's Day and Id el Kabir",
    });
  });
});

describe("the holiday dataset stays on the server", () => {
  const ROOT = resolve(__dirname, "../..");
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name === "generated" || name === "node_modules") continue;
        walk(full, out);
      } else if (/\.(ts|tsx|mts)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
        out.push(full);
      }
    }
    return out;
  }
  const files = walk(join(ROOT, "src")).map((f) => ({
    path: relative(ROOT, f).replace(/\\/g, "/"),
    src: readFileSync(f, "utf8"),
  }));

  it("only src/lib/holidays.ts imports date-holidays", () => {
    const importers = files.filter(({ src }) => /from\s*["']date-holidays["']|import\(\s*["']date-holidays["']/.test(src));
    expect(importers.map((f) => f.path)).toEqual(["src/lib/holidays.ts"]);
  });

  it("only server code imports the holiday modules", () => {
    const allowed = new Set([
      "src/lib/holidays-data.ts",
      "src/app/api/cron/holiday-reminders/route.ts",
      // The gift occasion engine's server half (holidaysTodayForGifts); server-only like the cron.
      "src/lib/gift-occasions-data.ts",
    ]);
    const importers = files.filter(({ src }) => /from\s*["']@\/lib\/holidays(-data)?["']|from\s*["']\.\/holidays(-data)?["']/.test(src));
    for (const f of importers) {
      expect(f.src, f.path).not.toMatch(/^\s*["']use client["']/m);
      expect(allowed.has(f.path), f.path).toBe(true);
    }
  });
});
