import { describe, it, expect } from "vitest";
import { getCountries, getExampleNumber } from "libphonenumber-js/min";
import examples from "libphonenumber-js/mobile/examples";
import {
  assembleE164,
  detectInternational,
  isValidE164,
  phoneCountryFlag,
  phoneCountryOptions,
  phoneDialCode,
  resolvePhoneCountry,
  splitE164,
  validPhoneSchema,
} from "@/lib/phone-number";
import { phoneSchema } from "@/lib/validations";

describe("resolvePhoneCountry", () => {
  it("keeps a supported country, whatever its case", () => {
    expect(resolvePhoneCountry("GB")).toBe("GB");
    expect(resolvePhoneCountry(" ng ")).toBe("NG");
  });

  it("falls back to the US for a missing or unknown country", () => {
    for (const value of [null, undefined, "", "ZZ", "T1", "United States"]) {
      expect(resolvePhoneCountry(value), String(value)).toBe("US");
    }
  });
});

describe("phoneCountryOptions", () => {
  const options = phoneCountryOptions();

  it("lists every country once, with its dial code and flag", () => {
    expect(options).toHaveLength(getCountries().length);
    expect(new Set(options.map((o) => o.code)).size).toBe(options.length);
    expect(options.find((o) => o.code === "US")).toEqual({
      code: "US",
      name: "United States",
      dialCode: "1",
      flag: "\u{1F1FA}\u{1F1F8}",
    });
    expect(options.find((o) => o.code === "NG")?.dialCode).toBe("234");
    expect(phoneDialCode("GB")).toBe("44");
    expect(phoneCountryFlag("gb")).toBe("\u{1F1EC}\u{1F1E7}");
  });

  it("is sorted by name and never leaves a name empty", () => {
    const names = options.map((o) => o.name);
    expect(names.every((n) => n.length > 0)).toBe(true);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en")));
  });

  it("falls back to the country code when the locale can't be used for names", () => {
    const fallback = phoneCountryOptions("not a locale");
    expect(fallback).toHaveLength(options.length);
    expect(fallback.every((o) => o.name === o.code)).toBe(true);
  });
});

describe("assembleE164", () => {
  it("joins the country's dial code and the national number", () => {
    expect(assembleE164("US", "(415) 555-1234")).toBe("+14155551234");
    expect(assembleE164("US", "4155551234")).toBe("+14155551234");
    expect(assembleE164("NG", "803 123 4567")).toBe("+2348031234567");
  });

  it("drops a trunk prefix such as a leading 0", () => {
    expect(assembleE164("GB", "07400 123456")).toBe("+447400123456");
    expect(assembleE164("NG", "0803 123 4567")).toBe("+2348031234567");
    expect(assembleE164("RU", "8 (916) 123-45-67")).toBe("+79161234567");
  });

  it("keeps a leading 0 that is part of the number (Italy)", () => {
    expect(assembleE164("IT", "06 1234 5678")).toBe("+390612345678");
  });

  it("reads text starting with + as a full international number, whatever country is chosen", () => {
    expect(assembleE164("US", "+44 7400 123456")).toBe("+447400123456");
  });

  it("is empty when nothing usable was typed", () => {
    expect(assembleE164("US", "")).toBe("");
    expect(assembleE164("US", "   ")).toBe("");
    expect(assembleE164("US", "abc")).toBe("");
  });

  it("still hands the server something to judge when the number is wrong", () => {
    const short = assembleE164("US", "12345");
    expect(short).toBe("+112345");
    expect(isValidE164(short)).toBe(false);
    expect(assembleE164("US", "1")).toBe("+11");
  });

  it("uses the US when the country is unknown", () => {
    expect(assembleE164("ZZ", "4155551234")).toBe("+14155551234");
  });
});

describe("splitE164", () => {
  it("restores the country and the national number", () => {
    expect(splitE164("+14155551234")).toEqual({ country: "US", national: "(415) 555-1234" });
    expect(splitE164("+447400123456")).toEqual({ country: "GB", national: "07400 123456" });
    expect(splitE164("+2348031234567")).toEqual({ country: "NG", national: "0803 123 4567" });
  });

  it("tells apart countries that share a dial code", () => {
    expect(splitE164("+12465551234")?.country).toBe("BB");
    expect(splitE164("+77011234567")?.country).toBe("KZ");
    expect(splitE164("+79161234567")?.country).toBe("RU");
  });

  it("uses the preferred country when the digits can't settle a shared dial code", () => {
    expect(splitE164("+1415", "CA")).toEqual({ country: "CA", national: "415" });
    expect(splitE164("+1415", "GB")).toBeNull();
  });

  it("is null for anything that isn't an international number", () => {
    for (const value of ["", "4155551234", "+", "hello"]) expect(splitE164(value), value).toBeNull();
  });

  it("round-trips an example mobile number for every country", () => {
    for (const code of getCountries()) {
      const example = getExampleNumber(code, examples);
      if (!example) continue;
      const split = splitE164(example.number);
      expect(split, code).not.toBeNull();
      expect(assembleE164(split!.country, split!.national), code).toBe(example.number);
      // phoneSchema wants at least 8 digits, which Tristan da Cunha's and Tokelau's 7-digit numbers don't have.
      expect(isValidE164(example.number), code).toBe(code !== "TA" && code !== "TK");
    }
  });
});

describe("detectInternational", () => {
  it("takes apart a complete pasted or typed international number", () => {
    expect(detectInternational("+44 7400 123456", "US")).toEqual({ country: "GB", national: "07400 123456" });
    expect(detectInternational(" +1 (415) 555-1234", "NG")).toEqual({ country: "US", national: "(415) 555-1234" });
  });

  it("leaves alone a number still being typed and anything without a +", () => {
    for (const value of ["+", "+4", "+44 7400", "07400 123456", "4155551234", ""]) {
      expect(detectInternational(value, "US"), value).toBeNull();
    }
  });
});

describe("isValidE164 / validPhoneSchema", () => {
  it("accepts real numbers in exact E.164", () => {
    for (const value of ["+14155551234", "+447400123456", "+2348031234567"]) {
      expect(isValidE164(value), value).toBe(true);
      expect(validPhoneSchema.safeParse(value).success, value).toBe(true);
    }
  });

  it("rejects everything phoneSchema rejects", () => {
    for (const value of ["14155551234", "+0123456789", "+1 415 555 1234", "+1-415-555-1234", ""]) {
      expect(phoneSchema.safeParse(value).success, value).toBe(false);
      expect(isValidE164(value), value).toBe(false);
    }
  });

  it("rejects an E.164-shaped number that no country has", () => {
    for (const value of ["+11234567890", "+12345678", "+999123456789"]) {
      expect(phoneSchema.safeParse(value).success, value).toBe(true);
      expect(isValidE164(value), value).toBe(false);
      expect(validPhoneSchema.safeParse(value).success, value).toBe(false);
    }
  });

  it("trims like phoneSchema does", () => {
    expect(validPhoneSchema.safeParse("  +14155551234  ").data).toBe("+14155551234");
  });
});
