import { describe, expect, it, vi } from "vitest";

// getCollabSessionParticipants used to answer for any collab id; it now asks viewerCanSeeCollab (the collab page's own
// canViewCollab gate), so a PRIVATE collab's live-session list stays with its author, participants, standing invitees
// and site admins.

const AUTHOR = "cau00000000001";
const PARTICIPANT = "cpa00000000001";
const INVITEE = "cin00000000001";
const OUTSIDER = "cou00000000001";
const collabs: Record<string, { id: string; authorId: string; visibility: string }> = {
  pub: { id: "pub", authorId: AUTHOR, visibility: "PUBLIC" },
  priv: { id: "priv", authorId: AUTHOR, visibility: "PRIVATE" },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    collabBoardPost: { findUnique: async ({ where }: { where: { id: string } }) => collabs[where.id] ?? null },
    collabParticipant: {
      findUnique: async ({ where }: { where: { userId_collabId: { userId: string } } }) =>
        where.userId_collabId.userId === PARTICIPANT ? { id: "p" } : null,
    },
    collabInvite: {
      findFirst: async ({ where }: { where: { inviteeId: string } }) =>
        where.inviteeId === INVITEE ? { id: "i", inviter: { id: AUTHOR, name: "A", status: "ACTIVE" } } : null,
    },
  },
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/hidden-chats", () => ({ getHiddenPeerIds: vi.fn() }));
vi.mock("@/lib/blocks", () => ({ getBlockedEitherWayIds: vi.fn() }));
vi.mock("@/lib/collab-invite", async (orig) => ({
  ...(await orig<typeof import("@/lib/collab-invite")>()),
  collabInviteStillStands: () => true,
}));

const { viewerCanSeeCollab } = await import("@/lib/collab-invites-server");

describe("viewerCanSeeCollab", () => {
  const as = (id: string, isAdmin = false) => ({ id, isAdmin });

  it("lets anyone see a PUBLIC collab", async () => {
    expect(await viewerCanSeeCollab("pub", as(OUTSIDER))).toBe(true);
  });

  it("limits a PRIVATE one to its author, participants, standing invitees and site admins", async () => {
    expect(await viewerCanSeeCollab("priv", as(AUTHOR))).toBe(true);
    expect(await viewerCanSeeCollab("priv", as(PARTICIPANT))).toBe(true);
    expect(await viewerCanSeeCollab("priv", as(INVITEE))).toBe(true);
    expect(await viewerCanSeeCollab("priv", as(OUTSIDER, true))).toBe(true);
    expect(await viewerCanSeeCollab("priv", as(OUTSIDER))).toBe(false);
  });

  it("answers false for a missing or malformed id", async () => {
    expect(await viewerCanSeeCollab("missing", as(AUTHOR))).toBe(false);
    expect(await viewerCanSeeCollab(42, as(AUTHOR))).toBe(false);
  });
});
