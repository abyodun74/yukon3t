import { beforeEach, describe, expect, it, vi } from "vitest";

// Export my data / Delete account need proof it's the account holder, not just a live session.

const getPasswordHash = vi.fn();
const isPasswordResetRequired = vi.fn();
const verifyPassword = vi.fn();
const checkRateLimit = vi.fn();
const findUnique = vi.fn();
const verifyDeviceChallenge = vi.fn();

vi.mock("@/lib/auth-guards", () => ({
  getPasswordHash: (...a: unknown[]) => getPasswordHash(...a),
  isPasswordResetRequired: (...a: unknown[]) => isPasswordResetRequired(...a),
}));
vi.mock("@/lib/passwords", () => ({ verifyPassword: (...a: unknown[]) => verifyPassword(...a) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...a: unknown[]) => checkRateLimit(...a) }));
vi.mock("@/lib/prisma", () => ({ prisma: { securityChallenge: { findUnique: (...a: unknown[]) => findUnique(...a) } } }));
vi.mock("@/lib/device-challenge", () => ({ verifyDeviceChallenge: (...a: unknown[]) => verifyDeviceChallenge(...a) }));

const { verifyAccountReauth, accountReauthMethod } = await import("@/lib/account-reauth");
const { reauthMethodFor, codeFailureToReauthError } = await import("@/lib/account-reauth-rules");

beforeEach(() => {
  vi.clearAllMocks();
  getPasswordHash.mockResolvedValue("hash");
  isPasswordResetRequired.mockResolvedValue(false);
  verifyPassword.mockResolvedValue(true);
  checkRateLimit.mockResolvedValue(true);
  findUnique.mockResolvedValue({ userId: "u1", purpose: "ACCOUNT_DELETE" });
  verifyDeviceChallenge.mockResolvedValue({ ok: true, challenge: {} });
});

describe("reauthMethodFor", () => {
  it("uses the password only when there is a trusted one", () => {
    expect(reauthMethodFor({ hasPassword: true, passwordResetRequired: false })).toBe("password");
    expect(reauthMethodFor({ hasPassword: true, passwordResetRequired: true })).toBe("email");
    expect(reauthMethodFor({ hasPassword: false, passwordResetRequired: false })).toBe("email");
  });
  it("maps code failures", () => {
    expect(codeFailureToReauthError("invalid_code")).toBe("wrong_code");
    expect(codeFailureToReauthError("expired")).toBe("code_expired");
    expect(codeFailureToReauthError("too_many_attempts")).toBe("code_expired");
  });
});

describe("verifyAccountReauth with a password", () => {
  it("refuses with no proof, without spending an attempt", async () => {
    expect(await verifyAccountReauth("u1", "delete", undefined)).toEqual({ ok: false, error: "reauth_required" });
    expect(checkRateLimit).not.toHaveBeenCalled();
  });
  it("refuses a wrong password and accepts the right one", async () => {
    verifyPassword.mockResolvedValueOnce(false);
    expect(await verifyAccountReauth("u1", "delete", { password: "nope" })).toEqual({ ok: false, error: "wrong_password" });
    expect(await verifyAccountReauth("u1", "delete", { password: "right" })).toEqual({ ok: true });
    expect(checkRateLimit).toHaveBeenCalledWith("accountReauth", "reauth:u1");
  });
  it("is rate limited", async () => {
    checkRateLimit.mockResolvedValue(false);
    expect(await verifyAccountReauth("u1", "export", { password: "right" })).toEqual({ ok: false, error: "rate_limited" });
    expect(verifyPassword).not.toHaveBeenCalled();
  });
  it("doesn't accept a code instead of the password", async () => {
    expect(await verifyAccountReauth("u1", "delete", { challengeId: "c1", code: "123456" })).toEqual({
      ok: false,
      error: "reauth_required",
    });
  });
});

describe("verifyAccountReauth with an emailed code (no usable password)", () => {
  beforeEach(() => {
    getPasswordHash.mockResolvedValue(null);
  });
  it("picks email for an account without a password, or with one that must be reset", async () => {
    expect(await accountReauthMethod("u1")).toBe("email");
    getPasswordHash.mockResolvedValue("hash");
    isPasswordResetRequired.mockResolvedValue(true);
    expect(await accountReauthMethod("u1")).toBe("email");
    // A password is not accepted then.
    expect(await verifyAccountReauth("u1", "delete", { password: "right" })).toEqual({ ok: false, error: "reauth_required" });
  });
  it("accepts a valid code for this action and consumes it", async () => {
    expect(await verifyAccountReauth("u1", "delete", { challengeId: "c1", code: "123456" })).toEqual({ ok: true });
    expect(verifyDeviceChallenge).toHaveBeenCalledWith("c1", "u1", "123456");
    expect(checkRateLimit).toHaveBeenCalledWith("deviceChallengeCheck", "devchallenge:u1");
  });
  it("refuses a code issued for the other action, or for another account, without using it up", async () => {
    expect(await verifyAccountReauth("u1", "export", { challengeId: "c1", code: "123456" })).toEqual({
      ok: false,
      error: "code_expired",
    });
    findUnique.mockResolvedValue({ userId: "someone-else", purpose: "ACCOUNT_DELETE" });
    expect(await verifyAccountReauth("u1", "delete", { challengeId: "c1", code: "123456" })).toEqual({
      ok: false,
      error: "code_expired",
    });
    expect(verifyDeviceChallenge).not.toHaveBeenCalled();
  });
  it("reports a wrong code, and refuses a malformed one", async () => {
    verifyDeviceChallenge.mockResolvedValue({ ok: false, error: "invalid_code" });
    expect(await verifyAccountReauth("u1", "delete", { challengeId: "c1", code: "000000" })).toEqual({
      ok: false,
      error: "wrong_code",
    });
    expect(await verifyAccountReauth("u1", "delete", { challengeId: "c1", code: "12ab" })).toEqual({
      ok: false,
      error: "wrong_code",
    });
  });
});
