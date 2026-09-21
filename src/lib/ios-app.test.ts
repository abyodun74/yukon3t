import { describe, expect, it } from "vitest";
import { isLikelyIosAppUserAgent } from "./ios-app";

describe("isLikelyIosAppUserAgent", () => {
  it("recognizes an iPhone WKWebView (no Safari token)", () => {
    expect(isLikelyIosAppUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148")).toBe(true);
    expect(isLikelyIosAppUserAgent("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148")).toBe(true);
  });

  it("does not match Safari or other iOS browsers", () => {
    expect(isLikelyIosAppUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBe(false);
    expect(isLikelyIosAppUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1")).toBe(false);
  });

  it("does not match desktop or Android, or a missing user agent", () => {
    expect(isLikelyIosAppUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36")).toBe(false);
    expect(isLikelyIosAppUserAgent("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36")).toBe(false);
    expect(isLikelyIosAppUserAgent(null)).toBe(false);
    expect(isLikelyIosAppUserAgent("")).toBe(false);
  });
});
