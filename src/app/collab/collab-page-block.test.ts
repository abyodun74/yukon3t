import { beforeEach, describe, expect, it, vi } from "vitest";

// The collab page (app/collab/[id]/page.tsx) answers notFound() to anyone blocked either way with the collab's author,
// exactly like a collab that doesn't exist, before it loads anything else (invite, session, author, polls, chat);
// participants, invitees and site admins included. Without a block (and for the author) it carries on as before.

const AUTHOR = "cau00000000001";
const ME = "cme00000000001";
const COLLAB = "ccol0000000001";

let me = { id: ME, isAdmin: false };
let blocked = false;
let participant = false;
const pastGate = vi.fn();

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/page-guards", () => ({ getOnboardedUserOrRedirect: async () => me }));
vi.mock("@/lib/i18n/server", () => ({
  getLocale: async () => "en",
  getDictionary: async () => ({ collab: { board: { by: "by {name}" } } }),
}));
vi.mock("@/lib/blocks", () => ({
  isBlockedEitherWay: async (a: string, b: string) => blocked && [a, b].includes(AUTHOR) && [a, b].includes(ME),
}));
// The first thing the page loads after its gates: reaching it means the viewer got past the 404.
vi.mock("@/lib/engagement-status", () => ({
  getAuthorEngagementStatus: async () => {
    pastGate();
    throw new Error("PAST_GATE");
  },
  engagementStatusFor: vi.fn(),
}));
vi.mock("@/lib/collab-permissions", async (orig) => ({
  ...(await orig<typeof import("@/lib/collab-permissions")>()),
  hasLiveCollabSession: async () => false,
}));
vi.mock("@/lib/collab-invites-server", () => ({
  loadStandingCollabInvite: async () => null,
  loadCollabInvitesForAdmins: async () => [],
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    collabBoardPost: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === COLLAB
          ? {
              id: COLLAB,
              authorId: AUTHOR,
              visibility: "PUBLIC",
              status: "OPEN",
              author: { id: AUTHOR },
              participants: participant ? [{ userId: me.id, role: "PARTICIPANT" }] : [],
              _count: { participants: 2 },
            }
          : null,
    },
  },
}));

const { default: CollabDetailPage } = await import("@/app/collab/[id]/page");
const open = (id = COLLAB) => CollabDetailPage({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  me = { id: ME, isAdmin: false };
  blocked = false;
  participant = false;
});

describe("the collab page and blocks", () => {
  it("404s a blocked viewer exactly like a missing collab, before loading anything else", async () => {
    await expect(open("cnope000000001")).rejects.toThrow("NOT_FOUND");
    blocked = true;
    await expect(open()).rejects.toThrow("NOT_FOUND");
    expect(pastGate).not.toHaveBeenCalled();
  });

  it("404s a blocked participant and a blocked site admin too", async () => {
    blocked = true;
    participant = true;
    await expect(open()).rejects.toThrow("NOT_FOUND");
    me = { id: ME, isAdmin: true };
    await expect(open()).rejects.toThrow("NOT_FOUND");
    expect(pastGate).not.toHaveBeenCalled();
  });

  it("opens as before without a block, and always for the author", async () => {
    await expect(open()).rejects.toThrow("PAST_GATE");
    blocked = true;
    me = { id: AUTHOR, isAdmin: false };
    await expect(open()).rejects.toThrow("PAST_GATE");
    expect(pastGate).toHaveBeenCalledTimes(2);
  });
});
