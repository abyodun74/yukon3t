import { beforeEach, describe, expect, it, vi } from "vitest";

// announceLiveStream / sweepUnannouncedLiveStreams against a mocked database: exactly once per stream, batched,
// never throws, and the invite push only goes out from the run that committed.

type Stream = {
  id: string;
  hostId: string;
  circleId: string | null;
  targetUserId: string | null;
  status: "LIVE" | "ENDED";
  roomName: string;
  announcedAt: Date | null;
  startedAt: Date;
  host: { name: string | null };
};

let streams: Stream[] = [];
let members: string[] = [];
const notificationCreate = vi.fn(async (a: unknown) => a);
const notificationCreateMany = vi.fn(async (a: unknown) => a);
const notifySubscribers = vi.fn(async (...a: unknown[]) => a);
const sendPushToUser = vi.fn(async () => undefined);
const sendFcmActivityToUser = vi.fn(async () => undefined);
const captureError = vi.fn(async () => undefined);
const lockKeys: string[] = [];

function stream(over: Partial<Stream> = {}): Stream {
  return {
    id: "cls00000000001",
    hostId: "chost000000001",
    circleId: null,
    targetUserId: null,
    status: "LIVE",
    roomName: "live-cls00000000001",
    announcedAt: null,
    startedAt: new Date(),
    host: { name: "Host" },
    ...over,
  };
}

const tx = {
  $executeRaw: async (_s: TemplateStringsArray, key: string) => {
    lockKeys.push(key);
    return 0;
  },
  liveStream: {
    findUnique: async ({ where }: { where: { id: string } }) => streams.find((s) => s.id === where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Partial<Stream> }) => {
      const s = streams.find((x) => x.id === where.id)!;
      Object.assign(s, data);
      return s;
    },
  },
  notification: {
    create: (a: unknown) => notificationCreate(a),
    createMany: (a: unknown) => notificationCreateMany(a),
  },
  circleMembership: {
    findMany: async () => members.map((userId) => ({ userId })),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => {
      // Emulates a rollback: the stream rows are restored if the callback throws.
      const snapshot = streams.map((s) => ({ ...s }));
      try {
        return await fn(tx);
      } catch (err) {
        streams = snapshot;
        throw err;
      }
    },
    liveStream: {
      updateMany: async ({ where, data }: { where: { startedAt: { lt: Date } }; data: Partial<Stream> }) => {
        const hit = streams.filter((s) => s.status === "LIVE" && !s.announcedAt && s.startedAt < where.startedAt.lt);
        hit.forEach((s) => Object.assign(s, data));
        return { count: hit.length };
      },
      findMany: async ({ where, take }: { where: { startedAt: { lte: Date } }; take: number }) =>
        streams
          .filter((s) => s.status === "LIVE" && !s.announcedAt && s.roomName && s.startedAt <= where.startedAt.lte)
          .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
          .slice(0, take)
          .map((s) => ({ id: s.id, startedAt: s.startedAt })),
    },
  },
}));
vi.mock("@/lib/notify-subscribers", () => ({ notifySubscribers: (...a: unknown[]) => notifySubscribers(...a) }));
vi.mock("@/lib/push", () => ({ sendPushToUser: () => sendPushToUser() }));
vi.mock("@/lib/fcm", () => ({ sendFcmActivityToUser: () => sendFcmActivityToUser() }));
vi.mock("@/lib/error-tracking", () => ({ captureError: () => captureError() }));

const { announceLiveStream, sweepUnannouncedLiveStreams } = await import("@/lib/live-stream-announce");

beforeEach(() => {
  streams = [];
  members = [];
  lockKeys.length = 0;
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("announceLiveStream", () => {
  it("invites the one person, pushes once, and is a no-op the second time", async () => {
    streams = [stream({ targetUserId: "ctarget0000001" })];
    expect(await announceLiveStream("cls00000000001")).toBe("announced");
    expect(notificationCreate).toHaveBeenCalledTimes(1);
    expect(sendPushToUser).toHaveBeenCalledTimes(1);
    expect(sendFcmActivityToUser).toHaveBeenCalledTimes(1);
    expect(streams[0].announcedAt).toBeInstanceOf(Date);
    expect(lockKeys).toEqual(["live-announce:cls00000000001"]);

    expect(await announceLiveStream("cls00000000001")).toBe("skipped");
    expect(notificationCreate).toHaveBeenCalledTimes(1);
    expect(sendPushToUser).toHaveBeenCalledTimes(1);
  });

  it("tells a Circle's members (not the host) in batches", async () => {
    streams = [stream({ circleId: "ccircle0000001" })];
    members = ["chost000000001", ...Array.from({ length: 1500 }, (_, i) => `cm${i}`)];
    expect(await announceLiveStream("cls00000000001")).toBe("announced");
    expect(notificationCreateMany).toHaveBeenCalledTimes(2);
    const rows = notificationCreateMany.mock.calls.flatMap((c) => (c[0] as { data: { recipientId: string }[] }).data);
    expect(rows).toHaveLength(1500);
    expect(rows.some((r) => r.recipientId === "chost000000001")).toBe(false);
    expect(sendPushToUser).not.toHaveBeenCalled();
  });

  it("tells an Everyone stream's subscribers inside the same transaction", async () => {
    streams = [stream()];
    expect(await announceLiveStream("cls00000000001")).toBe("announced");
    expect(notifySubscribers).toHaveBeenCalledWith(
      "chost000000001",
      "SUBSCRIPTION_LIVE",
      { liveStreamId: "cls00000000001" },
      { db: tx },
    );
  });

  it("a failure never throws, rolls back, sends no push, and leaves it for the retry", async () => {
    streams = [stream({ targetUserId: "ctarget0000001" })];
    notificationCreate.mockRejectedValueOnce(new Error("pool timeout"));
    expect(await announceLiveStream("cls00000000001")).toBe("failed");
    expect(streams[0].announcedAt).toBeNull();
    expect(sendPushToUser).not.toHaveBeenCalled();
    expect(captureError).toHaveBeenCalledTimes(1);

    expect(await announceLiveStream("cls00000000001")).toBe("announced");
    expect(sendPushToUser).toHaveBeenCalledTimes(1);
  });

  it("skips a stream that ended or never got a room", async () => {
    streams = [stream({ status: "ENDED" }), stream({ id: "cls00000000002", roomName: "" })];
    expect(await announceLiveStream("cls00000000001")).toBe("skipped");
    expect(await announceLiveStream("cls00000000002")).toBe("skipped");
    expect(await announceLiveStream("cmissing000001")).toBe("skipped");
    expect(notifySubscribers).not.toHaveBeenCalled();
  });
});

describe("sweepUnannouncedLiveStreams", () => {
  it("retries due streams, leaves fresh ones to the normal path, and expires old ones silently", async () => {
    const now = new Date("2026-11-12T12:00:00Z");
    streams = [
      stream({ id: "cfresh00000001", startedAt: new Date(now.getTime() - 5_000) }),
      stream({ id: "cdue0000000001", startedAt: new Date(now.getTime() - 60_000) }),
      stream({ id: "cold0000000001", startedAt: new Date(now.getTime() - 60 * 60_000) }),
      stream({ id: "cdone000000001", startedAt: new Date(now.getTime() - 60_000), announcedAt: now }),
    ];
    const result = await sweepUnannouncedLiveStreams(now);
    expect(result).toEqual({ announced: 1, expired: 1 });
    expect(notifySubscribers).toHaveBeenCalledTimes(1);
    expect(streams.find((s) => s.id === "cfresh00000001")?.announcedAt).toBeNull();
    expect(streams.find((s) => s.id === "cold0000000001")?.announcedAt).toEqual(now);
  });
});
