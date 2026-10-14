import { describe, expect, it } from "vitest";
import { localeToRecord } from "@/lib/user-locale-rules";

describe("localeToRecord", () => {
  it("writes an explicit choice whenever it differs from what is stored", () => {
    expect(localeToRecord(null, "ar", "en-US")).toBe("ar");
    expect(localeToRecord("en", "ar", null)).toBe("ar");
    expect(localeToRecord("fr", "es", "fr")).toBe("es");
  });

  it("writes nothing when the explicit choice is already stored", () => {
    expect(localeToRecord("ar", "ar", "en")).toBeNull();
  });

  it("fills an empty account from the device's language", () => {
    expect(localeToRecord(null, undefined, "pt-BR,pt;q=0.9")).toBe("pt");
    expect(localeToRecord(undefined, null, null)).toBe("en");
    expect(localeToRecord("de", undefined, "es")).toBe("es");
  });

  it("never lets a device's implied language overwrite a stored one", () => {
    expect(localeToRecord("ar", undefined, "en-US")).toBeNull();
    expect(localeToRecord("es", "not-a-locale", "fr")).toBeNull();
  });
});
