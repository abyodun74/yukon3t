import { beforeEach, describe, expect, it, vi } from "vitest";
import { LIVE_VIEWER_FRESH_MS, MAX_LIVE_VIEWERS } from "@/lib/live-viewer-cap";

// joinLiveStream's viewer cap and one-viewing-per-person rule, against an in-memory database whose
// pg_advisory_xact_lock is emulated (same approach as live-streams-start.test.ts): under/at the cap, the exempt,
// rejoining, stale rows, racing for the last slot, and moving from one stream to another.

type Role = "VIEWER" | "GUEST" | "COHOST";
type Viewer = { liveStreamId: string; userId: string; role: Role; joinedAt: Date };
type Stream = { id: string; hostId: string; status: "LIVE" | "ENDED"; roomName: string; roomUrl: string; circleId: null; targetUserId: null };
type User = { id: string; name: string; isAdmin: boolean; lastSeenAt: Date | null };

let viewers: Viewer[] = [];
let streams: Stream[] = [];
let users = new Map<string, User>();
let currentUser: User;
const afterCallbacks: Array<() => unknown> = [];
const createMeetingToken = vi.fn<(args: unknown) => Promise<string>>(async () => "token");
const ejectFromRoom = vi.fn<(room: string, ids: string[]) => Promise<void>>(async () => undefined);
const publishEvent = vi.fn<(channel: string) => Promise<void>>(async () => undefined);

// Emulates pg_advisory_xact_lock: transactions holding the same key run one at a time.
const lockTails = new Map<string, Promise<void>>();

const yieldTick = () => new Promise((r) => setTimeout(r, 1));

// A small evaluator for the Prisma `where` shapes these actions use on LiveStreamViewer.
function cmp(value: unknown, cond: unknown): boolean {
  if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
    const c = cond as Record<string, unknown>;
    if ("not" in c && value === c.not) return false;
    if ("in" in c && !(c.in as unknown[]).includes(value)) return false;
    if ("notIn" in c && (c.notIn as unknown[]).includes(value)) return false;
    if ("gte" in c && !(value instanceof Date && value.getTime() >= (c.gte as Date).getTime())) return false;
    return true;
  }
  return value === cond;
}
function matches(v: Viewer, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (k === "OR") return (cond as Record<string, unknown>[]).some((w) => matches(v, w));
    if (k === "user") {
      const u = users.get(v.userId)!;
      return Object.entries(cond as Record<string, unknown>).every(([uk, uc]) => cmp((u as Record<string, unknown>)[uk], uc));
    }
    if (k === "liveStream") {
      const s = streams.find((x) => x.id === v.liveStreamId)!;
      return Object.entries(cond as Record<string, unknown>).every(([sk, sc]) => cmp((s as Record<string, unknown>)[sk], sc));
    }
    return cmp((v as Record<string, unknown>)[k], cond);
  });
}
const key = (w: { liveStreamId_userId: { liveStreamId: string; userId: string } }) => w.liveStreamId_userId;

const db = {
  liveStream: {
    findUnique: async ({ where }: { where: { id: string } }) => streams.find((s) => s.id === where.id) ?? null,
  },
  liveStreamViewer: {
    findUnique: async ({ where }: { where: { liveStreamId_userId: { liveStreamId: string; userId: string } } }) => {
      const k = key(where);
      const row = viewers.find((v) => v.liveStreamId === k.liveStreamId && v.userId === k.userId);
      return row ? { ...row } : null;
    },
    count: async ({ where }: { where: Record<string, unknown> }) => {
      const n = viewers.filter((v) => matches(v, where)).length;
      await yieldTick(); // lets concurrent joins interleave unless the lock serializes them
      return n;
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
      const k = key(where);
      const row = viewers.find((v) => v.liveStreamId === k.liveStreamId && v.userId === k.userId);
      if (row) Object.assign(row, update);
      else viewers.push({ ...create, joinedAt: create.joinedAt ?? new Date() });
    },
    findMany: async ({ where }: { where: Record<string, unknown> }) =>
      viewers
        .filter((v) => matches(v, where))
        .map((v) => {
          const s = streams.find((x) => x.id === v.liveStreamId)!;
          return { liveStreamId: v.liveStreamId, liveStream: { roomName: s.roomName, status: s.status } };
        }),
    deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
      const before = viewers.length;
      viewers = viewers.filter((v) => !matches(v, where));
      return { count: before - viewers.length };
    },
  },
  liveStreamStageRequest: { upsert: async () => undefined },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ...db,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      let release: () => void = () => undefined;
      const tx = {
        ...db,
        $executeRaw: async (_strings: TemplateStringsArray, lockKey: string) => {
          const previous = lockTails.get(lockKey) ?? Promise.resolve();
          const mine = new Promise<void>((r) => (release = r));
          lockTails.set(lockKey, previous.then(() => mine));
          await previous;
          return 0;
        },
      };
      try {
        return await fn(tx);
      } finally {
        release();
      }
    },
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => afterCallbacks.push(fn) }));
vi.mock("@/lib/auth-guards", () => ({
  requireVerifiedUser: async () => currentUser,
  requireVerifiedViewer: async () => currentUser,
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true }));
vi.mock("@/lib/moderation", () => ({ moderateText: async () => ({ allowed: true }) }));
vi.mock("@/lib/daily", () => ({
  isCallingConfigured: () => true,
  createLiveStreamRoom: vi.fn(),
  createMeetingToken: (a: unknown) => createMeetingToken(a),
  deleteCallRoom: vi.fn(),
  ejectFromRoom: (room: string, ids: string[]) => ejectFromRoom(room, ids),
  listRoomRecordings: vi.fn(),
  getRecordingAccessLink: vi.fn(),
}));
vi.mock("@/lib/circle-permissions", () => ({ getCircleMembership: async () => ({ role: "MEMBER" }) }));
vi.mock("@/lib/live-stream-access", () => ({ canAccessLiveStream: async () => true }));
vi.mock("@/lib/realtime-server", () => ({ publishEvent: (channel: string) => publishEvent(channel) }));
vi.mock("@/lib/error-tracking", () => ({ captureError: vi.fn() }));
vi.mock("@/lib/live-stream-announce", () => ({ announceLiveStream: vi.fn() }));

const { joinLiveStream } = await import("@/app/actions/live-streams");

function addUser(id: string, opts: Partial<User> = {}) {
  const u: User = { id, name: id, isAdmin: false, lastSeenAt: new Date(), ...opts };
  users.set(id, u);
  return u;
}
function addStream(id: string, hostId: string) {
  streams.push({ id, hostId, status: "LIVE", roomName: `live-${id}`, roomUrl: `https://x.daily.co/live-${id}`, circleId: null, targetUserId: null });
  addUser(hostId);
  viewers.push({ liveStreamId: id, userId: hostId, role: "COHOST", joinedAt: new Date() });
}
/** Fills `streamId` with `n` other fresh viewers. */
function fill(streamId: string, n: number) {
  for (let i = 0; i < n; i++) {
    const id = `${streamId}-v${i}`;
    addUser(id);
    viewers.push({ liveStreamId: streamId, userId: id, role: "VIEWER", joinedAt: new Date() });
  }
}
async function joinAs(user: User, streamId: string, role?: "GUEST" | "COHOST") {
  currentUser = user;
  return joinLiveStream(streamId, role);
}
const rowsOf = (userId: string) => viewers.filter((v) => v.userId === userId);
const slotsHeld = (streamId: string, hostId: string) => viewers.filter((v) => v.liveStreamId === streamId && v.userId !== hostId && v.role !== "COHOST").length;

beforeEach(() => {
  viewers = [];
  streams = [];
  users = new Map();
  afterCallbacks.length = 0;
  lockTails.clear();
  vi.clearAllMocks();
  addStream("A", "hostA");
  addStream("B", "hostB");
});

describe("joinLiveStream viewer cap", () => {
  it("lets a viewer in under the cap", async () => {
    fill("A", MAX_LIVE_VIEWERS - 1);
    const result = await joinAs(addUser("me"), "A");
    expect(result.error).toBeNull();
    expect(slotsHeld("A", "hostA")).toBe(MAX_LIVE_VIEWERS);
  });

  it("answers stream_full at the cap, writing nothing and minting no token", async () => {
    fill("A", MAX_LIVE_VIEWERS);
    const result = await joinAs(addUser("me"), "A");
    expect(result).toEqual({ error: "stream_full" });
    expect(rowsOf("me")).toHaveLength(0);
    expect(createMeetingToken).not.toHaveBeenCalled();
  });

  it("always lets the host, a co-host and an admin in", async () => {
    fill("A", MAX_LIVE_VIEWERS);
    expect((await joinAs(users.get("hostA")!, "A")).error).toBeNull();

    const cohost = addUser("cohost");
    viewers.push({ liveStreamId: "A", userId: "cohost", role: "COHOST", joinedAt: new Date(0) });
    expect((await joinAs(cohost, "A", "COHOST")).error).toBeNull();

    expect((await joinAs(addUser("admin", { isAdmin: true }), "A")).error).toBeNull();
  });

  it("never refuses or double-counts someone who already holds a slot (reload, reconnect)", async () => {
    fill("A", MAX_LIVE_VIEWERS - 1);
    const me = addUser("me");
    expect((await joinAs(me, "A")).error).toBeNull();
    expect(slotsHeld("A", "hostA")).toBe(MAX_LIVE_VIEWERS);
    // The stream is now at the cap, counting me: my reload still gets in, and still counts once.
    expect((await joinAs(me, "A")).error).toBeNull();
    expect(rowsOf("me")).toHaveLength(1);
    expect(slotsHeld("A", "hostA")).toBe(MAX_LIVE_VIEWERS);
  });

  it("two joiners racing for the last slot: exactly one gets it", async () => {
    fill("A", MAX_LIVE_VIEWERS - 1);
    const a = addUser("racerA");
    const b = addUser("racerB");
    const results = await Promise.all([
      (async () => {
        currentUser = a;
        return joinLiveStream("A");
      })(),
      (async () => {
        currentUser = b;
        return joinLiveStream("A");
      })(),
    ]);
    expect(results.map((r) => r.error).sort()).toEqual([null, "stream_full"].sort());
    expect(slotsHeld("A", "hostA")).toBe(MAX_LIVE_VIEWERS);
  });

  it("stale rows (crashed clients) don't hold slots", async () => {
    fill("A", MAX_LIVE_VIEWERS);
    const stale = new Date(Date.now() - LIVE_VIEWER_FRESH_MS - 60_000);
    for (const v of viewers) {
      if (v.liveStreamId === "A" && v.role === "VIEWER") {
        v.joinedAt = stale;
        users.get(v.userId)!.lastSeenAt = stale;
      }
    }
    expect((await joinAs(addUser("me"), "A")).error).toBeNull();
  });

  it("gives the slot back when the Daily token can't be minted", async () => {
    createMeetingToken.mockRejectedValueOnce(new Error("500"));
    const result = await joinAs(addUser("me"), "A");
    expect(result.error).toBe("call_service_unavailable");
    expect(rowsOf("me")).toHaveLength(0);
  });

  it("bounds the token's lifetime", async () => {
    await joinAs(addUser("me"), "A");
    expect(createMeetingToken).toHaveBeenCalledWith(expect.objectContaining({ expiresInSeconds: 60 * 60 }));
  });
});

describe("one viewing per person", () => {
  it("joining B ends the viewing of A and frees A's slot at once", async () => {
    fill("A", MAX_LIVE_VIEWERS - 1);
    const me = addUser("me");
    await joinAs(me, "A");
    expect(slotsHeld("A", "hostA")).toBe(MAX_LIVE_VIEWERS);

    expect((await joinAs(me, "B")).error).toBeNull();
    expect(rowsOf("me").map((r) => r.liveStreamId)).toEqual(["B"]);
    expect(slotsHeld("A", "hostA")).toBe(MAX_LIVE_VIEWERS - 1);
    // Someone else can take A's freed slot straight away.
    expect((await joinAs(addUser("next"), "A")).error).toBeNull();

    // After the answer: A is told its count moved, and my session is taken out of A's room.
    for (const cb of afterCallbacks) await cb();
    expect(ejectFromRoom).toHaveBeenCalledWith("live-A", ["me"]);
    expect(publishEvent).toHaveBeenCalledWith(expect.stringContaining("A"));
  });

  it("a refused (full) join of B leaves the viewing of A intact", async () => {
    const me = addUser("me");
    await joinAs(me, "A");
    fill("B", MAX_LIVE_VIEWERS);
    expect((await joinAs(me, "B")).error).toBe("stream_full");
    expect(rowsOf("me").map((r) => r.liveStreamId)).toEqual(["A"]);
    expect(ejectFromRoom).not.toHaveBeenCalled();
  });

  it("a person is never counted in two streams, whatever order they hop in", async () => {
    addStream("C", "hostC");
    const me = addUser("me");
    for (const s of ["A", "B", "C", "A", "B", "A"]) {
      expect((await joinAs(me, s)).error).toBeNull();
      expect(rowsOf("me")).toHaveLength(1);
      expect(rowsOf("me")[0].liveStreamId).toBe(s);
    }
  });

  it("rejoining the same stream isn't double counted and doesn't eject anyone", async () => {
    const me = addUser("me");
    await joinAs(me, "A");
    await joinAs(me, "A");
    expect(rowsOf("me")).toHaveLength(1);
    expect(afterCallbacks).toHaveLength(0);
  });

  it("a host watching another stream doesn't end or leave their own live", async () => {
    const host = users.get("hostA")!;
    expect((await joinAs(host, "B")).error).toBeNull();
    expect(streams.find((s) => s.id === "A")!.status).toBe("LIVE");
    expect(viewers.some((v) => v.liveStreamId === "A" && v.userId === "hostA" && v.role === "COHOST")).toBe(true);
    for (const cb of afterCallbacks) await cb();
    expect(ejectFromRoom).not.toHaveBeenCalledWith("live-A", expect.anything());
  });

  it("a co-host seat elsewhere isn't a viewing, so it's kept", async () => {
    const me = addUser("me");
    viewers.push({ liveStreamId: "A", userId: "me", role: "COHOST", joinedAt: new Date() });
    expect((await joinAs(me, "B")).error).toBeNull();
    expect(rowsOf("me").map((r) => r.liveStreamId).sort()).toEqual(["A", "B"]);
  });
});
