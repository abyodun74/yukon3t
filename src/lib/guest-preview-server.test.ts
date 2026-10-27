import { afterEach, describe, expect, it, vi } from "vitest";

// The shared guest row: created once, never reused from someone else's account, and shaped so it can never be
// announced as a new member (NEW_MEMBER_JOINED), receive those alerts, or show up in Discover.
let flagged: { id: string; status: string } | null = null;
let byEmail: { id: string } | null = null;
const create = vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: args.data.isGuestPreview ? "guest-new" : "other" }));

vi.mock("next/headers", () => ({ cookies: async () => ({ set: vi.fn() }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findFirst: async () => flagged,
      findUnique: async () => byEmail,
      create: (args: { data: Record<string, unknown> }) => create(args),
    },
  },
}));

import { ensureGuestPreviewUser } from "@/lib/guest-preview-server";
import { newMemberCandidateWhere, newMemberRecipientWhere } from "@/lib/new-member-alerts";
import { GUEST_PREVIEW_EMAIL } from "@/lib/guest-preview";

afterEach(() => {
  flagged = null;
  byEmail = null;
  create.mockClear();
});

describe("ensureGuestPreviewUser", () => {
  it("reuses the existing guest row", async () => {
    flagged = { id: "guest", status: "ACTIVE" };
    expect(await ensureGuestPreviewUser()).toBe("guest");
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses a suspended guest row (an admin's way to switch guests off)", async () => {
    flagged = { id: "guest", status: "SUSPENDED" };
    expect(await ensureGuestPreviewUser()).toBeNull();
  });

  it("never repurposes someone else's account that holds the reserved address", async () => {
    byEmail = { id: "someone" };
    expect(await ensureGuestPreviewUser()).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it("creates an invisible, never-announced row the first time", async () => {
    expect(await ensureGuestPreviewUser()).toBe("guest-new");
    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      email: GUEST_PREVIEW_EMAIL,
      isGuestPreview: true,
      discoverable: false,
      postsVisibility: "HIDDEN",
      newMemberAlerts: false,
      status: "ACTIVE",
    });
    expect(data.newMemberAnnouncedAt).toBeInstanceOf(Date);
    expect(data).not.toHaveProperty("onboardedAt");
    expect(data).not.toHaveProperty("passwordHash");
    expect(data).not.toHaveProperty("username");
    expect(data.isAdmin).toBeUndefined();
  });
});

describe("NEW_MEMBER_JOINED never involves the guest identity", () => {
  it("is excluded from both the announced and the recipient queries", () => {
    const now = new Date();
    expect(newMemberCandidateWhere(now)).toMatchObject({ isGuestPreview: false, newMemberAnnouncedAt: null });
    expect(newMemberRecipientWhere(now)).toMatchObject({ isGuestPreview: false, newMemberAlerts: true });
  });
});
