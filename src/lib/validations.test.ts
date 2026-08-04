import { describe, it, expect } from "vitest";
import { isOldEnough, MIN_AGE, usernameSchema, signUpSchema } from "@/lib/validations";

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
});
