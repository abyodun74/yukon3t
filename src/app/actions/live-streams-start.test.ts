import { beforeEach, describe, expect, it, vi } from "vitest";

// startLiveStream against an in-memory database: several hosts going live at once never block each other, one host's
// double tap makes one stream, a provider failure leaves nothing behind, and the audience fan-out runs only after
// the host has their answer (so it can never fail or slow the start).

type Row = {
  id: string;
  hostId: string;
  circleId: string | null;
  targetUserId: string | null;
  title: string;
  status: "LIVE" | "ENDED";
  roomName: string;
  roomUrl: string;
  startedAt: Date;
  endedAt: Date | null;
};

let rows: Row[] = [];
let nextId = 1;
let currentUser = { id: "chost000000001", name: "Host" };
const afterCallbacks: Array<() => unknown> = [];
const announceLiveStream = vi.fn(async (id: string) => {
  void id;
  return "announced" as const;
});
const publishEvent = vi.fn(async () => undefined);
const createLiveStreamRoom = vi.fn(async ({ name }: { name: string }) => ({ name, url: `https://x.daily.co/${name}` }));
const createMeetingToken = vi.fn(async () => "token");
const deleteCallRoom = vi.fn(async () => undefined);

// Emulates pg_advisory_xact_lock: transactions holding the same key run one at a time, different keys don't wait.
const lockTails = new Map<string, Promise<void>>();
const lockedKeys: string[] = [];

function matches(row: Row, where: Record<string, unknown>) {
  return Object.entries(where).every(([k, v]) => (row as Record<string, unknown>)[k] === v);
}

const db = {
  liveStream: {
    findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      const found = rows.filter((r) => matches(r, where)).sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
      return found[0] ?? null;
    },
    create: async ({ data }: { data: Partial<Row> }) => {
      // Yield, so concurrent starts genuinely interleave unless the lock serializes them.
      await new Promise((r) => setTimeout(r, 1));
      const row: Row = {
        id: `cls${String(nextId++).padStart(11, "0")}`,
        hostId: data.hostId!,
        circleId: data.circleId ?? null,
        targetUserId: data.targetUserId ?? null,
        title: data.title!,
        status: "LIVE",
        roomName: data.roomName ?? "",
        roomUrl: data.roomUrl ?? "",
        startedAt: new Date(),
        endedAt: null,
      };
      rows.push(row);
      return { id: row.id };
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    },
    deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
      const before = rows.length;
      rows = rows.filter((r) => !matches(r, where));
      return { count: before - rows.length };
    },
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ...db,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      let release: () => void = () => undefined;
      const tx = {
        ...db,
        $executeRaw: async (_strings: TemplateStringsArray, lockKey: string) => {
          lockedKeys.push(lockKey);
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
  createLiveStreamRoom: (a: { name: string }) => createLiveStreamRoom(a),
  createMeetingToken: () => createMeetingToken(),
  deleteCallRoom: () => deleteCallRoom(),
  listRoomRecordings: vi.fn(),
  getRecordingAccessLink: vi.fn(),
}));
vi.mock("@/lib/circle-permissions", () => ({ getCircleMembership: async () => ({ role: "MEMBER" }) }));
vi.mock("@/lib/live-stream-access", () => ({ canAccessLiveStream: async () => true }));
vi.mock("@/lib/realtime-server", () => ({ publishEvent: () => publishEvent() }));
vi.mock("@/lib/error-tracking", () => ({ captureError: vi.fn() }));
vi.mock("@/lib/live-stream-announce", () => ({ announceLiveStream: (id: string) => announceLiveStream(id) }));

const { startLiveStream } = await import("@/app/actions/live-streams");

function form(title = "Hello") {
  const fd = new FormData();
  fd.set("title", title);
  return fd;
}

beforeEach(() => {
  rows = [];
  nextId = 1;
  currentUser = { id: "chost000000001", name: "Host" };
  afterCallbacks.length = 0;
  lockTails.clear();
  lockedKeys.length = 0;
  vi.clearAllMocks();
  createLiveStreamRoom.mockImplementation(async ({ name }) => ({ name, url: `https://x.daily.co/${name}` }));
  createMeetingToken.mockImplementation(async () => "token");
});

describe("startLiveStream", () => {
  it("answers the host before any fan-out, and schedules the announcement and Home signal for after", async () => {
    const result = await startLiveStream(form());
    expect(result.error).toBeNull();
    expect(result).toMatchObject({ token: "token" });
    expect(announceLiveStream).not.toHaveBeenCalled();
    expect(publishEvent).not.toHaveBeenCalled();
    expect(afterCallbacks).toHaveLength(2);

    for (const cb of afterCallbacks) await cb();
    expect(announceLiveStream).toHaveBeenCalledWith(result.liveStreamId);
    expect(publishEvent).toHaveBeenCalledTimes(1);
    expect(rows[0]).toMatchObject({ status: "LIVE", roomName: `live-${result.liveStreamId}` });
  });

  it("a failing announcement can't change the host's result (it already returned)", async () => {
    announceLiveStream.mockImplementationOnce(async () => {
      throw new Error("db down");
    });
    const result = await startLiveStream(form());
    expect(result.error).toBeNull();
    // Run the after() work the way the platform would, after the response.
    await Promise.allSettled(afterCallbacks.map((cb) => Promise.resolve().then(cb)));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("LIVE");
  });

  it("a double tap by one host makes exactly one stream and one room", async () => {
    const [a, b] = await Promise.all([startLiveStream(form()), startLiveStream(form())]);
    const errors = [a.error, b.error].sort();
    expect(errors).toEqual([null, "already_live"].sort());
    expect(rows.filter((r) => r.status === "LIVE")).toHaveLength(1);
    expect(createLiveStreamRoom).toHaveBeenCalledTimes(1);
    expect(a.liveStreamId).toBe(b.liveStreamId);
  });

  it("several hosts going live at once each get their own stream, under their own lock", async () => {
    const hosts = ["chosta00000001", "chostb00000001", "chostc00000001", "chostd00000001"];
    const results = await Promise.all(
      hosts.map(async (id) => {
        currentUser = { id, name: id };
        return startLiveStream(form());
      }),
    );
    expect(results.every((r) => r.error === null)).toBe(true);
    expect(new Set(rows.map((r) => r.hostId)).size).toBe(hosts.length);
    expect(new Set(lockedKeys)).toEqual(new Set(hosts.map((h) => `live-start:${h}`)));
  });

  it("a Daily failure leaves no half-made stream behind, so the next try works", async () => {
    createLiveStreamRoom.mockRejectedValueOnce(new Error("429"));
    const first = await startLiveStream(form());
    expect(first.error).toBe("call_service_unavailable");
    expect(rows).toHaveLength(0);
    expect(afterCallbacks).toHaveLength(0);

    const second = await startLiveStream(form());
    expect(second.error).toBeNull();
  });

  it("a token failure deletes the room and the row", async () => {
    createMeetingToken.mockRejectedValueOnce(new Error("500"));
    const result = await startLiveStream(form());
    expect(result.error).toBe("call_service_unavailable");
    expect(deleteCallRoom).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(0);
  });

  it("an abandoned start (no room, past the stale window) doesn't block the host", async () => {
    rows.push({
      id: "cstale00000001",
      hostId: currentUser.id,
      circleId: null,
      targetUserId: null,
      title: "old",
      status: "LIVE",
      roomName: "",
      roomUrl: "",
      startedAt: new Date(Date.now() - 10 * 60_000),
      endedAt: null,
    });
    const result = await startLiveStream(form());
    expect(result.error).toBeNull();
    expect(rows.find((r) => r.id === "cstale00000001")?.status).toBe("ENDED");
  });

  it("a working stream still answers already_live with its id", async () => {
    rows.push({
      id: "clive000000001",
      hostId: currentUser.id,
      circleId: null,
      targetUserId: null,
      title: "on air",
      status: "LIVE",
      roomName: "live-clive000000001",
      roomUrl: "https://x.daily.co/live-clive000000001",
      startedAt: new Date(Date.now() - 60 * 60_000),
      endedAt: null,
    });
    const result = await startLiveStream(form());
    expect(result).toEqual({ error: "already_live", liveStreamId: "clive000000001" });
    expect(createLiveStreamRoom).not.toHaveBeenCalled();
  });
});
