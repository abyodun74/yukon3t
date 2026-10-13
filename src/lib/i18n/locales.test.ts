import { describe, it, expect } from "vitest";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  format,
  isLocale,
  localeDirection,
  localeFromRequest,
  resolveLocale,
} from "@/lib/i18n/locales";

describe("resolveLocale", () => {
  it("falls back to English with nothing to go on", () => {
    expect(DEFAULT_LOCALE).toBe("en");
    expect(resolveLocale(undefined, undefined)).toBe("en");
    expect(resolveLocale(null, null)).toBe("en");
    expect(resolveLocale("", "")).toBe("en");
  });

  it("lets a supported cookie win over the header", () => {
    expect(resolveLocale("fr", "es-MX,es;q=0.9")).toBe("fr");
    expect(resolveLocale("en", "pt-BR")).toBe("en");
    expect(resolveLocale("ar", "en-US,en;q=0.9")).toBe("ar");
  });

  it("ignores a cookie that isn't a supported language", () => {
    expect(resolveLocale("de", "es")).toBe("es");
    expect(resolveLocale("ES", "fr")).toBe("fr");
    expect(resolveLocale("pt-BR", "fr")).toBe("fr");
    expect(resolveLocale("../../etc", null)).toBe("en");
  });

  it("matches region subtags to their base language", () => {
    expect(resolveLocale(null, "pt-BR")).toBe("pt");
    expect(resolveLocale(null, "pt-PT")).toBe("pt");
    expect(resolveLocale(null, "es-419")).toBe("es");
    expect(resolveLocale(null, "fr-CA")).toBe("fr");
    expect(resolveLocale(null, "en-GB")).toBe("en");
    expect(resolveLocale(null, "ES-mx")).toBe("es");
    expect(resolveLocale(null, "ar")).toBe("ar");
    expect(resolveLocale(null, "ar-SA")).toBe("ar");
    expect(resolveLocale(null, "ar-EG,ar;q=0.9,en;q=0.8")).toBe("ar");
  });

  it("honours q-values over header order", () => {
    expect(resolveLocale(null, "en;q=0.5, fr;q=0.9")).toBe("fr");
    expect(resolveLocale(null, "de-DE,de;q=0.9,pt;q=0.8,en;q=0.7")).toBe("pt");
    expect(resolveLocale(null, "es;q=0.8,fr")).toBe("fr");
  });

  it("keeps header order between equal q-values", () => {
    expect(resolveLocale(null, "es,fr")).toBe("es");
    expect(resolveLocale(null, "fr;q=0.8,es;q=0.8")).toBe("fr");
  });

  it("skips languages it doesn't have, q=0 and malformed entries", () => {
    expect(resolveLocale(null, "de,ja;q=0.9")).toBe("en");
    expect(resolveLocale(null, "es;q=0,fr;q=0.1")).toBe("fr");
    expect(resolveLocale(null, "es;q=abc,pt;q=0.2")).toBe("pt");
    expect(resolveLocale(null, "*")).toBe("en");
    expect(resolveLocale(null, ",,;q=1,")).toBe("en");
  });
});

describe("localeFromRequest", () => {
  const request = (headers: Record<string, string>) => new Request("https://yukon3t.com/", { headers });

  it("reads the picker's cookie among others", () => {
    expect(localeFromRequest(request({ cookie: `a=1; ${LOCALE_COOKIE}=pt; b=2`, "accept-language": "fr" }))).toBe("pt");
  });

  it("falls back to Accept-Language, then English", () => {
    expect(localeFromRequest(request({ cookie: "a=1", "accept-language": "es-AR,es;q=0.9" }))).toBe("es");
    expect(localeFromRequest(request({ cookie: `${LOCALE_COOKIE}=ar`, "accept-language": "en-US" }))).toBe("ar");
    expect(localeFromRequest(request({}))).toBe("en");
  });
});

describe("isLocale", () => {
  it("accepts only the supported codes", () => {
    expect(isLocale("es")).toBe(true);
    expect(isLocale("ar")).toBe(true);
    expect(isLocale("de")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale("toString")).toBe(false);
  });
});

describe("localeDirection", () => {
  it("is right-to-left for Arabic only", () => {
    expect(localeDirection("ar")).toBe("rtl");
    for (const locale of ["en", "es", "fr", "pt"] as const) expect(localeDirection(locale)).toBe("ltr");
  });
});

describe("format", () => {
  it("fills named placeholders, every occurrence", () => {
    expect(format("{min}–{max} ({min})", { min: 3, max: 20 })).toBe("3–20 (3)");
  });

  it("leaves a placeholder with no value as written", () => {
    expect(format("Hi {name}", {})).toBe("Hi {name}");
    expect(format("Hi {toString}", {})).toBe("Hi {toString}");
  });
});
