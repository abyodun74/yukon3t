import { beforeEach, describe, expect, it, vi } from "vitest";

// Birthday sharing starts on for every new account. One that is under 18 when its birth date is first recorded is
// owed the one-time BIRTHDAY_SHARING_ON notice (User.birthdaySharingNoticePending), which the birthday-reminders cron
// sends once it turns 18: password and phone sign-up (signUpWithPassword) decide it at creation, and magic-link /
// Google / Apple accounts (created by the Auth.js adapter with no birth date) at onboarding (completeOnboarding).
const userCreate = vi.fn();
const userUpdate = vi.fn();
const userFindUnique = vi.fn();
const userFindFirst = vi.fn();
const requireUser = vi.fn();
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT ${url}`);
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      create: (...a: unknown[]) => userCreate(...a),
      update: (...a: unknown[]) => userUpdate(...a),
      findUnique: (...a: unknown[]) => userFindUnique(...a),
      findFirst: (...a: unknown[]) => userFindFirst(...a),
    },
  },
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ signOut: vi.fn() }));
vi.mock("@/lib/auth-guards", () => ({
  requireUser: () => requireUser(),
  requireAdmin: vi.fn(),
  getPasswordHash: vi.fn(),
  isPasswordResetRequired: vi.fn(),
}));
vi.mock("@/lib/bot-gate", () => ({ passesBotGate: async () => ({ ok: true }) }));
vi.mock("@/lib/bot-protection", () => ({ isBotSubmission: () => false }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true }));
vi.mock("@/lib/client-ip", () => ({ getClientIp: async () => "203.0.113.1" }));
vi.mock("@/lib/passwords", () => ({ hashPassword: async () => "hash", verifyPassword: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: async () => ({ ok: true }) }));
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/lib/pending-verification", () => ({
  issuePendingVerificationCookie: vi.fn(),
  readPendingVerification: vi.fn(),
  clearPendingVerificationCookie: vi.fn(),
}));
vi.mock("@/lib/session-token", () => ({ issueSessionCookie: vi.fn() }));
vi.mock("@/lib/user-locale", () => ({ rememberLocale: vi.fn() }));
vi.mock("@/lib/device-id", () => ({ getDeviceId: vi.fn(), getDeviceLabel: vi.fn() }));
vi.mock("@/lib/device-trust", () => ({ evaluateDevice: vi.fn(), trustDevice: vi.fn(), touchKnownDevice: vi.fn() }));
vi.mock("@/lib/device-challenge", () => ({
  createDeviceChallenge: vi.fn(),
  verifyDeviceChallenge: vi.fn(),
  issuePendingDeviceChallengeCookie: vi.fn(),
  readPendingDeviceChallengeCookie: vi.fn(),
  clearPendingDeviceChallengeCookie: vi.fn(),
}));
vi.mock("@/lib/account-media", () => ({ collectAccountMedia: vi.fn(), deleteAccountMedia: vi.fn() }));
vi.mock("@/lib/moderation", () => ({ moderateText: async () => ({ allowed: true }) }));
vi.mock("@/lib/embeddings", () => ({ updateUserEmbedding: vi.fn() }));
vi.mock("@/lib/trust", () => ({ recomputeTrustScore: vi.fn() }));
vi.mock("@/lib/hidden-chats", () => ({ getHiddenState: vi.fn(), isHiddenUnlocked: vi.fn() }));
vi.mock("@/lib/avatar-storage", () => ({ absoluteAvatarUrl: vi.fn() }));

import { signUpWithPassword } from "./password-auth";
import { completeOnboarding } from "./profile";

const thisYear = new Date().getFullYear();
// Seventeen (old enough to join at MIN_AGE 16, not yet BIRTHDAY_MIN_AGE 18) and thirty, whatever today is.
const MINOR = `${thisYear - 17}-01-01`;
const ADULT = `${thisYear - 30}-01-01`;

function signUpForm(birthDate: string, method: "EMAIL" | "PHONE" = "EMAIL") {
  const data = new FormData();
  data.set("username", "new_member");
  data.set("email", "new@example.com");
  data.set("password", "longenough1");
  data.set("birthDate", birthDate);
  data.set("verificationMethod", method);
  if (method === "PHONE") data.set("phone", "+14155551234");
  return data;
}

async function signUp(birthDate: string, method: "EMAIL" | "PHONE" = "EMAIL") {
  await signUpWithPassword({ fieldErrors: {}, formError: null }, signUpForm(birthDate, method)).catch(
    (err: Error) => err.message,
  );
  expect(userCreate).toHaveBeenCalledTimes(1);
  return userCreate.mock.calls[0][0].data as { birthdaySharingNoticePending?: boolean };
}

describe("password and phone sign-up", () => {
  beforeEach(() => {
    for (const fn of [userCreate, userUpdate, userFindUnique, userFindFirst]) fn.mockReset();
    userFindUnique.mockResolvedValue(null);
    userFindFirst.mockResolvedValue(null);
    userCreate.mockResolvedValue({ id: "new" });
    userUpdate.mockResolvedValue({ id: "new" });
  });

  it("owes an under-18 account the notice", async () => {
    expect((await signUp(MINOR)).birthdaySharingNoticePending).toBe(true);
  });

  it("owes it on the phone path too", async () => {
    expect((await signUp(MINOR, "PHONE")).birthdaySharingNoticePending).toBe(true);
  });

  it("leaves an adult account without it", async () => {
    expect((await signUp(ADULT)).birthdaySharingNoticePending).toBe(false);
    userCreate.mockClear();
    expect((await signUp(ADULT, "PHONE")).birthdaySharingNoticePending).toBe(false);
  });
});

function onboardingForm(birthDate: string) {
  const data = new FormData();
  data.set("name", "New Member");
  data.set("country", "Nigeria");
  data.append("languages", "English");
  data.append("interests", "Music");
  data.append("openToIntents", "FRIENDSHIP");
  data.set("birthDate", birthDate);
  return data;
}

async function onboard(user: Record<string, unknown>, birthDate: string) {
  requireUser.mockResolvedValue({
    id: "u1",
    name: null,
    username: null,
    onboardedAt: null,
    birthdayAudience: "BOTH",
    ...user,
  });
  expect(await completeOnboarding(onboardingForm(birthDate)).catch((err: Error) => err.message)).toBe(
    "REDIRECT /home?onboarded=1",
  );
  return userUpdate.mock.calls[0][0].data as { birthdaySharingNoticePending?: boolean };
}

describe("onboarding (magic-link, Google and Apple sign-up)", () => {
  beforeEach(() => {
    userUpdate.mockReset();
    userUpdate.mockResolvedValue({ id: "u1" });
    requireUser.mockReset();
  });

  it("owes an account created without a birth date the notice when the one recorded is under 18", async () => {
    expect((await onboard({ birthDate: null }, MINOR)).birthdaySharingNoticePending).toBe(true);
  });

  it("leaves an adult without it", async () => {
    expect(await onboard({ birthDate: null }, ADULT)).not.toHaveProperty("birthdaySharingNoticePending");
  });

  it("doesn't owe it to an account that turned sharing off before onboarding", async () => {
    expect(await onboard({ birthDate: null, birthdayAudience: "NONE" }, MINOR)).not.toHaveProperty(
      "birthdaySharingNoticePending",
    );
  });

  it("never touches the flag once a birth date is on the account (sign-up already decided, or Settings cleared it)", async () => {
    const data = await onboard({ birthDate: new Date(`${MINOR}T00:00:00.000Z`) }, MINOR);
    expect(data).not.toHaveProperty("birthdaySharingNoticePending");
  });
});
