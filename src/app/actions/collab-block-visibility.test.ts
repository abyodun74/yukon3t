import { beforeEach, describe, expect, it, vi } from "vitest";

// A collab whose author is blocked either way with the viewer doesn't exist for them (lib/collab-visibility.ts):
// joining, requesting, answering an invite, inviting, managing, the session, recordings, polls and the calendar file all
// answer exactly like a missing collab, participants and invitees included, and no participation / invite / request
// row is touched. Nothing changes without a block, and the author is never affected.

const AUTHOR = "cau00000000001";
const COADMIN = "cmo00000000001";
const ME = "cme00000000001";
const FRIEND = "cfr00000000001";
const COLLAB = "ccol0000000001";
const PRIVATE_COLLAB = "cpri0000000001";
const INVITE = "cinv0000000001";
const REQUEST = "creq0000000001";

let currentUser: { id: string; name: string; isAdmin: boolean } = { id: ME, name: "Me", isAdmin: false };
/** Unordered pairs blocked either way, as "a|b" with a < b. */
let blocks = new Set<string>();
const pair = (a: string, b: string) => [a, b].sort().join("|");
const block = (a: string, b: string) => blocks.add(pair(a, b));
/** userId -> role, for the PUBLIC and the PRIVATE collab alike. */
let participants: Record<string, string> = {};

const writes = {
  joinRequestCreate: vi.fn(),
  joinRequestUpdate: vi.fn(),
  participantUpsert: vi.fn(),
  participantUpdate: vi.fn(),
  participantDelete: vi.fn(),
  inviteUpdateMany: vi.fn(async () => ({ count: 1 })),
  inviteDeleteMany: vi.fn(async () => ({ count: 1 })),
  inviteCreate: vi.fn(async () => [] as { inviteeId: string }[]),
  notificationCreate: vi.fn(),
  sessionUpsert: vi.fn(),
  pollFindMany: vi.fn(async () => []),
};

function collabRow(id: string) {
  if (id !== COLLAB && id !== PRIVATE_COLLAB) return null;
  return {
    id,
    authorId: AUTHOR,
    title: "Spanish exchange",
    description: "Practice together",
    visibility: id === COLLAB ? "PUBLIC" : "PRIVATE",
    status: "OPEN",
    conversationId: null,
    roomName: "room",
    roomUrl: "https://x.daily.co/room",
    nextSessionAt: new Date(Date.now() + 86_400_000),
    oneOffSessions: [],
    participants: Object.entries(participants)
      .filter(([, role]) => role === "MODERATOR")
      .map(([userId]) => ({ userId })),
  };
}

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/lib/auth-guards", () => {
  class AuthError extends Error {}
  return {
    AuthError,
    requireVerifiedUser: async () => currentUser,
    requireVerifiedViewer: async () => currentUser,
    requireUser: async () => currentUser,
    viewerRateLimitKey: async () => currentUser.id,
  };
});
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true }));
vi.mock("@/lib/moderation", () => ({ moderateText: async () => ({ allowed: true }) }));
vi.mock("@/lib/embeddings", () => ({ updateCollabEmbedding: vi.fn() }));
vi.mock("@/lib/notify-subscribers", () => ({ notifySubscribers: vi.fn() }));
vi.mock("@/lib/notify-push", () => ({ pushActivityNotificationToMany: vi.fn() }));
vi.mock("@/lib/realtime-server", () => ({
  publishEvent: vi.fn(),
  publishEvents: vi.fn(),
  notifyBadgeChange: vi.fn(),
}));
vi.mock("@/lib/error-tracking", () => ({ captureError: vi.fn() }));
vi.mock("@/lib/feed-category", () => ({ classifyPostCategory: vi.fn() }));
vi.mock("@/lib/post-created", () => ({ afterPostCreated: vi.fn() }));
vi.mock("@/lib/hidden-chats", () => ({ getHiddenPeerIds: async () => new Set<string>() }));
vi.mock("@/lib/daily", () => ({
  isCallingConfigured: () => true,
  createCollabRoom: vi.fn(),
  createMeetingToken: async () => "token",
  listRoomRecordings: async () => [{ id: "rec", status: "finished", start_ts: 1, duration: 2 }],
  getRecordingAccessLink: async () => "https://rec",
}));
vi.mock("@/lib/blocks", () => ({
  isBlockedEitherWay: async (a: string, b: string) => blocks.has(pair(a, b)),
  isBlockedWithAny: async (a: string, ids: string[]) => ids.some((b) => blocks.has(pair(a, b))),
  getBlockedEitherWayIds: async (userId: string) => {
    const ids = new Set<string>();
    for (const p of blocks) {
      const [a, b] = p.split("|");
      if (a === userId) ids.add(b);
      if (b === userId) ids.add(a);
    }
    return ids;
  },
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    collabBoardPost: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = collabRow(where.id);
        if (!row) return null;
        // The calendar route selects the viewer's own participation.
        return { ...row, participants: participants[currentUser.id] ? [{ userId: currentUser.id }] : row.participants };
      },
    },
    collabParticipant: {
      findUnique: async ({ where }: { where: { userId_collabId: { userId: string } } }) => {
        const role = participants[where.userId_collabId.userId];
        return role ? { id: `p-${where.userId_collabId.userId}`, role } : null;
      },
      findMany: async () => Object.keys(participants).map((userId) => ({ userId })),
      upsert: (...a: unknown[]) => writes.participantUpsert(...a),
      update: (...a: unknown[]) => writes.participantUpdate(...a),
      updateMany: (...a: unknown[]) => writes.participantUpdate(...a),
      deleteMany: (...a: unknown[]) => writes.participantDelete(...a),
    },
    collabJoinRequest: {
      findUnique: async ({ where }: { where: { id?: string } }) =>
        where.id === REQUEST
          ? { id: REQUEST, userId: FRIEND, collabId: COLLAB, collab: collabRow(COLLAB) }
          : null,
      create: (...a: unknown[]) => writes.joinRequestCreate(...a),
      update: (...a: unknown[]) => writes.joinRequestUpdate(...a),
    },
    collabInvite: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === INVITE
          ? {
              id: INVITE,
              inviteeId: ME,
              inviterId: AUTHOR,
              collabId: PRIVATE_COLLAB,
              collab: { ...collabRow(PRIVATE_COLLAB)!, participants: [] },
            }
          : null,
      findMany: async () => [],
      findFirst: async () => null,
      updateMany: (...a: unknown[]) => writes.inviteUpdateMany(...(a as [])),
      deleteMany: (...a: unknown[]) => writes.inviteDeleteMany(...(a as [])),
      createManyAndReturn: async (args: { data: { inviteeId: string }[] }) => {
        await writes.inviteCreate();
        return args.data.map((d) => ({ inviteeId: d.inviteeId }));
      },
    },
    connection: {
      findMany: async () => [{ requesterId: currentUser.id, targetId: FRIEND, status: "ACCEPTED" }],
    },
    user: { findUnique: async ({ where }: { where: { id: string } }) => ({ id: where.id, status: "ACTIVE" }) },
    notification: {
      create: (...a: unknown[]) => writes.notificationCreate(...a),
      createMany: (...a: unknown[]) => writes.notificationCreate(...a),
      deleteMany: vi.fn(),
    },
    conversationMember: { upsert: vi.fn(), deleteMany: vi.fn() },
    collabSessionParticipant: {
      upsert: (...a: unknown[]) => writes.sessionUpsert(...a),
      findMany: async () => [{ user: { id: AUTHOR, name: "Author" } }],
    },
    poll: { findMany: (...a: unknown[]) => writes.pollFindMany(...(a as [])) },
  },
}));

const collab = await import("@/app/actions/collab");
const session = await import("@/app/actions/collab-session");
const polls = await import("@/app/actions/polls");
const { getCollabPollAccess } = await import("@/lib/polls-data");
const calendar = await import("@/app/api/collab/[id]/calendar/route");

const as = (id: string, isAdmin = false) => {
  currentUser = { id, name: id, isAdmin };
};
const noWrites = () => {
  for (const fn of Object.values(writes)) expect(fn).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.clearAllMocks();
  blocks = new Set();
  participants = { [AUTHOR]: "OWNER", [COADMIN]: "MODERATOR" };
  as(ME);
});

describe("joining and join requests", () => {
  it("answers not_found to someone blocked either way with the author, and writes nothing", async () => {
    block(ME, AUTHOR);
    expect(await collab.joinCollab(COLLAB)).toEqual({ error: "not_found" });
    noWrites();
  });

  it("treats a blocked existing participant the same (their row is kept, not touched)", async () => {
    block(AUTHOR, ME);
    participants[ME] = "PARTICIPANT";
    expect(await collab.joinCollab(COLLAB)).toEqual({ error: "not_found" });
    noWrites();
  });

  it("is unchanged without a block", async () => {
    expect(await collab.joinCollab(COLLAB)).toEqual({ error: null, requested: true });
    expect(writes.joinRequestCreate).toHaveBeenCalledTimes(1);
  });

  it("never lets an organizer approve a requester blocked either way with the author; declining still works", async () => {
    block(FRIEND, AUTHOR);
    as(AUTHOR);
    expect(await collab.respondToCollabJoinRequest(REQUEST, true)).toEqual({ error: "not_found" });
    expect(writes.participantUpsert).not.toHaveBeenCalled();
    expect(writes.joinRequestUpdate).not.toHaveBeenCalled();
    expect(await collab.respondToCollabJoinRequest(REQUEST, false)).toEqual({ error: null });
    expect(writes.participantUpsert).not.toHaveBeenCalled();
  });

  it("answers not_found to a co-admin blocked either way with the author", async () => {
    block(COADMIN, AUTHOR);
    as(COADMIN);
    expect(await collab.respondToCollabJoinRequest(REQUEST, true)).toEqual({ error: "not_found" });
    noWrites();
  });
});

describe("invites", () => {
  it("an invitee blocked either way with the author can neither accept nor decline (the invite row stays as it is)", async () => {
    block(ME, AUTHOR);
    expect(await collab.respondToCollabInvite(INVITE, true)).toEqual({ error: "not_found" });
    expect(await collab.respondToCollabInvite(INVITE, false)).toEqual({ error: "not_found" });
    noWrites();
  });

  it("accepting is unchanged without a block", async () => {
    expect(await collab.respondToCollabInvite(INVITE, true)).toEqual({ error: null });
    expect(writes.inviteUpdateMany).toHaveBeenCalledTimes(1);
    expect(writes.participantUpsert).toHaveBeenCalledTimes(1);
  });

  it("a co-admin blocked either way with the author can't invite or cancel invites", async () => {
    block(COADMIN, AUTHOR);
    as(COADMIN);
    const form = new FormData();
    form.append("inviteeIds", FRIEND);
    expect(await collab.inviteToCollab(PRIVATE_COLLAB, form)).toEqual({ error: "not_found" });
    expect(await collab.cancelCollabInvite(INVITE)).toEqual({ error: "not_found" });
    noWrites();
  });

  it("a co-admin can't invite someone blocked either way with the author (dropped like a non-connection)", async () => {
    block(FRIEND, AUTHOR);
    as(COADMIN);
    const form = new FormData();
    form.append("inviteeIds", FRIEND);
    expect(await collab.inviteToCollab(PRIVATE_COLLAB, form)).toEqual({ error: "invalid" });
    expect(writes.inviteCreate).not.toHaveBeenCalled();
  });

  it("a co-admin's invite is unchanged without a block", async () => {
    as(COADMIN);
    const form = new FormData();
    form.append("inviteeIds", FRIEND);
    expect(await collab.inviteToCollab(PRIVATE_COLLAB, form)).toMatchObject({ error: null });
    expect(writes.inviteCreate).toHaveBeenCalledTimes(1);
  });
});

describe("managing", () => {
  it("a co-admin blocked either way with the author gets not_found for every management action; the author doesn't", async () => {
    block(COADMIN, AUTHOR);
    participants[FRIEND] = "PARTICIPANT";
    as(COADMIN);
    expect(await collab.addCollabCoAdmin(COLLAB, FRIEND)).toEqual({ error: "not_found" });
    expect(await collab.removeCollabCoAdmin(COLLAB, FRIEND)).toEqual({ error: "not_found" });
    expect(await collab.removeCollabParticipant(COLLAB, FRIEND)).toEqual({ error: "not_found" });
    await expect(collab.updateCollabPost(COLLAB, new FormData())).rejects.toThrow("REDIRECT:/collab");
    noWrites();

    as(AUTHOR);
    expect(await collab.addCollabCoAdmin(COLLAB, FRIEND)).toEqual({ error: null });
  });
});

describe("the live session and recordings", () => {
  it("a participant blocked either way with the author can't join, list or download, and sees nobody in the session", async () => {
    block(ME, AUTHOR);
    participants[ME] = "PARTICIPANT";
    expect(await session.joinCollabSession(COLLAB)).toEqual({ error: "not_found" });
    expect(await session.getCollabSessionParticipants(COLLAB)).toEqual({ participants: [] });
    expect(await session.listCollabRecordings(COLLAB)).toEqual({ recordings: [] });
    expect(await session.getCollabRecordingLink(COLLAB, "rec")).toEqual({ error: "forbidden" });
    noWrites();
  });

  it("is unchanged without a block", async () => {
    participants[ME] = "PARTICIPANT";
    expect(await session.joinCollabSession(COLLAB)).toMatchObject({ error: null, token: "token" });
    expect(await session.getCollabSessionParticipants(COLLAB)).toEqual({ participants: [{ id: AUTHOR, name: "Author" }] });
    expect((await session.listCollabRecordings(COLLAB)).recordings).toHaveLength(1);
  });

  it("the author is never affected by their own blocks", async () => {
    block(AUTHOR, ME);
    as(AUTHOR);
    expect(await session.joinCollabSession(COLLAB)).toMatchObject({ error: null });
    expect(await session.getCollabSessionParticipants(COLLAB)).toEqual({ participants: [{ id: AUTHOR, name: "Author" }] });
  });
});

describe("polls", () => {
  it("give no access at all to someone blocked either way with the author, participants and site admins included", async () => {
    block(ME, AUTHOR);
    participants[ME] = "PARTICIPANT";
    const none = { canView: false, isMember: false, isParentAdmin: false, canCreate: false };
    expect(await getCollabPollAccess(collabRow(COLLAB)!, { id: ME, isAdmin: false })).toEqual(none);
    expect(await getCollabPollAccess(collabRow(COLLAB)!, { id: ME, isAdmin: true })).toEqual(none);
    expect(await polls.loadPolls({ collabId: COLLAB, mode: "older" })).toMatchObject({ error: "not_found" });
    const created = await polls.createPoll({
      collabId: COLLAB,
      kind: "GENERAL",
      allowMultiple: false,
      question: "When do we meet?",
      options: [{ text: "Monday" }, { text: "Tuesday" }],
    });
    expect(created).toMatchObject({ error: "not_found" });
    expect(writes.pollFindMany).not.toHaveBeenCalled();
  });

  it("are unchanged without a block", async () => {
    participants[ME] = "PARTICIPANT";
    expect(await getCollabPollAccess(collabRow(COLLAB)!, { id: ME, isAdmin: false })).toMatchObject({
      canView: true,
      isMember: true,
    });
  });
});

describe("the calendar file", () => {
  const get = (id: string) => calendar.GET(new Request(`https://yukon3t.com/api/collab/${id}/calendar`), {
    params: Promise.resolve({ id }),
  });

  it("answers 404 to a participant blocked either way with the author, like a missing collab", async () => {
    block(ME, AUTHOR);
    participants[ME] = "PARTICIPANT";
    const res = await get(COLLAB);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("serves the .ics without a block", async () => {
    participants[ME] = "PARTICIPANT";
    const res = await get(COLLAB);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/calendar");
  });
});
