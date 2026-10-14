import { describe, it, expect } from "vitest";
import { providerVerifiedEmail } from "@/lib/oauth-email-verification";

describe("providerVerifiedEmail", () => {
  it("trusts Google's boolean claim", () => {
    expect(providerVerifiedEmail("google", { email: "Ana@Example.com", email_verified: true })).toBe("ana@example.com");
  });

  it("refuses Google when the claim is false, missing or a string", () => {
    expect(providerVerifiedEmail("google", { email: "ana@example.com", email_verified: false })).toBeNull();
    expect(providerVerifiedEmail("google", { email: "ana@example.com" })).toBeNull();
    expect(providerVerifiedEmail("google", { email: "ana@example.com", email_verified: "true" })).toBeNull();
  });

  it("trusts Apple's claim as a boolean or the string \"true\", relay addresses included", () => {
    expect(providerVerifiedEmail("apple", { email: "x1@privaterelay.appleid.com", email_verified: "true" })).toBe(
      "x1@privaterelay.appleid.com",
    );
    expect(providerVerifiedEmail("apple", { email: "ana@example.com", email_verified: true })).toBe("ana@example.com");
    expect(providerVerifiedEmail("apple", { email: "ana@example.com", email_verified: "false" })).toBeNull();
  });

  it("never trusts another provider or a malformed profile", () => {
    expect(providerVerifiedEmail("resend", { email: "ana@example.com", email_verified: true })).toBeNull();
    expect(providerVerifiedEmail("github", { email: "ana@example.com", email_verified: true })).toBeNull();
    expect(providerVerifiedEmail(undefined, { email: "ana@example.com", email_verified: true })).toBeNull();
    expect(providerVerifiedEmail("google", null)).toBeNull();
    expect(providerVerifiedEmail("google", { email: 42, email_verified: true })).toBeNull();
    expect(providerVerifiedEmail("google", { email: "not-an-email", email_verified: true })).toBeNull();
  });
});
