import { beforeEach, describe, expect, it, vi } from "vitest";

// Settings -> Privacy -> Birthday (updateBirthdaySharing): on by default, Off (NONE) is an explicit choice that is
// always accepted, and any save clears a pending default-on notice.
const requireUser = vi.fn();
const userUpdate = vi.fn();
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT ${url}`);
});

vi.mock("@/lib/auth-guards", () => ({ requireUser: () => requireUser(), requireVerifiedUser: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { update: (...a: unknown[]) => userUpdate(...a) } } }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/birthday-wish-server", () => ({ sendBirthdayWishAs: vi.fn() }));
vi.mock("@/lib/i18n/server", () => ({ getDictionary: vi.fn() }));

import { updateBirthdaySharing } from "./birthdays";

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

  it("refuses anything that isn't a choice, including the old OFF value", async () => {
    requireUser.mockResolvedValue(adult);
    expect(await save("OFF")).toBe("REDIRECT /settings?error=other");
    expect(await save("")).toBe("REDIRECT /settings?error=other");
    expect(userUpdate).not.toHaveBeenCalled();
  });
});
