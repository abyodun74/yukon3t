import { describe, it, expect } from "vitest";
import { countryFromGeoHeaders } from "@/lib/request-country";

const from = (h: Record<string, string>) => countryFromGeoHeaders((name) => h[name] ?? null);
const nfGeo = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64");

describe("countryFromGeoHeaders", () => {
  it("reads Vercel's header", () => {
    expect(from({ "x-vercel-ip-country": "NG" })).toBe("NG");
  });

  it("reads Netlify's x-country and x-nf-geo", () => {
    expect(from({ "x-country": "gb" })).toBe("GB");
    expect(from({ "x-nf-geo": nfGeo({ city: "Lagos", country: { code: "NG", name: "Nigeria" } }) })).toBe("NG");
  });

  it("is null when there is no usable country", () => {
    expect(from({})).toBeNull();
    expect(from({ "x-vercel-ip-country": "" })).toBeNull();
    expect(from({ "x-country": "Nigeria" })).toBeNull();
    expect(from({ "x-nf-geo": "not base64 json" })).toBeNull();
    expect(from({ "x-nf-geo": nfGeo({ country: {} }) })).toBeNull();
    expect(from({ "x-nf-geo": nfGeo({ country: { code: 7 } }) })).toBeNull();
  });

  it("falls through a malformed header to the next one", () => {
    expect(from({ "x-vercel-ip-country": "??", "x-country": "FR" })).toBe("FR");
  });
});
