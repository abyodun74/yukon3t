import { beforeEach, describe, expect, it, vi } from "vitest";
import { LIVE_INVITE_MAX_SENDS, LIVE_INVITE_TTL_MS, MAX_LIVE_STAGE } from "@/lib/live-stage";

// Live stage invites end to end against an in-memory database whose pg_advisory_xact_lock is emulated (same approach
// as live-streams-viewer-cap.test.ts): who may invite (host and co-hosts, never a viewer or guest), the picker's search
// filtering (self, blocks, hidden peers, people already on stage or invited), the invite lifecycle (send, idempotent
// resend, accept onto the stage, decline, cancel, expiry, re-invite caps) and the stage cap under racing accepts.

type Role = "VIEWER" | "GUEST" | "COHOST";
type Status = "PENDING" | "ACCEPTED" | "DECLINED" | "CANCELLED" | "EXPIRED";
type User = {
  id: string;
  name: string;
  username: string;
  isAdmin: boolean;
  isGuestPreview: boolean;
  status: "ACTIVE" | "DEACTIVATED";
  discoverable: boolean;
  verified: boolean;
  trustScore: number;
};
type Stream = {
  id: string;
  hostId: string;
  circleId: string | null;
  targetUserId: string | null;
  selectedOnly?: boolean;
  status: "LIVE" | "ENDED";
  roomName: string;
};
type Viewer = { liveStreamId: string; userId: string; role: Role; joinedAt: Date };
type Invite = {
  id: string;
  liveStreamId: string;
  inviteeId: string;
  invitedById: string;
  status: Status;
  sendCount: number;
  createdAt: Date;
  respondedAt: Date | null;
};
type Note = { id?: string; recipientId: string; actorId: string; type: string; liveStreamId: string; readAt: Date | null };
type Connection = { requesterId: string; targetId: string; status: "ACCEPTED" | "PENDING" };

let users = new Map<string, User>();
let streams: Stream[] = [];
let viewers: Viewer[] = [];
let invites: Invite[] = [];
let notes: Note[] = [];
let connections: Connection[] = [];
let blocks: [string, string][] = [];
let hiddenPeers: Record<string, string[]> = {};
let nextId = 1;
let currentUser: User;
const checkRateLimit = vi.fn(async (name: string, id: string, opts?: { rate?: number }) => {
  void name;
  void id;
  void opts;
  return true;
});
const sendPushToUser = vi.fn(async (userId: string, payload: unknown) => {
  void userId;
  void payload;
});
const sendFcmActivityToUser = vi.fn(async (userId: string, payload: unknown, options?: unknown) => {
  void userId;
  void payload;
  void options;
});
const publishEvent = vi.fn(async (...args: unknown[]) => {
  void args;
});

const lockTails = new Map<string, Promise<void>>();
const yieldTick = () => new Promise((r) => setTimeout(r, 1));

// ---------- a small evaluator for the `where` shapes these actions use ----------
function cmp(value: unknown, cond: unknown): boolean {
  if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
    const c = cond as Record<string, unknown>;
    if ("not" in c && value === c.not) return false;
    if ("in" in c && !(c.in as unknown[]).includes(value)) return false;
    if ("notIn" in c && (c.notIn as unknown[]).includes(value)) return false;
    if ("gt" in c && !((value as Date).getTime() > (c.gt as Date).getTime())) return false;
    if ("lte" in c && !((value as Date).getTime() <= (c.lte as Date).getTime())) return false;
    if ("lt" in c && !((value as number) < (c.lt as number))) return false;
    if ("contains" in c) return String(value ?? "").toLowerCase().includes(String(c.contains).toLowerCase());
    return true;
  }
  return value === cond;
}
function rowMatches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (k === "liveStream" && typeof row.liveStreamId === "string") {
      const stream = streams.find((x) => x.id === row.liveStreamId)!;
      return rowMatches(stream as unknown as Record<string, unknown>, cond as Record<string, unknown>);
    }
    if (k === "OR") return (cond as Record<string, unknown>[]).some((w) => rowMatches(row, w));
    if (k === "AND") return (cond as Record<string, unknown>[]).every((w) => rowMatches(row, w));
    return cmp(row[k], cond);
  });
}
function userMatches(u: User, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (k === "AND") return (cond as Record<string, unknown>[]).every((w) => userMatches(u, w));
    if (k === "OR") return (cond as Record<string, unknown>[]).some((w) => userMatches(u, w));
    if (k === "NOT") return u.verified; // UNVERIFIED_ACCOUNT_WHERE
    if (k === "sentConnections") {
      const s = (cond as { some: { targetId: string; status: string } }).some;
      return connections.some((c) => c.requesterId === u.id && c.targetId === s.targetId && c.status === s.status);
    }
    if (k === "receivedConnections") {
      const s = (cond as { some: { requesterId: string; status: string } }).some;
      return connections.some((c) => c.targetId === u.id && c.requesterId === s.requesterId && c.status === s.status);
    }
    return cmp((u as unknown as Record<string, unknown>)[k], cond);
  });
}
const vKey = (w: { liveStreamId_userId: { liveStreamId: string; userId: string } }) => w.liveStreamId_userId;
const iKey = (w: { liveStreamId_inviteeId: { liveStreamId: string; inviteeId: string } }) => w.liveStreamId_inviteeId;
const findInvite = (k: { liveStreamId: string; inviteeId: string }) =>
  invites.find((i) => i.liveStreamId === k.liveStreamId && i.inviteeId === k.inviteeId);

const db = {
  liveStream: {
    findUnique: async ({ where }: { where: { id: string } }) => streams.find((s) => s.id === where.id) ?? null,
  },
  liveStreamViewer: {
    findUnique: async ({ where }: { where: { liveStreamId_userId: { liveStreamId: string; userId: string } } }) => {
      const k = vKey(where);
      const row = viewers.find((v) => v.liveStreamId === k.liveStreamId && v.userId === k.userId);
      return row ? { ...row } : null;
    },
    findMany: async ({ where }: { where: Record<string, unknown> }) =>
      viewers.filter((v) => rowMatches(v as unknown as Record<string, unknown>, where)).map((v) => ({ ...v })),
    count: async ({ where }: { where: Record<string, unknown> }) => {
      const n = viewers.filter((v) => rowMatches(v as unknown as Record<string, unknown>, where)).length;
      await yieldTick(); // racing accepts interleave here unless the stage lock serializes them
      return n;
    },
    deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
      const before = viewers.length;
      viewers = viewers.filter((v) => !rowMatches(v as unknown as Record<string, unknown>, where));
      return { count: before - viewers.length };
    },
    upsert: async ({
      where,
      create,
      update,
    }: {
      where: { liveStreamId_userId: { liveStreamId: string; userId: string } };
      create: Viewer;
      update: Partial<Viewer>;
    }) => {
      const k = vKey(where);
      const row = viewers.find((v) => v.liveStreamId === k.liveStreamId && v.userId === k.userId);
      if (row) Object.assign(row, update);
      else viewers.push({ ...create });
    },
  },
  liveStreamInvite: {
    findUnique: async ({ where }: { where: { liveStreamId_inviteeId: { liveStreamId: string; inviteeId: string } } }) => {
      const inv = findInvite(iKey(where));
      if (!inv) return null;
      const stream = streams.find((s) => s.id === inv.liveStreamId)!;
      const inviter = users.get(inv.invitedById)!;
      return {
        ...inv,
        invitedBy: { id: inviter.id, name: inviter.name, avatarUrl: null },
        liveStream: { ...stream },
      };
    },
    findMany: async ({ where }: { where: Record<string, unknown> }) =>
      invites
        .filter((i) => rowMatches(i as unknown as Record<string, unknown>, where))
        .map((i) => {
          const u = users.get(i.inviteeId)!;
          const stream = streams.find((x) => x.id === i.liveStreamId)!;
          return { ...i, invitee: { id: u.id, name: u.name, avatarUrl: null }, liveStream: { status: stream.status } };
        }),
    groupBy: async ({ where }: { where: Record<string, unknown> }) => {
      const counts = new Map<string, number>();
      for (const i of invites.filter((x) => rowMatches(x as unknown as Record<string, unknown>, where))) {
        counts.set(i.inviteeId, (counts.get(i.inviteeId) ?? 0) + 1);
      }
      return [...counts].map(([inviteeId, n]) => ({ inviteeId, _count: { _all: n } }));
    },
    count: async ({ where }: { where: Record<string, unknown> }) =>
      invites.filter((i) => rowMatches(i as unknown as Record<string, unknown>, where)).length,
    create: async ({ data }: { data: Partial<Invite> }) => {
      if (findInvite({ liveStreamId: data.liveStreamId!, inviteeId: data.inviteeId! })) throw new Error("unique");
      invites.push({
        id: `inv${nextId++}`,
        liveStreamId: data.liveStreamId!,
        inviteeId: data.inviteeId!,
        invitedById: data.invitedById!,
        status: "PENDING",
        sendCount: 1,
        createdAt: data.createdAt ?? new Date(),
        respondedAt: null,
      });
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const hit = invites.filter((i) => rowMatches(i as unknown as Record<string, unknown>, where));
      for (const i of hit) {
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === "object" && "increment" in (v as object)) {
            (i as unknown as Record<string, number>)[k] += (v as { increment: number }).increment;
          } else (i as unknown as Record<string, unknown>)[k] = v;
        }
      }
      return { count: hit.length };
    },
  },
  liveStreamStageRequest: { updateMany: async () => ({ count: 0 }) },
  notification: {
    findMany: async ({ where }: { where: Record<string, unknown> }) =>
      notes.filter((n) => rowMatches(n as unknown as Record<string, unknown>, where)).map((n) => ({ ...n })),
    deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
      const before = notes.length;
      notes = notes.filter((n) => !rowMatches(n as unknown as Record<string, unknown>, where));
      return { count: before - notes.length };
    },
    createMany: async ({ data }: { data: Note[] }) => {
      notes.push(...data.map((n) => ({ ...n, id: `note${nextId++}`, readAt: null })));
      return { count: data.length };
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<Note> }) => {
      const hit = notes.filter((n) => rowMatches(n as unknown as Record<string, unknown>, where));
      for (const n of hit) Object.assign(n, data);
      return { count: hit.length };
    },
  },
  user: {
    findMany: async ({ where, take }: { where: Record<string, unknown>; take?: number }) =>
      [...users.values()]
        .filter((u) => userMatches(u, where))
        .sort((a, b) => b.trustScore - a.trustScore || a.id.localeCompare(b.id))
        .slice(0, take ?? Infinity)
        .map((u) => ({ id: u.id, name: u.name, username: u.username, avatarUrl: null })),
  },
  connection: {
    findMany: async ({ where }: { where: { OR: Record<string, unknown>[]; status: string } }) =>
      connections.filter(
        (c) => c.status === where.status && where.OR.some((w) => rowMatches(c as unknown as Record<string, unknown>, w)),
      ),
  },
  circle: { findUnique: async () => null },
  circleMembership: { findMany: async () => [] },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ...db,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const releases: Array<() => void> = [];
      const tx = {
        ...db,
        $executeRaw: async (_strings: TemplateStringsArray, lockKey: string) => {
          const previous = lockTails.get(lockKey) ?? Promise.resolve();
          let release: () => void = () => undefined;
          const mine = new Promise<void>((r) => (release = r));
          releases.push(release);
          lockTails.set(lockKey, previous.then(() => mine));
          await previous;
          return 0;
        },
      };
      try {
        return await fn(tx);
      } finally {
        releases.forEach((r) => r());
      }
    },
  },
}));
vi.mock("@/lib/auth-guards", () => ({
  requireVerifiedUser: async () => currentUser,
  requireVerifiedViewer: async () => currentUser,
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (name: string, id: string, opts?: { rate?: number }) => checkRateLimit(name, id, opts),
}));
vi.mock("@/lib/push", () => ({ sendPushToUser: (id: string, p: unknown) => sendPushToUser(id, p) }));
vi.mock("@/lib/fcm", () => ({
  sendFcmActivityToUser: (id: string, p: unknown, o?: unknown) => sendFcmActivityToUser(id, p, o),
}));
vi.mock("@/lib/realtime-server", () => ({ publishEvent: (...a: unknown[]) => publishEvent(...a) }));
vi.mock("@/lib/error-tracking", () => ({ captureError: vi.fn() }));
// The real rule for "Only the people I selected" streams (it reads this in-memory database's invites and seats); every
// other audience is let through here, as before (their rules have their own tests in live-stream-access.test.ts).
vi.mock("@/lib/live-stream-access", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/live-stream-access")>();
  return {
    ...real,
    canAccessLiveStream: (s: Parameters<typeof real.canAccessLiveStream>[0], u: { id: string; isAdmin: boolean }) =>
      s.selectedOnly ? real.canAccessLiveStream(s, u) : Promise.resolve(true),
  };
});
const ejectFromRoom = vi.fn(async (room: string, ids: string[]) => {
  void room;
  void ids;
});
vi.mock("@/lib/daily", () => ({ ejectFromRoom: (room: string, ids: string[]) => ejectFromRoom(room, ids) }));
vi.mock("@/lib/circle-permissions", () => ({ getCircleMembership: async () => ({ role: "MEMBER" }) }));
vi.mock("@/lib/hidden-chats", () => ({ getHiddenPeerIds: async (id: string) => hiddenPeers[id] ?? [] }));
vi.mock("@/lib/blocks", () => ({
  getBlockedEitherWayIds: async (id: string) =>
    new Set(blocks.flatMap(([a, b]) => (a === id ? [b] : b === id ? [a] : []))),
  isBlockedWithAny: async (id: string, others: string[]) =>
    blocks.some(([a, b]) => (a === id && others.includes(b)) || (b === id && others.includes(a))),
}));

const {
  searchLiveInvitees,
  inviteToLiveStream,
  cancelLiveInvite,
  getLiveStreamInvites,
  getMyLiveInvite,
  respondToLiveInvite,
} = await import("@/app/actions/live-stream-invites");

function addUser(id: string, opts: Partial<User> = {}) {
  const u: User = {
    id,
    name: `Name ${id}`,
    username: id,
    isAdmin: false,
    isGuestPreview: false,
    status: "ACTIVE",
    discoverable: true,
    verified: true,
    trustScore: 0,
    ...opts,
  };
  users.set(id, u);
  return u;
}
function as(id: string) {
  currentUser = users.get(id)!;
}
const stageOf = (streamId: string) =>
  viewers.filter((v) => v.liveStreamId === streamId && v.userId !== "host" && (v.role === "GUEST" || v.role === "COHOST"));

beforeEach(() => {
  users = new Map();
  streams = [{ id: "s1", hostId: "host", circleId: null, targetUserId: null, status: "LIVE", roomName: "live-s1" }];
  viewers = [];
  invites = [];
  notes = [];
  connections = [];
  blocks = [];
  hiddenPeers = {};
  nextId = 1;
  lockTails.clear();
  vi.clearAllMocks();
  addUser("host");
  addUser("cohost");
  addUser("viewer");
  addUser("guest");
  viewers.push(
    { liveStreamId: "s1", userId: "host", role: "COHOST", joinedAt: new Date() },
    { liveStreamId: "s1", userId: "cohost", role: "COHOST", joinedAt: new Date() },
    { liveStreamId: "s1", userId: "viewer", role: "VIEWER", joinedAt: new Date() },
    { liveStreamId: "s1", userId: "guest", role: "GUEST", joinedAt: new Date() },
  );
  for (const id of ["amy", "ben", "cara", "dan"]) addUser(id);
});

describe("who may invite (server-enforced)", () => {
  it("refuses a plain viewer and an on-stage guest on every host/co-host action", async () => {
    for (const who of ["viewer", "guest"]) {
      as(who);
      expect(await inviteToLiveStream("s1", ["amy"])).toEqual({ error: "forbidden" });
      expect(await cancelLiveInvite("s1", "amy")).toEqual({ error: "forbidden" });
      expect(await getLiveStreamInvites("s1")).toEqual({ invites: [] });
      expect(await searchLiveInvitees("am", { liveStreamId: "s1" })).toEqual({ error: "forbidden", items: [] });
    }
    expect(invites).toHaveLength(0);
    expect(notes).toHaveLength(0);
    expect(sendPushToUser).not.toHaveBeenCalled();
  });

  it("lets the host and a co-host invite", async () => {
    as("host");
    expect(await inviteToLiveStream("s1", ["amy"])).toMatchObject({ error: null, invited: ["amy"] });
    as("cohost");
    expect(await inviteToLiveStream("s1", ["ben"])).toMatchObject({ error: null, invited: ["ben"] });
    expect(invites.map((i) => [i.inviteeId, i.invitedById])).toEqual([
      ["amy", "host"],
      ["ben", "cohost"],
    ]);
  });

  it("refuses once the stream has ended", async () => {
    streams[0]!.status = "ENDED";
    as("host");
    expect(await inviteToLiveStream("s1", ["amy"])).toEqual({ error: "forbidden" });
  });
});

describe("searchLiveInvitees filtering", () => {
  it("never answers the searcher, blocked people either way, hidden peers, the stage or open invitees", async () => {
    addUser("name-blocker");
    addUser("name-blocked");
    addUser("name-hidden");
    addUser("name-ok");
    addUser("name-invited");
    addUser("name-onstage");
    blocks = [
      ["name-blocker", "host"],
      ["host", "name-blocked"],
    ];
    hiddenPeers = { host: ["name-hidden"] };
    viewers.push({ liveStreamId: "s1", userId: "name-onstage", role: "GUEST", joinedAt: new Date() });
    invites.push({
      id: "x",
      liveStreamId: "s1",
      inviteeId: "name-invited",
      invitedById: "host",
      status: "PENDING",
      sendCount: 1,
      createdAt: new Date(),
      respondedAt: null,
    });
    as("host");
    const { error, items } = await searchLiveInvitees("name-", { liveStreamId: "s1" });
    expect(error).toBeNull();
    expect(items.map((i) => i.id).sort()).toEqual(["name-ok"]);
  });

  it("filters the host's blocks too when a co-host searches", async () => {
    addUser("name-x");
    blocks = [["host", "name-x"]];
    as("cohost");
    const { items } = await searchLiveInvitees("name-x", { liveStreamId: "s1" });
    expect(items).toEqual([]);
  });

  it("leaves out the deactivated, unverified, guest-preview and people hidden from search, but finds connections", async () => {
    addUser("pal-gone", { status: "DEACTIVATED" });
    addUser("pal-unverified", { verified: false });
    addUser("pal-guest", { isGuestPreview: true });
    addUser("pal-private", { discoverable: false });
    addUser("pal-friend", { discoverable: false });
    addUser("pal-admin", { isAdmin: true });
    connections = [{ requesterId: "pal-friend", targetId: "host", status: "ACCEPTED" }];
    as("host");
    const { items } = await searchLiveInvitees("pal", {});
    expect(items).toEqual([{ id: "pal-friend", name: "Name pal-friend", username: "pal-friend", avatarUrl: null, connected: true }]);
  });

  it("needs two letters and is rate limited like Discover search", async () => {
    as("host");
    expect(await searchLiveInvitees("a", {})).toEqual({ error: null, items: [] });
    checkRateLimit.mockResolvedValueOnce(false);
    expect(await searchLiveInvitees("amy", {})).toEqual({ error: "rate_limited", items: [] });
    expect(checkRateLimit.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(["discoverSearch"]));
  });
});

describe("invite lifecycle", () => {
  it("writes one row, one bell row and one push per invitee, charging the hourly limit per person", async () => {
    as("host");
    const result = await inviteToLiveStream("s1", ["amy", "ben", "amy"]);
    expect(result).toMatchObject({ error: null, invited: ["amy", "ben"], refused: [] });
    expect(notes.map((n) => [n.recipientId, n.type, n.actorId])).toEqual([
      ["amy", "LIVE_STAGE_INVITE", "host"],
      ["ben", "LIVE_STAGE_INVITE", "host"],
    ]);
    expect(sendPushToUser).toHaveBeenCalledTimes(2);
    expect(sendFcmActivityToUser).toHaveBeenCalledTimes(2);
    expect(checkRateLimit).toHaveBeenCalledWith("liveInvite", "host", { rate: 2 });
    expect(publishEvent).toHaveBeenCalledWith("live-stream:s1", "changed", { kind: "stage" });
  });

  it("is idempotent: inviting someone whose invite is open sends nothing new", async () => {
    as("host");
    await inviteToLiveStream("s1", ["amy"]);
    vi.clearAllMocks();
    const again = await inviteToLiveStream("s1", ["amy"]);
    expect(again).toMatchObject({ error: null, invited: ["amy"] });
    expect(invites).toHaveLength(1);
    expect(notes).toHaveLength(1);
    expect(sendPushToUser).not.toHaveBeenCalled();
  });

  it("refuses blocked people, people already on stage, and the host, without saying why beyond a generic reason", async () => {
    blocks = [["amy", "host"]];
    as("host");
    const result = await inviteToLiveStream("s1", ["amy", "guest", "host"]);
    expect(result).toMatchObject({ error: null, invited: [] });
    if (result.error !== null) throw new Error("expected success");
    expect(result.refused).toEqual(
      expect.arrayContaining([
        { userId: "amy", reason: "unavailable" },
        { userId: "guest", reason: "on_stage" },
      ]),
    );
    expect(notes).toHaveLength(0);
  });

  it("refuses everything when the inviter's hourly limit is spent", async () => {
    checkRateLimit.mockResolvedValueOnce(false);
    as("host");
    expect(await inviteToLiveStream("s1", ["amy", "ben"])).toEqual({ error: "rate_limited" });
    expect(invites).toHaveLength(0);
  });

  it("an invitee sees the prompt, accepts onto the stage as a guest, and the invite is settled", async () => {
    as("host");
    await inviteToLiveStream("s1", ["amy"]);
    as("amy");
    expect((await getMyLiveInvite("s1")).invite?.inviter).toMatchObject({ id: "host" });
    expect(await respondToLiveInvite("s1", true)).toEqual({ error: null });
    expect(viewers.find((v) => v.userId === "amy")?.role).toBe("GUEST");
    expect(invites[0]?.status).toBe("ACCEPTED");
    expect(notes[0]?.readAt).not.toBeNull();
    expect((await getMyLiveInvite("s1")).invite).toBeNull();
    expect(await respondToLiveInvite("s1", true)).toEqual({ error: "expired" });
  });

  it("a decline is final: no seat, and that person can't be invited to this stream again", async () => {
    as("host");
    await inviteToLiveStream("s1", ["amy"]);
    as("amy");
    expect(await respondToLiveInvite("s1", false)).toEqual({ error: null });
    expect(viewers.find((v) => v.userId === "amy")).toBeUndefined();
    as("host");
    const again = await inviteToLiveStream("s1", ["amy"]);
    expect(again).toMatchObject({ invited: [], refused: [{ userId: "amy", reason: "declined" }] });
  });

  it("cancelling withdraws the invite and its unread bell row; it can then be re-sent, up to the cap", async () => {
    as("host");
    await inviteToLiveStream("s1", ["amy"]);
    as("cohost");
    expect(await cancelLiveInvite("s1", "amy")).toEqual({ error: null });
    expect(invites[0]?.status).toBe("CANCELLED");
    expect(notes).toHaveLength(0);
    as("amy");
    expect((await getMyLiveInvite("s1")).invite).toBeNull();
    expect(await respondToLiveInvite("s1", true)).toEqual({ error: "expired" });
    expect(viewers.find((v) => v.userId === "amy")).toBeUndefined();

    as("host");
    expect(await inviteToLiveStream("s1", ["amy"])).toMatchObject({ invited: ["amy"] });
    expect(invites[0]).toMatchObject({ status: "PENDING", sendCount: 2 });
    await cancelLiveInvite("s1", "amy");
    expect(LIVE_INVITE_MAX_SENDS).toBe(2);
    expect(await inviteToLiveStream("s1", ["amy"])).toMatchObject({ refused: [{ userId: "amy", reason: "limit" }] });
  });

  it("an invite past its TTL can't be accepted", async () => {
    as("host");
    await inviteToLiveStream("s1", ["amy"]);
    invites[0]!.createdAt = new Date(Date.now() - LIVE_INVITE_TTL_MS - 1000);
    as("amy");
    expect((await getMyLiveInvite("s1")).invite).toBeNull();
    expect(await respondToLiveInvite("s1", true)).toEqual({ error: "expired" });
  });

  it("a block that appears after the invite stops the accept", async () => {
    as("host");
    await inviteToLiveStream("s1", ["amy"]);
    blocks = [["host", "amy"]];
    as("amy");
    expect((await getMyLiveInvite("s1")).invite).toBeNull();
    expect(await respondToLiveInvite("s1", true)).toEqual({ error: "unavailable" });
    expect(viewers.find((v) => v.userId === "amy")).toBeUndefined();
  });
});

describe("the stage cap under racing accepts", () => {
  it(`never seats more than ${MAX_LIVE_STAGE}, however many accept at the same moment`, async () => {
    // Two already on stage (cohost, guest): 8 seats left, 12 invitees accept at once.
    const ids = Array.from({ length: 12 }, (_, i) => `racer${i}`);
    for (const id of ids) addUser(id);
    for (const id of ids) {
      invites.push({
        id: `i-${id}`,
        liveStreamId: "s1",
        inviteeId: id,
        invitedById: "host",
        status: "PENDING",
        sendCount: 1,
        createdAt: new Date(),
        respondedAt: null,
      });
    }
    const results = await Promise.all(
      ids.map(async (id) => {
        currentUser = users.get(id)!;
        return respondToLiveInvite("s1", true);
      }),
    );
    expect(stageOf("s1")).toHaveLength(MAX_LIVE_STAGE);
    expect(results.filter((r) => r.error === null)).toHaveLength(MAX_LIVE_STAGE - 2);
    expect(results.filter((r) => r.error === "stage_full")).toHaveLength(4);
    // Refused accepts keep their invite open, to try again while it lasts.
    expect(invites.filter((i) => i.status === "PENDING")).toHaveLength(4);
  });

  it("ten from an empty stage all get in, the eleventh is refused", async () => {
    viewers = viewers.filter((v) => v.userId === "host" || v.userId === "viewer");
    const ids = Array.from({ length: MAX_LIVE_STAGE + 1 }, (_, i) => `p${i}`);
    for (const id of ids) {
      addUser(id);
      invites.push({
        id: `i-${id}`,
        liveStreamId: "s1",
        inviteeId: id,
        invitedById: "host",
        status: "PENDING",
        sendCount: 1,
        createdAt: new Date(),
        respondedAt: null,
      });
    }
    const results = await Promise.all(
      ids.map(async (id) => {
        currentUser = users.get(id)!;
        return respondToLiveInvite("s1", true);
      }),
    );
    expect(stageOf("s1")).toHaveLength(MAX_LIVE_STAGE);
    expect(results.filter((r) => r.error === "stage_full")).toHaveLength(1);
  });
});

const { settleLiveInvites } = await import("@/lib/live-stream-invites-server");

type PushFn = (locale: string) => { title: string; body: string; url?: string; tag?: string; silent?: boolean };
const webPayload = (call: unknown[], locale = "en") => (call[1] as PushFn)(locale);

describe("correcting a delivered invite push (replacement, not recall)", () => {
  it("sends the invite under its replacement key, leading to the invite URL", async () => {
    as("host");
    await inviteToLiveStream("s1", ["amy"]);
    expect(webPayload(sendPushToUser.mock.calls[0]!)).toMatchObject({ tag: "live-invite:s1", url: "/live/s1?invite=1" });
    expect(sendFcmActivityToUser.mock.calls[0]![2]).toEqual({ replaceKey: "live-invite:s1" });
  });

  it("cancelling an invite its invitee hasn't acted on sends one quiet correction under the same key", async () => {
    as("host");
    await inviteToLiveStream("s1", ["amy"]);
    vi.clearAllMocks();
    await cancelLiveInvite("s1", "amy");
    expect(sendPushToUser).toHaveBeenCalledTimes(1);
    expect(sendPushToUser.mock.calls[0]![0]).toBe("amy");
    expect(webPayload(sendPushToUser.mock.calls[0]!)).toEqual({
      title: "Live invite",
      body: "This invite was cancelled",
      url: "/live/s1?invite=1",
      tag: "live-invite:s1",
      silent: true,
    });
    // In the recipient's language through the shared dictionaries.
    expect(webPayload(sendPushToUser.mock.calls[0]!, "es").body).toBe("Esta invitación se canceló");
    expect(sendFcmActivityToUser.mock.calls[0]![2]).toEqual({ replaceKey: "live-invite:s1", quiet: true });
    // A second cancel finds nothing to cancel and sends nothing.
    vi.clearAllMocks();
    await cancelLiveInvite("s1", "amy");
    expect(sendPushToUser).not.toHaveBeenCalled();
  });

  it("sends no correction to someone who already opened the invite (their bell row is read)", async () => {
    as("host");
    await inviteToLiveStream("s1", ["amy"]);
    notes[0]!.readAt = new Date();
    vi.clearAllMocks();
    await cancelLiveInvite("s1", "amy");
    expect(invites[0]?.status).toBe("CANCELLED");
    expect(sendPushToUser).not.toHaveBeenCalled();
    expect(sendFcmActivityToUser).not.toHaveBeenCalled();
  });

  it("settles invites that ran out, deletes their unread bell rows and corrects only those pushes, once", async () => {
    as("host");
    await inviteToLiveStream("s1", ["amy", "ben"]);
    for (const invite of invites) invite.createdAt = new Date(Date.now() - LIVE_INVITE_TTL_MS - 1000);
    notes.find((n) => n.recipientId === "ben")!.readAt = new Date();
    vi.clearAllMocks();
    expect(await settleLiveInvites()).toEqual({ settled: 2, recalled: 1 });
    expect(invites.map((i) => i.status)).toEqual(["EXPIRED", "EXPIRED"]);
    expect(notes.map((n) => n.recipientId)).toEqual(["ben"]);
    expect(sendPushToUser.mock.calls.map((c) => c[0])).toEqual(["amy"]);
    expect(webPayload(sendPushToUser.mock.calls[0]!).body).toBe("This invite has expired");
    vi.clearAllMocks();
    expect(await settleLiveInvites()).toEqual({ settled: 0, recalled: 0 });
    expect(sendPushToUser).not.toHaveBeenCalled();
  });

  it("says the live has ended when that's why, and leaves answered and in-time invites alone", async () => {
    as("host");
    await inviteToLiveStream("s1", ["amy", "ben"]);
    as("ben");
    await respondToLiveInvite("s1", false);
    streams[0]!.status = "ENDED";
    vi.clearAllMocks();
    expect(await settleLiveInvites({ liveStreamId: "s1" })).toEqual({ settled: 1, recalled: 1 });
    expect(webPayload(sendPushToUser.mock.calls[0]!).body).toBe("The live has ended");
    expect(invites.find((i) => i.inviteeId === "ben")?.status).toBe("DECLINED");
  });

  it("a stale invite opened later says why instead of failing", async () => {
    as("host");
    await inviteToLiveStream("s1", ["amy", "ben", "cara"]);
    await cancelLiveInvite("s1", "amy");
    as("amy");
    expect(await getMyLiveInvite("s1")).toEqual({ invite: null, gone: "cancelled" });
    as("ben");
    await respondToLiveInvite("s1", false);
    expect(await getMyLiveInvite("s1")).toEqual({ invite: null, gone: "answered" });
    invites.find((i) => i.inviteeId === "cara")!.createdAt = new Date(Date.now() - LIVE_INVITE_TTL_MS - 1);
    as("cara");
    expect((await getMyLiveInvite("s1")).gone).toBe("expired");
    streams[0]!.status = "ENDED";
    expect((await getMyLiveInvite("s1")).gone).toBe("ended");
    // Never a reason across a block.
    blocks = [["host", "cara"]];
    expect(await getMyLiveInvite("s1")).toEqual({ invite: null, gone: null });
  });
});

describe("'Only the people I selected' (selectedOnly): invites are the allow-list", () => {
  /** The page / join / token gate (canAccessLiveStream), as `userId` would meet it on this in-memory database. */
  async function canAccessLiveStream(streamId: string, userId: string) {
    const { canAccessLiveStream: check } = await import("@/lib/live-stream-access");
    const s = streams.find((x) => x.id === streamId)!;
    return check({ ...s, selectedOnly: s.selectedOnly ?? false }, { id: userId, isAdmin: false });
  }

  beforeEach(() => {
    streams.push({ id: "s2", hostId: "host", circleId: null, targetUserId: null, selectedOnly: true, status: "LIVE", roomName: "live-s2" });
    viewers.push({ liveStreamId: "s2", userId: "host", role: "COHOST", joinedAt: new Date() });
  });

  it("a mid-stream invite by the host or a co-host lets that person watch (it widens this audience only)", async () => {
    viewers.push({ liveStreamId: "s2", userId: "cohost", role: "COHOST", joinedAt: new Date() });
    expect(await canAccessLiveStream("s2", "amy")).toBe(false);
    expect(await canAccessLiveStream("s2", "ben")).toBe(false);
    as("host");
    expect(await inviteToLiveStream("s2", ["amy"])).toMatchObject({ error: null, invited: ["amy"] });
    as("cohost");
    expect(await inviteToLiveStream("s2", ["ben"])).toMatchObject({ error: null, invited: ["ben"] });
    expect(await canAccessLiveStream("s2", "amy")).toBe(true);
    expect(await canAccessLiveStream("s2", "ben")).toBe(true);
    // Not picked: still out.
    expect(await canAccessLiveStream("s2", "cara")).toBe(false);
    // They hear about it through the invite (bell row + push), in their own language.
    expect(notes.filter((n) => n.liveStreamId === "s2").map((n) => n.recipientId).sort()).toEqual(["amy", "ben"]);
    expect(sendPushToUser).toHaveBeenCalledTimes(2);
  });

  it("a blocked person is never added, and a block later shuts a picked person out", async () => {
    blocks = [["amy", "host"]];
    as("host");
    expect(await inviteToLiveStream("s2", ["amy"])).toMatchObject({
      error: null,
      invited: [],
      refused: [{ userId: "amy", reason: "unavailable" }],
    });
    expect(await canAccessLiveStream("s2", "amy")).toBe(false);
    blocks = [];
    await inviteToLiveStream("s2", ["ben"]);
    blocks = [["host", "ben"]];
    expect(await canAccessLiveStream("s2", "ben")).toBe(false);
  });

  it("cancelling an invite that was never accepted removes access and takes a watcher out of the room", async () => {
    as("host");
    await inviteToLiveStream("s2", ["amy"]);
    viewers.push({ liveStreamId: "s2", userId: "amy", role: "VIEWER", joinedAt: new Date() });
    expect(await canAccessLiveStream("s2", "amy")).toBe(true);
    expect(await cancelLiveInvite("s2", "amy")).toEqual({ error: null });
    expect(await canAccessLiveStream("s2", "amy")).toBe(false);
    expect(viewers.some((v) => v.liveStreamId === "s2" && v.userId === "amy")).toBe(false);
    expect(ejectFromRoom).toHaveBeenCalledWith("live-s2", ["amy"]);
    // Inviting them again restores it (a re-send of the cancelled row).
    expect(await inviteToLiveStream("s2", ["amy"])).toMatchObject({ error: null, invited: ["amy"] });
    expect(await canAccessLiveStream("s2", "amy")).toBe(true);
  });

  it("someone already on stage keeps access (and their seat) when their open invite is cancelled, until they leave", async () => {
    as("host");
    await inviteToLiveStream("s2", ["amy"]);
    // On stage through an approved stage request while the invite was still open.
    viewers.push({ liveStreamId: "s2", userId: "amy", role: "GUEST", joinedAt: new Date() });
    await cancelLiveInvite("s2", "amy");
    expect(await canAccessLiveStream("s2", "amy")).toBe(true);
    expect(viewers.some((v) => v.liveStreamId === "s2" && v.userId === "amy" && v.role === "GUEST")).toBe(true);
    expect(ejectFromRoom).not.toHaveBeenCalled();
    // Leaving the stage (the row goes) ends it.
    viewers = viewers.filter((v) => !(v.liveStreamId === "s2" && v.userId === "amy"));
    expect(await canAccessLiveStream("s2", "amy")).toBe(false);
  });

  it("declining or letting the stage invite run out keeps watching access; accepting seats them as usual", async () => {
    as("host");
    await inviteToLiveStream("s2", ["amy", "ben", "cara"]);
    as("amy");
    expect(await respondToLiveInvite("s2", false)).toEqual({ error: null });
    expect(await canAccessLiveStream("s2", "amy")).toBe(true);
    const ben = invites.find((i) => i.liveStreamId === "s2" && i.inviteeId === "ben")!;
    ben.createdAt = new Date(Date.now() - LIVE_INVITE_TTL_MS - 1000);
    expect(await canAccessLiveStream("s2", "ben")).toBe(true);
    as("cara");
    expect(await respondToLiveInvite("s2", true)).toEqual({ error: null });
    expect(viewers.some((v) => v.liveStreamId === "s2" && v.userId === "cara" && v.role === "GUEST")).toBe(true);
  });

  it("the allow-list stops at LIVE_SELECTED_AUDIENCE_MAX; re-inviting someone already on it doesn't count", async () => {
    const { LIVE_SELECTED_AUDIENCE_MAX } = await import("@/lib/live-audience");
    for (let i = 0; i < LIVE_SELECTED_AUDIENCE_MAX; i++) {
      invites.push({
        id: `full${i}`,
        liveStreamId: "s2",
        inviteeId: `old${i}`,
        invitedById: "host",
        // Answered or run out: not open, so the pending cap (20) isn't what refuses here.
        status: i === 0 ? "EXPIRED" : "ACCEPTED",
        sendCount: 1,
        createdAt: new Date(Date.now() - LIVE_INVITE_TTL_MS - 1000),
        respondedAt: new Date(),
      });
    }
    addUser("old0");
    as("host");
    expect(await inviteToLiveStream("s2", ["amy"])).toMatchObject({
      error: null,
      invited: [],
      refused: [{ userId: "amy", reason: "limit" }],
    });
    expect(await canAccessLiveStream("s2", "amy")).toBe(false);
    // old0's invite ran out: inviting them again re-sends it without growing the list.
    expect(await inviteToLiveStream("s2", ["old0"])).toMatchObject({ error: null, invited: ["old0"] });
    // A cancelled row frees a place.
    invites.find((i) => i.inviteeId === "old1")!.status = "CANCELLED";
    expect(await inviteToLiveStream("s2", ["amy"])).toMatchObject({ error: null, invited: ["amy"] });
  });

  it("existing audiences are unchanged: an Everyone stream's cancel takes nobody out of the room", async () => {
    as("host");
    await inviteToLiveStream("s1", ["amy"]);
    viewers.push({ liveStreamId: "s1", userId: "amy", role: "VIEWER", joinedAt: new Date() });
    await cancelLiveInvite("s1", "amy");
    expect(viewers.some((v) => v.liveStreamId === "s1" && v.userId === "amy")).toBe(true);
    expect(ejectFromRoom).not.toHaveBeenCalled();
  });

  it("the in-room search on a selected live offers anyone the host could invite, not only people already on it", async () => {
    as("host");
    const result = await searchLiveInvitees("ca", { liveStreamId: "s2" });
    expect(result.items.map((p) => p.id)).toContain("cara");
  });
});