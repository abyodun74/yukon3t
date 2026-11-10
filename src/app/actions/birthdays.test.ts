import { beforeEach, describe, expect, it, vi } from "vitest";

// Settings -> Privacy -> Birthday (updateBirthdaySharing): on by default, Off (NONE) is an explicit choice that is
// always accepted, and any save clears a pending default-on notice.
const requireUser = vi.fn();
const userUpdate = vi.fn();
const userUpdateMany = vi.fn();
const checkRateLimit = vi.fn();
const revalidatePath = vi.fn();
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT ${url}`);
});

vi.mock("@/lib/auth-guards", () => ({ requireUser: () => requireUser(), requireVerifiedUser: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      update: (...a: unknown[]) => userUpdate(...a),
      updateMany: (...a: unknown[]) => userUpdateMany(...a),
    },
  },
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...a: unknown[]) => checkRateLimit(...a) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePath(path) }));
vi.mock("@/lib/birthday-wish-server", () => ({ sendBirthdayWishAs: vi.fn() }));
vi.mock("@/lib/i18n/server", () => ({ getDictionary: vi.fn() }));

import { setBirthDateOnce, updateBirthdaySharing } from "./birthdays";

const adult = { id: "u1", birthDate: new Date("1990-03-03T00:00:00.000Z"), birthdayAudience: "BOTH" };
const minor = { id: "u2", birthDate: new Date("2012-03-03T00:00:00.000Z"), birthdayAudience: "BOTH" };

function form(audience: string) {
  const data = new FormData();
  data.set("audience", audience);
  return data;
}

async function save(audience: string) {
  return updateBirthdaySharing(form(audience)).catch((err: Error) => err.message);
}

describe("updateBirthdaySharing", () => {
  beforeEach(() => {
    requireUser.mockReset();
    userUpdate.mockReset();
    userUpdate.mockResolvedValue({ id: "u" });
    redirect.mockClear();
    revalidatePath.mockClear();
  });

  it("records Off as an explicit NONE and clears the pending notice", async () => {
    requireUser.mockResolvedValue(adult);
    expect(await save("NONE")).toBe("REDIRECT /settings?saved=1");
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { birthdayAudience: "NONE", birthdaySharingNoticePending: false },
      select: { id: true },
    });
  });

  it("lets an adult pick any audience", async () => {
    requireUser.mockResolvedValue(adult);
    for (const audience of ["CONNECTIONS", "CIRCLES", "BOTH"]) {
      expect(await save(audience)).toBe("REDIRECT /settings?saved=1");
    }
    expect(userUpdate).toHaveBeenCalledTimes(3);
  });

  it("lets an under-18 account turn it off, or keep the default, but not pick a new way of sharing", async () => {
    requireUser.mockResolvedValue(minor);
    expect(await save("NONE")).toBe("REDIRECT /settings?saved=1");
    expect(await save("BOTH")).toBe("REDIRECT /settings?saved=1");
    expect(await save("CONNECTIONS")).toBe("REDIRECT /settings?error=birthday_unavailable");
    expect(userUpdate).toHaveBeenCalledTimes(2);
  });

  it("lets an adult who turned it off turn it back on, with any audience, without owing a notice", async () => {
    for (const audience of ["BOTH", "CONNECTIONS", "CIRCLES"]) {
      requireUser.mockResolvedValue({ ...adult, birthdayAudience: "NONE" });
      expect(await save(audience)).toBe("REDIRECT /settings?saved=1");
      // Turning it back on is a choice made in Settings: the one-time "now shared" notice is never (re)queued.
      expect(userUpdate).toHaveBeenLastCalledWith({
        where: { id: "u1" },
        data: { birthdayAudience: audience, birthdaySharingNoticePending: false },
        select: { id: true },
      });
    }
    expect(revalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("explains, rather than saves, an under-18 account turning it back on after turning it off", async () => {
    requireUser.mockResolvedValue({ ...minor, birthdayAudience: "NONE" });
    for (const audience of ["BOTH", "CONNECTIONS", "CIRCLES"]) {
      expect(await save(audience)).toBe("REDIRECT /settings?error=birthday_unavailable");
    }
    // Keeping it off is still fine.
    expect(await save("NONE")).toBe("REDIRECT /settings?saved=1");
    expect(userUpdate).toHaveBeenCalledTimes(1);
  });

  it("refuses an account with no birth date turning it back on", async () => {
    requireUser.mockResolvedValue({ id: "u3", birthDate: null, birthdayAudience: "NONE" });
    expect(await save("BOTH")).toBe("REDIRECT /settings?error=birthday_unavailable");
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("refuses anything that isn't a choice, including the old OFF value", async () => {
    requireUser.mockResolvedValue(adult);
    expect(await save("OFF")).toBe("REDIRECT /settings?error=other");
    expect(await save("")).toBe("REDIRECT /settings?error=other");
    expect(userUpdate).not.toHaveBeenCalled();
  });
});

// Settings -> Privacy -> Birthday, "Add your date of birth": only for an account with none, only once, sign-up's age rules.
describe("setBirthDateOnce", () => {
  const thisYear = new Date().getFullYear();
  const ADULT = `${thisYear - 30}-06-15`;
  const MINOR = `${thisYear - 17}-01-01`;
  const noBirthDate = { id: "u9", birthDate: null, birthdayAudience: "BOTH" };

  function birthDateForm(birthDate: string | null, confirm = true) {
    const data = new FormData();
    if (birthDate !== null) data.set("birthDate", birthDate);
    if (confirm) data.set("confirm", "on");
    return data;
  }

  async function add(birthDate: string | null, confirm = true) {
    return setBirthDateOnce(birthDateForm(birthDate, confirm)).catch((err: Error) => err.message);
  }

  beforeEach(() => {
    requireUser.mockReset();
    requireUser.mockResolvedValue(noBirthDate);
    userUpdate.mockReset();
    userUpdateMany.mockReset();
    userUpdateMany.mockResolvedValue({ count: 1 });
    checkRateLimit.mockReset();
    checkRateLimit.mockResolvedValue(true);
    revalidatePath.mockClear();
  });

  it("records an adult's birth date, only where none is stored, keeps the sharing choice and queues no notice", async () => {
    expect(await add(ADULT)).toBe("REDIRECT /settings?saved=1");
    expect(userUpdateMany).toHaveBeenCalledWith({
      where: { id: "u9", birthDate: null },
      data: { birthDate: new Date(`${ADULT}T00:00:00.000Z`), birthdaySharingNoticePending: false },
    });
    expect(userUpdateMany.mock.calls[0][0].data).not.toHaveProperty("birthdayAudience");
    expect(revalidatePath).toHaveBeenCalledWith("/settings");
    expect(checkRateLimit).toHaveBeenCalledWith("birthDateSet", "u9");
  });

  it("owes an under-18 account (still sharing by default) the notice for when it turns 18", async () => {
    expect(await add(MINOR)).toBe("REDIRECT /settings?saved=1");
    expect(userUpdateMany.mock.calls[0][0].data).toEqual({
      birthDate: new Date(`${MINOR}T00:00:00.000Z`),
      birthdaySharingNoticePending: true,
    });
  });

  it("owes no notice to an under-18 account that turned sharing off", async () => {
    requireUser.mockResolvedValue({ ...noBirthDate, birthdayAudience: "NONE" });
    expect(await add(MINOR)).toBe("REDIRECT /settings?saved=1");
    expect(userUpdateMany.mock.calls[0][0].data.birthdaySharingNoticePending).toBe(false);
  });

  it("never changes a birth date already on the account", async () => {
    requireUser.mockResolvedValue({ ...noBirthDate, birthDate: new Date("1990-03-03T00:00:00.000Z") });
    expect(await add(ADULT)).toBe("REDIRECT /settings?error=birth_date_already_set");
    expect(userUpdateMany).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("loses a race (or a repeat) without overwriting: the guarded write finds a birth date already there", async () => {
    userUpdateMany.mockResolvedValue({ count: 0 });
    expect(await add(ADULT)).toBe("REDIRECT /settings?error=birth_date_already_set");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("applies sign-up's age rules", async () => {
    // Under MIN_AGE (16), or not born yet.
    expect(await add(`${thisYear - 10}-01-01`)).toBe("REDIRECT /settings?error=birth_date_underage");
    expect(await add(`${thisYear + 1}-01-01`)).toBe("REDIRECT /settings?error=birth_date_underage");
    // Older than the picker offers (MAX_AGE 120).
    expect(await add(`${thisYear - 121}-01-01`)).toBe("REDIRECT /settings?error=birth_date_invalid");
    expect(userUpdateMany).not.toHaveBeenCalled();
  });

  it("refuses a missing, malformed or impossible date instead of guessing one", async () => {
    for (const value of [null, "", "1990-2-3", "03/03/1990", "1990-02-30", "1990-13-01", "1990-03-03T00:00:00Z"]) {
      expect(await add(value)).toBe("REDIRECT /settings?error=birth_date_invalid");
    }
    expect(userUpdateMany).not.toHaveBeenCalled();
  });

  it("needs the can't-be-changed box ticked", async () => {
    expect(await add(ADULT, false)).toBe("REDIRECT /settings?error=birth_date_confirm");
    expect(userUpdateMany).not.toHaveBeenCalled();
  });

  it("is rate-limited", async () => {
    checkRateLimit.mockResolvedValue(false);
    expect(await add(ADULT)).toBe("REDIRECT /settings?error=rate_limited");
    expect(userUpdateMany).not.toHaveBeenCalled();
  });

  it("needs a signed-in member", async () => {
    requireUser.mockRejectedValue(new Error("Unauthorized"));
    expect(await add(ADULT)).toBe("Unauthorized");
    expect(userUpdateMany).not.toHaveBeenCalled();
  });
});
