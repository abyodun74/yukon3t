import { describe, it, expect } from "vitest";
import { isOldEnough, MIN_AGE, usernameSchema, signUpSchema, phoneSchema } from "@/lib/validations";

describe("isOldEnough", () => {
  it("accepts someone whose birthday already passed this year at the minimum age", () => {
    const now = new Date();
    const exactlyMinAge = new Date(now.getFullYear() - MIN_AGE, now.getMonth(), now.getDate());
    expect(isOldEnough(exactlyMinAge)).toBe(true);
  });

  it("rejects someone one day short of the minimum age", () => {
    const now = new Date();
    const oneDayShort = new Date(now.getFullYear() - MIN_AGE, now.getMonth(), now.getDate() + 1);
    expect(isOldEnough(oneDayShort)).toBe(false);
  });

  it("rejects someone born last year (well under the minimum age)", () => {
    const now = new Date();
    expect(isOldEnough(new Date(now.getFullYear() - 1, 0, 1))).toBe(false);
  });
});

describe("usernameSchema", () => {
  it("accepts a normal alphanumeric username", () => {
    expect(usernameSchema.safeParse("jane_doe123").success).toBe(true);
  });

  it("rejects usernames shorter than 3 characters", () => {
    expect(usernameSchema.safeParse("ab").success).toBe(false);
  });

  it("rejects usernames with spaces or symbols outside the allowed set", () => {
    expect(usernameSchema.safeParse("jane doe").success).toBe(false);
    expect(usernameSchema.safeParse("jane@doe").success).toBe(false);
  });
});

describe("signUpSchema", () => {
  const validBase = {
    username: "jane_doe",
    email: "jane@example.com",
    password: "correct horse battery staple",
    verificationMethod: "EMAIL" as const,
  };

  it("accepts a well-formed signup for someone old enough", () => {
    const birthDate = new Date();
    birthDate.setFullYear(birthDate.getFullYear() - (MIN_AGE + 5));
    const result = signUpSchema.safeParse({ ...validBase, birthDate });
    expect(result.success).toBe(true);
  });

  it("rejects a signup from someone under the minimum age", () => {
    const birthDate = new Date();
    birthDate.setFullYear(birthDate.getFullYear() - (MIN_AGE - 1));
    const result = signUpSchema.safeParse({ ...validBase, birthDate });
    expect(result.success).toBe(false);
  });

  it("lowercases and trims the email", () => {
    const birthDate = new Date();
    birthDate.setFullYear(birthDate.getFullYear() - (MIN_AGE + 5));
    const result = signUpSchema.safeParse({ ...validBase, email: "  Jane@Example.COM  ", birthDate });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe("jane@example.com");
  });

  it("accepts PHONE as the verification method", () => {
    const birthDate = new Date();
    birthDate.setFullYear(birthDate.getFullYear() - (MIN_AGE + 5));
    const result = signUpSchema.safeParse({ ...validBase, birthDate, verificationMethod: "PHONE", phone: "+14155551234" });
    expect(result.success).toBe(true);
  });

  it("rejects an unrecognized verification method", () => {
    const birthDate = new Date();
    birthDate.setFullYear(birthDate.getFullYear() - (MIN_AGE + 5));
    const result = signUpSchema.safeParse({ ...validBase, birthDate, verificationMethod: "FAX" });
    expect(result.success).toBe(false);
  });
});

describe("phoneSchema", () => {
  it("accepts a well-formed E.164 number", () => {
    expect(phoneSchema.safeParse("+14155551234").success).toBe(true);
  });

  it("rejects a number missing the leading +", () => {
    expect(phoneSchema.safeParse("14155551234").success).toBe(false);
  });

  it("rejects a number starting with a 0 country code digit", () => {
    expect(phoneSchema.safeParse("+0123456789").success).toBe(false);
  });

  it("rejects non-digit characters", () => {
    expect(phoneSchema.safeParse("+1 415 555 1234").success).toBe(false);
    expect(phoneSchema.safeParse("+1-415-555-1234").success).toBe(false);
  });

  it("trims surrounding whitespace before validating", () => {
    expect(phoneSchema.safeParse("  +14155551234  ").success).toBe(true);
  });
});

describe("signUpSchema — username and phone", () => {
  const base = { username: "Bola_99", email: "Bola@Example.com", password: "longenough1", birthDate: "1990-05-05", verificationMethod: "EMAIL" as const };

  it("accepts a username, email, password and birth date for email verification", () => {
    const r = signUpSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.email).toBe("bola@example.com");
  });

  it("requires a valid phone number only when verifying by phone", () => {
    expect(signUpSchema.safeParse({ ...base, verificationMethod: "PHONE" }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...base, verificationMethod: "PHONE", phone: "4155551234" }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...base, verificationMethod: "PHONE", phone: "+14155551234" }).success).toBe(true);
    // a stray phone value is ignored for email verification
    expect(signUpSchema.safeParse({ ...base, phone: "" }).success).toBe(true);
  });

  it("rejects bad usernames: too short/long, illegal characters, reserved names", () => {
    for (const username of ["ab", "a".repeat(21), "has space", "bad-dash", "émile", "admin", "Support", "YuKon3t"]) {
      expect(signUpSchema.safeParse({ ...base, username }).success, username).toBe(false);
    }
  });

  it("rejects an under-13 birth date", () => {
    const year = new Date().getFullYear() - 10;
    expect(signUpSchema.safeParse({ ...base, birthDate: `${year}-01-01` }).success).toBe(false);
  });
});
