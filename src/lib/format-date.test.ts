import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatTimeAgo } from "@/lib/format-date";
import { ui as uiAr } from "@/lib/i18n/ar/ui";
import { uiEn } from "@/lib/i18n/en/ui";
import { ui as uiEs } from "@/lib/i18n/es/ui";
import { ui as uiFr } from "@/lib/i18n/fr/ui";
import { ui as uiPt } from "@/lib/i18n/pt/ui";
import type { Locale } from "@/lib/i18n/locales";

const NOW = new Date("2026-10-31T12:00:00.000Z");
const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const ago = (ms: number) => new Date(NOW.getTime() - ms);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("formatTimeAgo", () => {
  describe("English", () => {
    const en = (ms: number) => formatTimeAgo(ago(ms), "en", uiEn.time.justNow);

    it("is 'Just now' for anything under a minute", () => {
      expect(en(0)).toBe("Just now");
      expect(en(45 * SECOND)).toBe("Just now");
      expect(en(MINUTE - 1)).toBe("Just now");
    });

    it("floors to the largest whole unit at every boundary", () => {
      expect(en(MINUTE)).toBe("1 minute ago");
      expect(en(2 * MINUTE - 1)).toBe("1 minute ago");
      expect(en(2 * MINUTE)).toBe("2 minutes ago");
      expect(en(HOUR - 1)).toBe("59 minutes ago");
      expect(en(HOUR)).toBe("1 hour ago");
      expect(en(3 * HOUR - 1)).toBe("2 hours ago");
      expect(en(DAY - 1)).toBe("23 hours ago");
      expect(en(DAY)).toBe("1 day ago");
      expect(en(7 * DAY - 1)).toBe("6 days ago");
      expect(en(7 * DAY)).toBe("1 week ago");
      expect(en(30 * DAY - 1)).toBe("4 weeks ago");
      expect(en(30 * DAY)).toBe("1 month ago");
      expect(en(365 * DAY - 1)).toBe("12 months ago");
      expect(en(365 * DAY)).toBe("1 year ago");
      expect(en(3 * 365 * DAY)).toBe("3 years ago");
    });

    it("is English whatever the device's own language", () => {
      // intlLocale("en") is undefined so absolute dates follow the device; relative wording must not.
      expect(formatTimeAgo(ago(5 * MINUTE))).toBe("5 minutes ago");
    });

    it("uses the default 'Just now' when none is passed", () => {
      expect(formatTimeAgo(ago(0))).toBe(uiEn.time.justNow);
    });
  });

  describe("future timestamps (clock skew)", () => {
    it("never reads as future text", () => {
      for (const ahead of [1, 30 * SECOND, 5 * MINUTE, 2 * HOUR, 3 * DAY]) {
        expect(formatTimeAgo(new Date(NOW.getTime() + ahead), "en", "Just now")).toBe("Just now");
        expect(formatTimeAgo(new Date(NOW.getTime() + ahead), "fr", uiFr.time.justNow)).toBe(uiFr.time.justNow);
      }
    });
  });

  describe("invalid dates", () => {
    it("reads justNow instead of throwing", () => {
      for (const locale of ["en", "es", "fr", "pt", "ar"] as const) {
        expect(formatTimeAgo(new Date("not a date"), locale, "JN")).toBe("JN");
      }
    });
  });

  it("accepts an ISO string that crossed a server/client boundary as a Date-typed prop", () => {
    expect(formatTimeAgo(ago(5 * MINUTE).toISOString() as unknown as Date, "en")).toBe("5 minutes ago");
  });

  const samples: Record<Exclude<Locale, "en">, { justNow: string; expected: [number, string][] }> = {
    es: {
      justNow: uiEs.time.justNow,
      expected: [
        [90 * SECOND, "hace 1 minuto"],
        [5 * MINUTE, "hace 5 minutos"],
        [HOUR, "hace 1 hora"],
        [2 * HOUR + 40 * MINUTE, "hace 2 horas"],
        [3 * DAY, "hace 3 días"],
        [9 * DAY, "hace 1 semana"],
        [45 * DAY, "hace 1 mes"],
        [200 * DAY, "hace 6 meses"],
        [3 * 365 * DAY, "hace 3 años"],
      ],
    },
    fr: {
      justNow: uiFr.time.justNow,
      expected: [
        [90 * SECOND, "il y a 1 minute"],
        [5 * MINUTE, "il y a 5 minutes"],
        [HOUR, "il y a 1 heure"],
        [2 * HOUR + 40 * MINUTE, "il y a 2 heures"],
        [3 * DAY, "il y a 3 jours"],
        [9 * DAY, "il y a 1 semaine"],
        [45 * DAY, "il y a 1 mois"],
        [200 * DAY, "il y a 6 mois"],
        [3 * 365 * DAY, "il y a 3 ans"],
      ],
    },
    pt: {
      justNow: uiPt.time.justNow,
      expected: [
        [90 * SECOND, "há 1 minuto"],
        [5 * MINUTE, "há 5 minutos"],
        [HOUR, "há 1 hora"],
        [2 * HOUR + 40 * MINUTE, "há 2 horas"],
        [3 * DAY, "há 3 dias"],
        [9 * DAY, "há 1 semana"],
        [45 * DAY, "há 1 mês"],
        [200 * DAY, "há 6 meses"],
        [3 * 365 * DAY, "há 3 anos"],
      ],
    },
    ar: {
      justNow: uiAr.time.justNow,
      expected: [
        [90 * SECOND, "قبل دقيقة واحدة"],
        [5 * MINUTE, "قبل 5 دقائق"],
        [44 * MINUTE, "قبل 44 دقيقة"],
        [HOUR, "قبل ساعة واحدة"],
        [2 * HOUR + 40 * MINUTE, "قبل ساعتين"],
        [3 * DAY, "قبل 3 أيام"],
        [20 * DAY, "قبل أسبوعين"],
        [200 * DAY, "قبل 6 أشهر"],
        [3 * 365 * DAY, "قبل 3 سنوات"],
      ],
    },
  };

  describe.each(Object.entries(samples))("%s", (locale, { justNow, expected }) => {
    it("is its own 'just now' under a minute and in the future", () => {
      expect(formatTimeAgo(ago(30 * SECOND), locale as Locale, justNow)).toBe(justNow);
      expect(formatTimeAgo(new Date(NOW.getTime() + MINUTE), locale as Locale, justNow)).toBe(justNow);
    });

    it.each(expected)("%i ms ago reads %s", (ms, text) => {
      expect(formatTimeAgo(ago(ms), locale as Locale, justNow)).toBe(text);
    });
  });

  it("writes Arabic with Western digits, like the rest of the app", () => {
    expect(formatTimeAgo(ago(5 * MINUTE), "ar", uiAr.time.justNow)).not.toMatch(/[٠-٩]/);
    expect(formatTimeAgo(ago(5 * MINUTE), "ar", uiAr.time.justNow)).toContain("5");
  });
});
