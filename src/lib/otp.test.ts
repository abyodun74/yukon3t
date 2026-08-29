import { describe, it, expect } from "vitest";
import { generateOtpCode, hashOtpCode } from "./otp";

describe("generateOtpCode", () => {
  it("returns a 6-digit numeric string", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateOtpCode();
      expect(code).toMatch(/^\d{6}$/);
    }
  });

  it("zero-pads small values", () => {
    // Not deterministic by input, but over enough draws we should see a
    // code starting with "0" — regression guard for the padStart.
    const codes = Array.from({ length: 200 }, () => generateOtpCode());
    expect(codes.some((c) => c.startsWith("0"))).toBe(true);
  });
});

describe("hashOtpCode", () => {
  it("is deterministic for the same input", () => {
    expect(hashOtpCode("123456")).toBe(hashOtpCode("123456"));
  });

  it("differs for different inputs", () => {
    expect(hashOtpCode("123456")).not.toBe(hashOtpCode("654321"));
  });

  it("never returns the plaintext code", () => {
    expect(hashOtpCode("123456")).not.toBe("123456");
  });
});
