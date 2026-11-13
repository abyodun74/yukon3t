import { beforeEach, describe, expect, it, vi } from "vitest";

// Challenge actions (app/actions/challenges.ts) against an in-memory database: the gate refuses non-admins everywhere;
// a Circle's challenges are for its members (a PRIVATE Circle never leaks); only the owner / co-admins run them, only
// the stream's host on a live stream; blocks are respected; the fail-closed limiters are wired; every result change
// writes its AuditLog row in the same transaction; awards are given once and taken back (never deleted) when a winner
// is removed or the challenge is cancelled or reversed by a moderator.

const ME = "cme00000000001";
const OWNER = "cowner00000001";
const ALICE = "calice00000001";
const BOB = "cbob0000000001";
const CAROL = "ccarol00000001";
const CIRCLE = "ccircle0000001";
const STREAM = "cstream0000001";
const CH = "cchal000000001";

const OLD = new Date("2026-01-01T00:00:00Z");

type Ch = {
  id: string;
  title: string;
  description: string | null;
  status: "OPEN" | "DECIDED" | "CANCELLED";
  hostId: string | null;
  circleId: string | null;
  liveStreamId: string | null;
  createdAt: Date;
  decidedAt: Date | null;
  decidedById: string | null;
  editableUntil: Date | null;
  cancelledAt: Date | null;
  cancelledById: string | null;
  cancelledByAdmin: boolean;
};

let user: Record<string, unknown>;
let circles: Record<string, { id: string; slug: string; createdById: string; visibility: string }>;
let memberships: Record<string, string>; // `${circleId}:${userId}` -> role
let streams: Record<string, { id: string; hostId: string; status: string; circleId: string | null; targetUserId: string | null }>;
let viewers: Record<string, { role: string; joinedAt: Date }>; // `${streamId}:${userId}`
let challenges: Record<string, Ch>;
let participants: { challengeId: string; userId: string }[];
let winners: { id: string; challengeId: string; userId: string; awardSendId: string | null; createdAt: Date }[];
let notifications: Record<string, unknown>[];
let auditLogs: Record<string, unknown>[];
let blocks: [string, string][];
let inTransaction: boolean;
let auditInTransaction: boolean[];
const limits: Record<string, boolean> = {};
let flagged: boolean;

const checkRateLimit = vi.fn(async (name: string, key: string) => {
  void key;
  return limits[name] ?? true;
});
const publishEvent = vi.fn();
const createChampionAwardsInTx = vi.fn(async (_tx: unknown, _id: string, rows: { id: string; userId: string }[]) => {
  for (const row of rows) {
    const w = winners.find((x) => x.id === row.id)!;
    w.awardSendId = `send-${row.id}`;
  }
  return rows.map((r) => `purchase-${r.id}`);
});
const deliverChallengeAwards = vi.fn();
const pushChallengeResult = vi.fn();
const revokeGiftSend = vi.fn(async (_tx: unknown, sendId: string) => ({ senderId: null, recipientId: sendId }));
const giftPurchaseUpdateMany = vi.fn(async () => ({ count: 0 }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth-guards", () => ({ requireVerifiedUser: async () => user, requireUser: async () => user }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (name: string, key: string) => checkRateLimit(name, key) }));
vi.mock("@/lib/moderation", () => ({ moderateText: async () => ({ allowed: !flagged, flaggedCategories: [] }) }));
vi.mock("@/lib/realtime-server", () => ({ publishEvent: (...a: unknown[]) => publishEvent(...a) }));
vi.mock("@/lib/live-stream-access", () => ({
  canAccessLiveStream: async (s: { hostId: string; targetUserId: string | null }, u: { id: string }) =>
    s.hostId === u.id || !s.targetUserId || s.targetUserId === u.id,
}));
vi.mock("@/lib/challenge-awards", () => ({
  createChampionAwardsInTx: (tx: unknown, id: string, rows: { id: string; userId: string }[]) => createChampionAwardsInTx(tx, id, rows),
  deliverChallengeAwards: (...a: unknown[]) => deliverChallengeAwards(...a),
  pushChallengeResult: (...a: unknown[]) => pushChallengeResult(...a),
}));
vi.mock("@/lib/gift-revoke", () => ({ revokeGiftSend: (_tx: unknown, id: string) => revokeGiftSend(_tx, id) }));
vi.mock("@/lib/media-cleanup", () => ({ deleteMediaIfUnreferenced: vi.fn() }));
vi.mock("@/lib/comment-count", () => ({ countPublishedInThread: vi.fn() }));

const blockedWith = (a: string, b: string) => blocks.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

function challengeShape(ch: Ch, select: Record<string, unknown> | undefined) {
  const parts = participants.filter((p) => p.challengeId === ch.id);
  const wins = winners.filter((w) => w.challengeId === ch.id);
  const participantSelect = select?.participants as { where?: { userId?: string } } | undefined;
  const scopedParts = participantSelect?.where?.userId ? parts.filter((p) => p.userId === participantSelect.where!.userId) : parts;
  return {
    ...ch,
    circle: ch.circleId ? circles[ch.circleId] : null,
    liveStream: ch.liveStreamId ? streams[ch.liveStreamId] : null,
    _count: { participants: parts.length, winners: wins.length },
    participants: scopedParts.map((p) => ({ id: `${p.challengeId}:${p.userId}`, userId: p.userId, user: { id: p.userId, name: p.userId } })),
    winners: wins.map((w) => ({ id: w.id, userId: w.userId, awardSendId: w.awardSendId, user: { id: w.userId, name: w.userId } })),
  };
}

function matchesChallengeWhere(ch: Ch, where: Record<string, unknown>): boolean {
  if (where.AND) return (where.AND as Record<string, unknown>[]).every((w) => matchesChallengeWhere(ch, w));
  if (where.OR) return (where.OR as Record<string, unknown>[]).some((w) => matchesChallengeWhere(ch, w));
  for (const [key, value] of Object.entries(where)) {
    if (key === "status") {
      if (typeof value === "string" ? ch.status !== value : !(value as { in?: string[] }).in?.includes(ch.status)) return false;
    } else if (key === "hostId" && value && typeof value === "object") {
      if ((value as { notIn: string[] }).notIn.includes(ch.hostId ?? "")) return false;
    } else if (key === "decidedAt" || key === "cancelledAt") {
      const at = ch[key as "decidedAt"];
      if (!at || at < (value as { gte: Date }).gte) return false;
    } else if ((ch as Record<string, unknown>)[key] !== value) return false;
  }
  return true;
}

vi.mock("@/lib/prisma", () => {
  const prisma: Record<string, unknown> = {
    circle: { findUnique: async ({ where }: { where: { id: string } }) => circles[where.id] ?? null },
    circleMembership: {
      findUnique: async ({ where }: { where: { userId_circleId: { userId: string; circleId: string } } }) => {
        const role = memberships[`${where.userId_circleId.circleId}:${where.userId_circleId.userId}`];
        return role ? { role } : null;
      },
    },
    liveStream: { findUnique: async ({ where }: { where: { id: string } }) => streams[where.id] ?? null },
    liveStreamViewer: {
      findUnique: async ({ where }: { where: { liveStreamId_userId: { liveStreamId: string; userId: string } } }) =>
        viewers[`${where.liveStreamId_userId.liveStreamId}:${where.liveStreamId_userId.userId}`] ?? null,
    },
    block: {
      findFirst: async ({ where }: { where: { OR: { blockerId: string; blockedId: string }[] } }) =>
        blockedWith(where.OR[0].blockerId, where.OR[0].blockedId) ? { id: "b" } : null,
      findMany: async ({ where }: { where: { OR: { blockerId?: string; blockedId?: string }[] } }) => {
        const me = where.OR[0].blockerId!;
        return blocks.filter(([a, b]) => a === me || b === me).map(([a, b]) => ({ blockerId: a, blockedId: b }));
      },
    },
    challenge: {
      findUnique: async ({ where, select }: { where: { id: string }; select?: Record<string, unknown> }) =>
        challenges[where.id] ? challengeShape(challenges[where.id], select) : null,
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        Object.values(challenges)
          .filter((ch) => matchesChallengeWhere(ch, where))
          .map((ch) => challengeShape(ch, undefined)),
      count: async ({ where }: { where: Record<string, unknown> }) =>
        Object.values(challenges).filter((ch) => matchesChallengeWhere(ch, where)).length,
      create: async ({ data }: { data: Partial<Ch> }) => {
        const id = `cnew${Object.keys(challenges).length}`.padEnd(14, "0");
        challenges[id] = {
          id,
          title: "",
          description: null,
          status: "OPEN",
          hostId: null,
          circleId: null,
          liveStreamId: null,
          createdAt: new Date(),
          decidedAt: null,
          decidedById: null,
          editableUntil: null,
          cancelledAt: null,
          cancelledById: null,
          cancelledByAdmin: false,
          ...data,
        } as Ch;
        return { id };
      },
      updateMany: async ({ where, data }: { where: { id: string; status: string | { not: string } }; data: Partial<Ch> }) => {
        const ch = challenges[where.id];
        const ok =
          ch && (typeof where.status === "string" ? ch.status === where.status : ch.status !== where.status.not);
        if (!ok) return { count: 0 };
        Object.assign(ch, data);
        return { count: 1 };
      },
    },
    challengeParticipant: {
      create: async ({ data }: { data: { challengeId: string; userId: string } }) => {
        participants.push(data);
        return { id: "p" };
      },
      deleteMany: async ({ where }: { where: { challengeId: string; userId: string; challenge: { status: string } } }) => {
        if (challenges[where.challengeId]?.status !== where.challenge.status) return { count: 0 };
        const before = participants.length;
        participants = participants.filter((p) => !(p.challengeId === where.challengeId && p.userId === where.userId));
        return { count: before - participants.length };
      },
    },
    challengeWinner: {
      create: async ({ data }: { data: { challengeId: string; userId: string } }) => {
        const row = { id: `w-${data.userId}`, awardSendId: null, createdAt: new Date(), ...data };
        winners.push(row);
        return { id: row.id, userId: row.userId };
      },
      delete: async ({ where }: { where: { id: string } }) => {
        winners = winners.filter((w) => w.id !== where.id);
        return {};
      },
      findMany: async ({ where }: { where: { userId: { in: string[] }; challengeId: { not: string }; challenge: { decidedById: string } } }) =>
        winners
          .filter(
            (w) =>
              where.userId.in.includes(w.userId) &&
              w.challengeId !== where.challengeId.not &&
              challenges[w.challengeId]?.decidedById === where.challenge.decidedById &&
              challenges[w.challengeId]?.status === "DECIDED",
          )
          .map((w) => ({ userId: w.userId })),
    },
    notification: {
      createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
        notifications.push(...data);
        return { count: data.length };
      },
      deleteMany: async ({ where }: { where: { challengeId: string; recipientId?: { in: string[] } } }) => {
        notifications = notifications.filter(
          (n) => !(n.challengeId === where.challengeId && (!where.recipientId || where.recipientId.in.includes(n.recipientId as string))),
        );
        return { count: 0 };
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditLogs.push(data);
        auditInTransaction.push(inTransaction);
        return { id: "a" };
      },
    },
    giftPurchase: { updateMany: (...a: unknown[]) => giftPurchaseUpdateMany(...(a as [])) },
    $executeRaw: async () => 0,
  };
  prisma.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => {
    inTransaction = true;
    try {
      return await fn(prisma);
    } finally {
      inTransaction = false;
    }
  };
  return { prisma };
});

import {
  cancelChallenge,
  createChallenge,
  declareChallengeWinners,
  editChallengeWinners,
  getLiveChallengeMoments,
  joinChallenge,
  leaveChallenge,
  listCircleChallenges,
  listLiveChallenges,
} from "@/app/actions/challenges";
import { removeModeratedContent } from "@/lib/content-moderation";

function challenge(over: Partial<Ch> = {}): Ch {
  return {
    id: CH,
    title: "Best trick shot",
    description: null,
    status: "OPEN",
    hostId: OWNER,
    circleId: CIRCLE,
    liveStreamId: null,
    createdAt: new Date(),
    decidedAt: null,
    decidedById: null,
    editableUntil: null,
    cancelledAt: null,
    cancelledById: null,
    cancelledByAdmin: false,
    ...over,
  };
}

const as = (id: string, over: Record<string, unknown> = {}) => {
  user = { id, name: id, isAdmin: true, isGuestPreview: false, createdAt: OLD, lastSeenAt: new Date(), ...over };
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(limits)) delete limits[k];
  flagged = false;
  inTransaction = false;
  auditInTransaction = [];
  as(OWNER);
  circles = { [CIRCLE]: { id: CIRCLE, slug: "runners", createdById: OWNER, visibility: "PRIVATE" } };
  memberships = { [`${CIRCLE}:${OWNER}`]: "OWNER", [`${CIRCLE}:${ME}`]: "MEMBER", [`${CIRCLE}:${ALICE}`]: "MEMBER", [`${CIRCLE}:${BOB}`]: "MEMBER" };
  streams = { [STREAM]: { id: STREAM, hostId: OWNER, status: "LIVE", circleId: null, targetUserId: null } };
  viewers = {};
  challenges = { [CH]: challenge() };
  participants = [
    { challengeId: CH, userId: ALICE },
    { challengeId: CH, userId: BOB },
  ];
  winners = [];
  notifications = [];
  auditLogs = [];
  blocks = [];
});

describe("the gate", () => {
  it("refuses every action for someone challenges aren't on for, before reading anything", async () => {
    as(ME, { isAdmin: false });
    const answers = await Promise.all([
      listCircleChallenges(CIRCLE),
      listLiveChallenges(STREAM),
      getLiveChallengeMoments(STREAM),
      createChallenge({ place: { context: "CIRCLE", circleId: CIRCLE }, title: "x" }),
      joinChallenge(CH),
      leaveChallenge(CH),
      declareChallengeWinners(CH, [ALICE]),
      editChallengeWinners(CH, [ALICE]),
      cancelChallenge(CH),
    ]);
    for (const answer of answers) expect(answer).toEqual({ error: "disabled" });
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(participants).toHaveLength(2);
    expect(auditLogs).toEqual([]);
  });

  it("refuses the guest identity even when it is flagged admin", async () => {
    as(ME, { isGuestPreview: true });
    expect(await listCircleChallenges(CIRCLE)).toEqual({ error: "disabled" });
  });
});

describe("listing", () => {
  it("is for the Circle's members only: a PRIVATE Circle's challenges never reach anyone else (site admins included)", async () => {
    as(CAROL); // a site admin, not a member
    expect(await listCircleChallenges(CIRCLE)).toEqual({ error: "unavailable" });
    as(ME);
    const ok = await listCircleChallenges(CIRCLE);
    expect(ok.error).toBeNull();
    if (ok.error === null) {
      expect(ok.challenges.map((c) => c.id)).toEqual([CH]);
      expect(ok.canCreate).toBe(false);
      expect(JSON.stringify(ok)).not.toMatch(/email|passwordHash|birthDate/);
    }
  });

  it("hides challenges whose host is blocked either way with the viewer, and blocked participants' names", async () => {
    as(ME);
    blocks = [[OWNER, ME]];
    const hidden = await listCircleChallenges(CIRCLE);
    expect(hidden.error === null && hidden.challenges).toEqual([]);
    blocks = [[ALICE, ME]];
    const shown = await listCircleChallenges(CIRCLE);
    expect(shown.error === null && shown.challenges[0].participants.map((p) => p.id)).toEqual([BOB]);
    expect(shown.error === null && shown.challenges[0].participantCount).toBe(2);
  });

  it("lets the owner start one", async () => {
    const ok = await listCircleChallenges(CIRCLE);
    expect(ok.error === null && ok.canCreate).toBe(true);
  });
});

describe("creating", () => {
  const place = { context: "CIRCLE" as const, circleId: CIRCLE };

  it("lets the owner or a co-admin create one, never a plain member", async () => {
    as(ME);
    expect(await createChallenge({ place, title: "Cup" })).toEqual({ error: "forbidden" });
    memberships[`${CIRCLE}:${ME}`] = "MODERATOR";
    expect((await createChallenge({ place, title: "Cup" })).error).toBeNull();
    as(OWNER);
    const made = await createChallenge({ place, title: "  Fastest   lap ", description: "On the track" });
    expect(made.error).toBeNull();
    const row = Object.values(challenges).find((c) => c.title === "Fastest lap")!;
    expect(row).toMatchObject({ hostId: OWNER, circleId: CIRCLE, liveStreamId: null, status: "OPEN", description: "On the track" });
  });

  it("needs a 7-day-old account, wires the fail-closed limiter, and moderates the text", async () => {
    as(OWNER, { createdAt: new Date() });
    expect(await createChallenge({ place, title: "Cup" })).toEqual({ error: "too_new" });
    as(OWNER);
    limits.challengeCreate = false;
    expect(await createChallenge({ place, title: "Cup" })).toEqual({ error: "rate_limited" });
    expect(checkRateLimit).toHaveBeenCalledWith("challengeCreate", OWNER);
    limits.challengeCreate = true;
    flagged = true;
    expect(await createChallenge({ place, title: "Cup" })).toEqual({ error: "moderation" });
    flagged = false;
    expect(await createChallenge({ place, title: "x".repeat(81) })).toEqual({ error: "title_too_long" });
  });

  it("caps open challenges at 5 per host and per Circle", async () => {
    for (let i = 0; i < 4; i++) challenges[`cextra${i}`.padEnd(14, "0")] = challenge({ id: `cextra${i}`.padEnd(14, "0") });
    expect(await createChallenge({ place, title: "Sixth" })).toEqual({ error: "too_many_open" });
  });

  it("on a live stream: its host only, while it is live, and the room is signalled", async () => {
    as(ME);
    expect(await createChallenge({ place: { context: "LIVE", liveStreamId: STREAM }, title: "Cup" })).toEqual({ error: "forbidden" });
    as(OWNER);
    expect((await createChallenge({ place: { context: "LIVE", liveStreamId: STREAM }, title: "Cup" })).error).toBeNull();
    expect(publishEvent).toHaveBeenCalledWith(`live-stream:${STREAM}`, "changed", { kind: "challenge" });
    streams[STREAM].status = "ENDED";
    expect(await createChallenge({ place: { context: "LIVE", liveStreamId: STREAM }, title: "Cup" })).toEqual({ error: "forbidden" });
  });
});

describe("joining and leaving", () => {
  it("lets a member join once, never the host, never across a block with the host; 30 a day", async () => {
    as(ME);
    expect(await joinChallenge(CH)).toEqual({ error: null });
    expect(participants.filter((p) => p.userId === ME)).toHaveLength(1);
    expect(await joinChallenge(CH)).toEqual({ error: null });
    expect(participants.filter((p) => p.userId === ME)).toHaveLength(1);
    expect(checkRateLimit).toHaveBeenCalledWith("challengeJoin", ME);
    as(OWNER);
    expect(await joinChallenge(CH)).toEqual({ error: "host" });
    as(ME);
    participants = participants.filter((p) => p.userId !== ME);
    blocks = [[OWNER, ME]];
    expect(await joinChallenge(CH)).toEqual({ error: "unavailable" });
    blocks = [];
    limits.challengeJoin = false;
    expect(await joinChallenge(CH)).toEqual({ error: "rate_limited" });
  });

  it("never lets a non-member of a PRIVATE Circle in", async () => {
    as(CAROL);
    expect(await joinChallenge(CH)).toEqual({ error: "unavailable" });
  });

  it("on a live stream: only someone in the room right now", async () => {
    challenges[CH] = challenge({ circleId: null, liveStreamId: STREAM });
    as(ME);
    expect(await joinChallenge(CH)).toEqual({ error: "not_in_stream" });
    viewers[`${STREAM}:${ME}`] = { role: "VIEWER", joinedAt: new Date() };
    expect(await joinChallenge(CH)).toEqual({ error: null });
  });

  it("can leave before the result, not after", async () => {
    as(ALICE);
    expect(await leaveChallenge(CH)).toEqual({ error: null });
    expect(participants.map((p) => p.userId)).toEqual([BOB]);
    challenges[CH].status = "DECIDED";
    as(BOB);
    expect(await leaveChallenge(CH)).toEqual({ error: "not_open" });
  });
});

describe("declaring", () => {
  it("decides: DECIDED + 24h edit window, unranked winners, one award and one bell row each, audited in the same transaction", async () => {
    const before = Date.now();
    expect(await declareChallengeWinners(CH, [ALICE])).toEqual({ error: null });
    const ch = challenges[CH];
    expect(ch.status).toBe("DECIDED");
    expect(ch.decidedById).toBe(OWNER);
    expect(ch.decidedAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(ch.editableUntil!.getTime() - ch.decidedAt!.getTime()).toBe(24 * 60 * 60_000);
    expect(winners.map((w) => w.userId)).toEqual([ALICE]);
    expect(createChampionAwardsInTx).toHaveBeenCalledTimes(1);
    expect(deliverChallengeAwards).toHaveBeenCalledWith([`purchase-w-${ALICE}`]);
    expect(notifications).toEqual([
      { recipientId: ALICE, actorId: OWNER, type: "CHALLENGE_RESULT", challengeId: CH, circleId: CIRCLE, liveStreamId: null },
    ]);
    expect(pushChallengeResult).toHaveBeenCalledWith({ declarer: user, winnerIds: [ALICE], circleSlug: "runners" });
    expect(auditLogs).toEqual([
      { targetId: OWNER, action: "CHALLENGE_DECIDED", reason: `challenge:${CH} decided winners:${ALICE}`, performedBy: OWNER },
    ]);
    expect(auditInTransaction).toEqual([true]);
    expect(checkRateLimit).toHaveBeenCalledWith("challengeDeclare", OWNER);
  });

  it("is idempotent: a second declaration of the same challenge gives nothing more", async () => {
    await declareChallengeWinners(CH, [ALICE]);
    expect(await declareChallengeWinners(CH, [ALICE])).toEqual({ error: "not_open" });
    expect(winners).toHaveLength(1);
    expect(createChampionAwardsInTx).toHaveBeenCalledTimes(1);
  });

  it("refuses: a plain member, too few participants, a non-participant, the declarer, a blocked winner", async () => {
    as(ME);
    expect(await declareChallengeWinners(CH, [ALICE])).toEqual({ error: "forbidden" });
    as(OWNER);
    participants = [{ challengeId: CH, userId: ALICE }];
    expect(await declareChallengeWinners(CH, [ALICE])).toEqual({ error: "too_few_participants" });
    participants.push({ challengeId: CH, userId: BOB });
    expect(await declareChallengeWinners(CH, [CAROL])).toEqual({ error: "not_participant" });
    participants.push({ challengeId: CH, userId: OWNER });
    expect(await declareChallengeWinners(CH, [OWNER])).toEqual({ error: "self_win" });
    blocks = [[ALICE, OWNER]];
    expect(await declareChallengeWinners(CH, [ALICE])).toEqual({ error: "unavailable" });
    expect(challenges[CH].status).toBe("OPEN");
    expect(auditLogs).toEqual([]);
  });

  it("stops farming: the same declarer can't name the same winner in more than 3 challenges in 7 days", async () => {
    for (let i = 0; i < 3; i++) {
      const id = `cpast${i}`.padEnd(14, "0");
      challenges[id] = challenge({ id, status: "DECIDED", decidedById: OWNER, decidedAt: new Date() });
      winners.push({ id: `wp${i}`, challengeId: id, userId: ALICE, awardSendId: null, createdAt: new Date() });
    }
    expect(await declareChallengeWinners(CH, [ALICE])).toEqual({ error: "farming" });
    expect(await declareChallengeWinners(CH, [BOB])).toEqual({ error: null });
  });

  it("needs a 7-day-old declarer account and the declare limiter", async () => {
    as(OWNER, { createdAt: new Date() });
    expect(await declareChallengeWinners(CH, [ALICE])).toEqual({ error: "too_new" });
    as(OWNER);
    limits.challengeDeclare = false;
    expect(await declareChallengeWinners(CH, [ALICE])).toEqual({ error: "rate_limited" });
  });
});

describe("changing the result within 24h", () => {
  beforeEach(async () => {
    participants.push({ challengeId: CH, userId: CAROL });
    await declareChallengeWinners(CH, [ALICE, BOB]);
    vi.clearAllMocks();
    auditLogs = [];
    auditInTransaction = [];
  });

  it("revokes the removed winner's award (never deletes it) and awards the added one, audited", async () => {
    expect(await editChallengeWinners(CH, [BOB, CAROL])).toEqual({ error: null });
    expect(revokeGiftSend).toHaveBeenCalledWith(expect.anything(), `send-w-${ALICE}`);
    expect(giftPurchaseUpdateMany).toHaveBeenCalledWith({
      where: { send: { id: `send-w-${ALICE}` }, status: "PENDING" },
      data: { status: "REVOKED" },
    });
    expect(winners.map((w) => w.userId).sort()).toEqual([BOB, CAROL].sort());
    expect(createChampionAwardsInTx).toHaveBeenCalledWith(expect.anything(), CH, [{ id: `w-${CAROL}`, userId: CAROL }]);
    expect(notifications.map((n) => n.recipientId).sort()).toEqual([BOB, CAROL].sort());
    expect(auditLogs).toEqual([
      {
        targetId: OWNER,
        action: "CHALLENGE_RESULT_EDITED",
        reason: `challenge:${CH} edited winners:${BOB},${CAROL} added:${CAROL} removed:${ALICE}`,
        performedBy: OWNER,
      },
    ]);
    expect(auditInTransaction).toEqual([true]);
  });

  it("is the declarer's only, and locked after 24h", async () => {
    memberships[`${CIRCLE}:${ME}`] = "MODERATOR";
    as(ME);
    expect(await editChallengeWinners(CH, [BOB])).toEqual({ error: "forbidden" });
    as(OWNER);
    challenges[CH].editableUntil = new Date(Date.now() - 1);
    expect(await editChallengeWinners(CH, [BOB])).toEqual({ error: "locked" });
    expect(await cancelChallenge(CH)).toEqual({ error: "locked" });
    expect(revokeGiftSend).not.toHaveBeenCalled();
  });

  it("cancelling within 24h revokes every award, removes the bell rows, ends the result, and is audited", async () => {
    expect(await cancelChallenge(CH)).toEqual({ error: null });
    expect(challenges[CH]).toMatchObject({ status: "CANCELLED", cancelledById: OWNER, cancelledByAdmin: false });
    expect(revokeGiftSend).toHaveBeenCalledTimes(2);
    expect(notifications).toEqual([]);
    expect(auditLogs).toEqual([
      { targetId: OWNER, action: "CHALLENGE_CANCELLED", reason: `challenge:${CH} cancelled winners:${ALICE},${BOB}`, performedBy: OWNER },
    ]);
    expect(auditInTransaction).toEqual([true]);
  });

  it("a moderator's reversal (report removal) cancels it even after the 24h, and revokes the awards", async () => {
    challenges[CH].editableUntil = new Date(Date.now() - 1);
    const removed = await removeModeratedContent("CHALLENGE", CH);
    expect(removed).toEqual({ authorId: OWNER, mediaUrlsToDelete: [] });
    expect(challenges[CH]).toMatchObject({ status: "CANCELLED", cancelledByAdmin: true, cancelledById: null });
    expect(revokeGiftSend).toHaveBeenCalledTimes(2);
    expect(notifications).toEqual([]);
  });
});

describe("the live room", () => {
  it("lists a stream's challenges for its audience, and plays a winner moment just after a result", async () => {
    challenges[CH] = challenge({ circleId: null, liveStreamId: STREAM, status: "DECIDED", decidedAt: new Date(), decidedById: OWNER });
    winners.push({ id: "w1", challengeId: CH, userId: ME, awardSendId: null, createdAt: new Date() });
    as(ME);
    const list = await listLiveChallenges(STREAM);
    expect(list.error === null && list.challenges[0].youWon).toBe(true);
    expect(list.error === null && list.canCreate).toBe(false);
    const moments = await getLiveChallengeMoments(STREAM);
    expect(moments.error === null && moments.moments).toEqual([
      { id: `${CH}:${challenges[CH].decidedAt!.getTime()}`, effect: "challenge-winner", title: "Best trick shot", winnerCount: 1, youWon: true },
    ]);
    streams[STREAM].targetUserId = CAROL;
    expect(await listLiveChallenges(STREAM)).toEqual({ error: "unavailable" });
  });
});
