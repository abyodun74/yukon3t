import { beforeEach, describe, expect, it, vi } from "vitest";

// "Only the people I selected" (LiveStream.selectedOnly) enforced by the real canAccessLiveStream on every server path a
// guessed stream id could reach: the page (404), joining (no Daily token minted), the chat, the counts, recordings,
// sending a comment, Home's strip query, and Record & Post. The visibility matrix: a picked person, someone on stage,
// the host and a site admin get in; anyone else, a picked person blocked either way with the host, and a cancelled
// invitee do not. Anonymous visitors never reach any of this: every path starts with requireVerifiedUser/Viewer or the
// page's getOnboardedUserOrRedirect (sign-in redirect), mocked here as throwing.

type Stream = {
  id: string;
  hostId: string;
  circleId: string | null;
  targetUserId: string | null;
  selectedOnly: boolean;
  status: "LIVE" | "ENDED";
  roomName: string;
  roomUrl: string;
  title: string;
};
type Me = { id: string; name: string; isAdmin: boolean; lastSeenAt: Date } | null;

let stream: Stream;
let invites: { inviteeId: string; status: string; invitedById?: string }[] = [];
let seats: { userId: string; role: string }[] = [];
let blocks: [string, string][] = [];
let me: Me = null;
const createMeetingToken = vi.fn(async () => "token");
const listRoomRecordings = vi.fn(async () => [{ id: "rec1", status: "finished", start_ts: 1, duration: 5 }]);
const findMany = vi.fn(async (args: unknown) => {
  void args;
  return [];
});
const commentCreate = vi.fn(async () => ({}));
const recordingPostCreate = vi.fn(async () => ({}));

class SignInRequired extends Error {}
const requireMe = async () => {
  if (!me) throw new SignInRequired();
  return me;
};

const db = {
  liveStream: {
    findUnique: async ({ where }: { where: { id: string } }) => (where.id === stream.id ? { ...stream } : null),
    findMany: (args: unknown) => findMany(args),
  },
  liveStreamInvite: {
    findUnique: async ({ where }: { where: { liveStreamId_inviteeId: { liveStreamId: string; inviteeId: string } } }) => {
      const k = where.liveStreamId_inviteeId;
      if (k.liveStreamId !== stream.id) return null;
      const row = invites.find((i) => i.inviteeId === k.inviteeId);
      return row ? { status: row.status, invitedById: row.invitedById ?? "host" } : null;
    },
  },
  liveStreamViewer: {
    findUnique: async ({ where }: { where: { liveStreamId_userId: { liveStreamId: string; userId: string } } }) => {
      const k = where.liveStreamId_userId;
      const row = seats.find((s) => k.liveStreamId === stream.id && s.userId === k.userId);
      return row ? { role: row.role, joinedAt: new Date() } : null;
    },
    count: async () => 0,
    findMany: async () => [],
    deleteMany: async () => ({ count: 0 }),
    upsert: async () => ({}),
    groupBy: async () => [],
  },
  liveStreamStageRequest: { upsert: async () => ({}) },
  liveStreamComment: { create: () => commentCreate(), findMany: async () => [], findFirst: async () => null },
  liveStreamRecordingPost: { create: () => recordingPostCreate() },
  circle: { findUnique: async () => null },
  user: { findUnique: async () => ({ id: "host", name: "host", isAdmin: false, isGuestPreview: false }) },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ...db,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ ...db, $executeRaw: async () => 0 }),
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/auth-guards", () => ({ requireVerifiedUser: requireMe, requireVerifiedViewer: requireMe }));
vi.mock("@/lib/page-guards", () => ({ getOnboardedUserOrRedirect: requireMe }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true }));
vi.mock("@/lib/moderation", () => ({ moderateText: async () => ({ allowed: true }) }));
vi.mock("@/lib/daily", () => ({
  isCallingConfigured: () => true,
  createLiveStreamRoom: vi.fn(),
  createMeetingToken: () => createMeetingToken(),
  deleteCallRoom: vi.fn(),
  ejectFromRoom: vi.fn(),
  listRoomRecordings: () => listRoomRecordings(),
  getRecordingAccessLink: async () => "https://recording",
}));
vi.mock("@/lib/circle-permissions", () => ({ getCircleMembership: async () => null }));
vi.mock("@/lib/realtime-server", () => ({ publishEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/error-tracking", () => ({ captureError: vi.fn() }));
vi.mock("@/lib/live-stream-announce", () => ({ announceLiveStream: vi.fn() }));
vi.mock("@/lib/live-stream-invites-server", () => ({ sendLiveInvites: vi.fn(), settleLiveInvites: vi.fn() }));
vi.mock("@/lib/blocks", () => ({
  isBlockedWithAny: async (id: string, others: string[]) =>
    blocks.some(([a, b]) => (a === id && others.includes(b)) || (b === id && others.includes(a))),
  getBlockedEitherWayIds: async (id: string) =>
    new Set(blocks.flatMap(([a, b]) => (a === id ? [b] : b === id ? [a] : []))),
}));
vi.mock("@/components/live-stream-room", () => ({ LiveStreamRoom: () => null }));
vi.mock("next/link", () => ({ default: (props: { children: unknown }) => props.children }));
vi.mock("@/lib/i18n/server", () => ({
  getDictionary: async () => ({
    live: {
      backHome: "Back to Home",
      invite: { selectedGone: { cancelled: "GONE:cancelled", expired: "GONE:expired", ended: "GONE:ended" } },
    },
  }),
}));

const actions = await import("@/app/actions/live-streams");
const { default: LivePage } = await import("@/app/live/[id]/page");
const { LiveStreamRoom } = await import("@/components/live-stream-room");

const user = (id: string, isAdmin = false) => ({ id, name: id, isAdmin, lastSeenAt: new Date() });
const commentForm = () => {
  const fd = new FormData();
  fd.set("content", "hello");
  return fd;
};

/** Every gate a guessed id could reach, for the current `me`: true = let in. */
async function gates() {
  // "In" means the room itself rendered (a 404 throws; a stale-invite note renders no room).
  const page = await LivePage({ params: Promise.resolve({ id: "s1" }), searchParams: Promise.resolve({}) }).then(
    (el) => (el as { type?: unknown }).type === LiveStreamRoom,
    () => false,
  );
  createMeetingToken.mockClear();
  const join = await actions.joinLiveStream("s1");
  const tokenMinted = createMeetingToken.mock.calls.length > 0;
  const recordings = await actions.listLiveStreamRecordings("s1");
  const link = await actions.getLiveStreamRecordingLink("s1", "rec1");
  commentCreate.mockClear();
  const comment = await actions.sendLiveStreamComment("s1", commentForm());
  return {
    page,
    join: join.error === null,
    tokenMinted,
    recordings: recordings.recordings.length > 0,
    link: link.error === null,
    comment: comment.error === null && commentCreate.mock.calls.length === 1,
  };
}
const allIn = { page: true, join: true, tokenMinted: true, recordings: true, link: true, comment: true };
const allOut = { page: false, join: false, tokenMinted: false, recordings: false, link: false, comment: false };

beforeEach(() => {
  stream = {
    id: "s1",
    hostId: "host",
    circleId: null,
    targetUserId: null,
    selectedOnly: true,
    status: "LIVE",
    roomName: "live-s1",
    roomUrl: "https://x.daily.co/live-s1",
    title: "Just us",
  };
  invites = [
    { inviteeId: "picked", status: "PENDING" },
    { inviteeId: "cancelled", status: "CANCELLED" },
  ];
  seats = [
    { userId: "host", role: "COHOST" },
    { userId: "guest", role: "GUEST" },
  ];
  blocks = [];
  me = null;
  vi.clearAllMocks();
});

describe("selected-only live: visibility matrix on every server gate", () => {
  it("a picked person gets in everywhere", async () => {
    me = user("picked");
    expect(await gates()).toEqual(allIn);
  });

  it("someone on stage, the host and a site admin get in", async () => {
    for (const who of [user("guest"), user("host"), user("admin", true)]) {
      me = who;
      expect(await gates()).toEqual(allIn);
    }
  });

  it("anyone else is refused everywhere: 404, no token, no chat, no recordings", async () => {
    me = user("stranger");
    expect(await gates()).toEqual(allOut);
    expect(await actions.getLiveStreamComments("s1")).toEqual({ comments: [] });
    expect(await actions.getLiveStreamViewerCount("s1")).toMatchObject({ count: 0, stageCount: 0 });
  });

  it("a cancelled invitee, and a picked person blocked either way with the host, are refused (no room)", async () => {
    me = user("cancelled");
    expect(await gates()).toEqual(allOut);
    me = user("picked");
    blocks = [["host", "picked"]];
    expect(await gates()).toEqual(allOut);
    blocks = [["picked", "host"]];
    expect(await gates()).toEqual(allOut);
  });

  it("an anonymous visitor never gets past sign-in", async () => {
    me = null;
    await expect(LivePage({ params: Promise.resolve({ id: "s1" }), searchParams: Promise.resolve({}) })).rejects.toThrow(
      SignInRequired,
    );
    await expect(actions.joinLiveStream("s1")).rejects.toThrow(SignInRequired);
    expect(await actions.getActiveLiveStreams()).toEqual({ streams: [] });
    expect(createMeetingToken).not.toHaveBeenCalled();
  });

  it("the same stream as Everyone is open to anyone (existing audiences unchanged)", async () => {
    stream.selectedOnly = false;
    me = user("stranger");
    expect(await gates()).toEqual(allIn);
  });
});

describe("Home strip and Record & Post", () => {
  it("getActiveLiveStreams asks only for the viewer's own selected lives, minus blocked hosts", async () => {
    me = user("picked");
    blocks = [["picked", "blockedhost"]];
    await actions.getActiveLiveStreams();
    const where = (findMany.mock.calls[0]![0] as { where: { OR: Record<string, unknown>[] } }).where;
    expect(where.OR).toEqual([
      { selectedOnly: false, OR: [{ circleId: null }, { circle: { visibility: "PUBLIC" } }] },
      { selectedOnly: true, circleId: null, hostId: "picked" },
      expect.objectContaining({ selectedOnly: true, circleId: null, hostId: { notIn: ["blockedhost"] } }),
    ]);
  });

  it("Record & Post is never available for a selected-only live", async () => {
    me = user("host");
    expect(await actions.requestLiveStreamRecordingPost("s1", "rec1")).toEqual({ error: "not_available" });
    expect(recordingPostCreate).not.toHaveBeenCalled();
  });
});

describe("a stale invite to a selected-only live: a plain note, never a 404, never the stream", () => {
  /** Every string in a rendered server-component tree (props.children, recursively). */
  function textOf(node: unknown): string {
    if (node === null || node === undefined || typeof node === "boolean") return "";
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(textOf).join(" ");
    const props = (node as { props?: { children?: unknown } }).props;
    return props ? textOf(props.children) : "";
  }
  const open = () => LivePage({ params: Promise.resolve({ id: "s1" }), searchParams: Promise.resolve({ invite: "1" }) });

  it("a cancelled invitee who taps the old push or bell row gets the 'cancelled' note, with nothing about the stream", async () => {
    me = user("cancelled");
    const text = textOf(await open());
    expect(text).toContain("GONE:cancelled");
    expect(text).toContain("Back to Home");
    expect(text).not.toContain("Just us");
    expect(text).not.toContain("host");
    expect(text).not.toContain("live-s1");
    expect(createMeetingToken).not.toHaveBeenCalled();
  });

  it("once the live has ended, a shut-out invitee is told it ended", async () => {
    me = user("cancelled");
    stream.status = "ENDED";
    expect(textOf(await open())).toContain("GONE:ended");
  });

  it("a block with the host or the inviter gives the plain 404, as does having had no invite", async () => {
    me = user("cancelled");
    blocks = [["host", "cancelled"]];
    await expect(open()).rejects.toThrow("NEXT_NOT_FOUND");
    blocks = [];
    invites = [{ inviteeId: "cancelled", status: "CANCELLED", invitedById: "cohost" }];
    blocks = [["cancelled", "cohost"]];
    await expect(open()).rejects.toThrow("NEXT_NOT_FOUND");
    blocks = [];
    me = user("stranger");
    await expect(open()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("an Everyone / Circle / one-person stream never shows the note (only selected-only lives do)", async () => {
    stream.selectedOnly = false;
    stream.targetUserId = "someone";
    me = user("cancelled");
    await expect(open()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("the join, chat and recordings stay closed to a cancelled invitee: the note is all they get", async () => {
    me = user("cancelled");
    expect((await actions.joinLiveStream("s1")).error).toBe("not_a_member");
    expect(await actions.getLiveStreamComments("s1")).toEqual({ comments: [] });
    expect(createMeetingToken).not.toHaveBeenCalled();
  });
});