import { beforeEach, describe, expect, it, vi } from "vitest";

// fileReport / resolveReport (actions/reports.ts) against a mocked database: whom a report is about is derived on
// the server from the target (src/lib/report-target.ts), never taken from the form, so nobody can "frame" a third
// person by filing a report on someone else's content against them.

const ME = "cme00000000001";
const AUTHOR = "cau00000000001";
const VICTIM = "cvi00000000001";
const ADMIN_USER = "cad00000000001";
const SUSPENDED_USER = "csu00000000001";

const POST_PUBLIC = "cpo00000000001";
const POST_HIDDEN = "cpo00000000002"; // e.g. a PRIVATE Circle's post the reporter isn't in
const POST_MINE = "cpo00000000003";
const COMMENT = "ccm00000000001";
const COMMENT_ON_HIDDEN = "ccm00000000002";
const COMMENT_FLAGGED = "ccm00000000003";
const MESSAGE = "cms00000000001";
const MESSAGE_ELSEWHERE = "cms00000000002";
const CONV_MINE = "ccv00000000001";
const CONV_OTHERS = "ccv00000000002";
const CIRCLE_PUBLIC = "cci00000000001";
const CIRCLE_PRIVATE = "cci00000000002";
const COLLAB_PUBLIC = "ccl00000000001";
const COLLAB_PRIVATE = "ccl00000000002";
const MISSING = "cmi00000000001";

const reporter = { id: ME, name: "Me", isAdmin: false };
const admin = { id: ADMIN_USER, name: "Admin", isAdmin: true };

let rateLimited = false;
const reportCreate = vi.fn();
const reportUpdate = vi.fn();
const userUpdate = vi.fn();
const auditCreate = vi.fn();
const executeRaw = vi.fn();
const recomputeTrustScore = vi.fn();
let openReports: { reporterId: string; targetType: string; targetId: string }[] = [];
let storedReport: Record<string, unknown> | null = null;

type PostFx = { id: string; authorId: string; visibleTo: string[] };
const posts: PostFx[] = [
  { id: POST_PUBLIC, authorId: AUTHOR, visibleTo: [ME] },
  { id: POST_HIDDEN, authorId: AUTHOR, visibleTo: [] },
  { id: POST_MINE, authorId: ME, visibleTo: [ME] },
];
const comments = [
  { id: COMMENT, postId: POST_PUBLIC, authorId: AUTHOR, moderationStatus: "PUBLISHED" },
  { id: COMMENT_ON_HIDDEN, postId: POST_HIDDEN, authorId: AUTHOR, moderationStatus: "PUBLISHED" },
  { id: COMMENT_FLAGGED, postId: POST_PUBLIC, authorId: AUTHOR, moderationStatus: "FLAGGED" },
];
const messages = [
  { id: MESSAGE, senderId: AUTHOR, conversationId: CONV_MINE },
  { id: MESSAGE_ELSEWHERE, senderId: AUTHOR, conversationId: CONV_OTHERS },
];
const conversationMembers = [
  { conversationId: CONV_MINE, userId: ME },
  { conversationId: CONV_MINE, userId: AUTHOR },
  { conversationId: CONV_OTHERS, userId: AUTHOR },
  { conversationId: CONV_OTHERS, userId: VICTIM },
];
const circles = [
  { id: CIRCLE_PUBLIC, visibility: "PUBLIC", createdById: AUTHOR },
  { id: CIRCLE_PRIVATE, visibility: "PRIVATE", createdById: AUTHOR },
];
const collabs = [
  { id: COLLAB_PUBLIC, visibility: "PUBLIC", authorId: AUTHOR },
  { id: COLLAB_PRIVATE, visibility: "PRIVATE", authorId: AUTHOR },
];
const users = [
  { id: AUTHOR, status: "ACTIVE", name: "Author", isAdmin: false, isGuestPreview: false },
  { id: VICTIM, status: "ACTIVE", name: "Victim", isAdmin: false, isGuestPreview: false },
  { id: ME, status: "ACTIVE", name: "Me", isAdmin: false, isGuestPreview: false },
  { id: ADMIN_USER, status: "ACTIVE", name: "Admin", isAdmin: true, isGuestPreview: false },
  { id: SUSPENDED_USER, status: "SUSPENDED", name: "Gone", isAdmin: false, isGuestPreview: false },
];

type Visible = { visibleFor: string };

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth-guards", () => ({
  requireVerifiedUser: async () => reporter,
  requireAdmin: async () => admin,
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => !rateLimited }));
vi.mock("@/lib/trust", () => ({ recomputeTrustScore: (id: string) => recomputeTrustScore(id) }));
vi.mock("@/lib/content-moderation", () => ({
  removeModeratedContent: vi.fn(async () => null),
  cleanUpModeratedMedia: vi.fn(),
}));
vi.mock("@/lib/cloudflare-stream", () => ({ deleteStreamVideo: vi.fn() }));
vi.mock("@/lib/ambient-access", () => ({ activeWidgetTokensOf: (userId: string) => ({ where: { userId } }) }));
vi.mock("@/lib/post-visibility", () => ({
  getVisiblePostsWhere: async (viewerId: string): Promise<Visible> => ({ visibleFor: viewerId }),
}));
vi.mock("@/lib/circle-invite-data", () => ({ loadStandingCircleInvites: async () => new Map() }));
vi.mock("@/lib/collab-invites-server", () => ({ loadStandingCollabInvite: async () => null }));
vi.mock("@/lib/collab-permissions", () => ({
  canViewCollab: (
    collab: { authorId: string; visibility: string },
    isParticipant: boolean,
    user: { id: string; isAdmin: boolean },
    hasInvite: boolean,
  ) => collab.visibility === "PUBLIC" || collab.authorId === user.id || isParticipant || hasInvite || user.isAdmin,
}));

function postVisible(id: string, visible: Visible) {
  return posts.find((p) => p.id === id && p.visibleTo.includes(visible.visibleFor)) ?? null;
}

vi.mock("@/lib/prisma", () => {
  const prisma = {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => users.find((u) => u.id === where.id) ?? null,
      update: (...a: unknown[]) => userUpdate(...a),
    },
    post: {
      findFirst: async ({ where }: { where: { AND: [{ id: string }, Visible] } }) => {
        const post = postVisible(where.AND[0].id, where.AND[1]);
        return post ? { authorId: post.authorId } : null;
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const post = posts.find((p) => p.id === where.id);
        return post ? { authorId: post.authorId } : null;
      },
    },
    comment: {
      findFirst: async ({ where }: { where: { id: string; moderationStatus: string; post: Visible } }) => {
        const c = comments.find((x) => x.id === where.id && x.moderationStatus === where.moderationStatus);
        return c && postVisible(c.postId, where.post) ? { authorId: c.authorId } : null;
      },
    },
    message: {
      findUnique: async ({ where }: { where: { id: string } }) => messages.find((m) => m.id === where.id) ?? null,
    },
    conversationMember: {
      findUnique: async ({
        where,
      }: {
        where: { conversationId_userId: { conversationId: string; userId: string } };
      }) =>
        conversationMembers.some(
          (m) =>
            m.conversationId === where.conversationId_userId.conversationId &&
            m.userId === where.conversationId_userId.userId,
        )
          ? { id: "member" }
          : null,
    },
    circle: {
      findUnique: async ({ where }: { where: { id: string } }) => circles.find((c) => c.id === where.id) ?? null,
    },
    circleMembership: { findUnique: async () => null },
    collabBoardPost: {
      findUnique: async ({ where }: { where: { id: string } }) => collabs.find((c) => c.id === where.id) ?? null,
    },
    collabParticipant: { findFirst: async () => null },
    report: {
      findFirst: async ({ where }: { where: { reporterId: string; targetType: string; targetId: string } }) =>
        openReports.find(
          (r) => r.reporterId === where.reporterId && r.targetType === where.targetType && r.targetId === where.targetId,
        )
          ? { id: "existing" }
          : null,
      findUnique: async () => storedReport,
      create: (...a: unknown[]) => reportCreate(...a),
      update: (...a: unknown[]) => reportUpdate(...a),
    },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
    ambientWidgetToken: { updateMany: vi.fn() },
    $executeRaw: (...a: unknown[]) => executeRaw(...a),
    $transaction: async (arg: unknown): Promise<unknown> =>
      typeof arg === "function" ? arg(prisma) : Promise.all(arg as unknown[]),
  };
  return { prisma };
});

const { fileReport, resolveReport } = await import("./reports");

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ reason: "This is clearly abusive content.", ...fields })) fd.set(k, v);
  return fd;
}

function createdReport() {
  expect(reportCreate).toHaveBeenCalledTimes(1);
  return (reportCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimited = false;
  openReports = [];
  storedReport = null;
});

describe("fileReport: the accused is derived on the server", () => {
  it("ignores a client-supplied reportedUserId (the framing attempt)", async () => {
    const result = await fileReport(form({ targetType: "POST", targetId: POST_PUBLIC, reportedUserId: VICTIM }));
    expect(result).toEqual({ error: null });
    const data = createdReport();
    expect(data.reportedUserId).toBe(AUTHOR);
    expect(data.reporterId).toBe(ME);
    expect(JSON.stringify(data)).not.toContain(VICTIM);
  });

  it("can't frame through a USER report either: the profile reported is the one accused", async () => {
    await fileReport(form({ targetType: "USER", targetId: AUTHOR, reportedUserId: VICTIM }));
    expect(createdReport().reportedUserId).toBe(AUTHOR);
  });

  it.each([
    ["POST", POST_PUBLIC],
    ["COMMENT", COMMENT],
    ["MESSAGE", MESSAGE],
    ["CIRCLE", CIRCLE_PUBLIC],
    ["COLLAB_POST", COLLAB_PUBLIC],
    ["USER", AUTHOR],
  ])("%s: accuses the author/sender/creator", async (targetType, targetId) => {
    const result = await fileReport(form({ targetType, targetId }));
    expect(result).toEqual({ error: null });
    expect(createdReport()).toMatchObject({ targetType, targetId, reportedUserId: AUTHOR, reporterId: ME });
  });

  it.each([
    ["a post that doesn't exist", "POST", MISSING],
    ["a post the reporter can't see", "POST", POST_HIDDEN],
    ["the reporter's own post", "POST", POST_MINE],
    ["a comment on a post the reporter can't see", "COMMENT", COMMENT_ON_HIDDEN],
    ["a comment that isn't published", "COMMENT", COMMENT_FLAGGED],
    ["a message in a chat the reporter isn't in", "MESSAGE", MESSAGE_ELSEWHERE],
    ["a PRIVATE Circle the reporter isn't in", "CIRCLE", CIRCLE_PRIVATE],
    ["a PRIVATE collab the reporter can't view", "COLLAB_POST", COLLAB_PRIVATE],
    ["themselves", "USER", ME],
    ["a site admin (invisible profile)", "USER", ADMIN_USER],
    ["a suspended account (no profile)", "USER", SUSPENDED_USER],
    ["a user that doesn't exist", "USER", MISSING],
  ])("refuses %s", async (_label, targetType, targetId) => {
    const result = await fileReport(form({ targetType, targetId, reportedUserId: VICTIM }));
    expect(result).toEqual({ error: "invalid" });
    expect(reportCreate).not.toHaveBeenCalled();
  });

  it("keeps the secret-chat evidence text for a MESSAGE report only", async () => {
    await fileReport(form({ targetType: "MESSAGE", targetId: MESSAGE, evidenceText: "  the decrypted text  " }));
    expect(createdReport().evidenceText).toBe("the decrypted text");
    reportCreate.mockClear();
    await fileReport(form({ targetType: "POST", targetId: POST_PUBLIC, evidenceText: "made up" }));
    expect(createdReport().evidenceText).toBeUndefined();
  });

  it("de-duplicates: a second report by the same reporter on the same target adds nothing", async () => {
    openReports = [{ reporterId: ME, targetType: "POST", targetId: POST_PUBLIC }];
    const result = await fileReport(form({ targetType: "POST", targetId: POST_PUBLIC }));
    expect(result).toEqual({ error: null });
    expect(reportCreate).not.toHaveBeenCalled();
    // Taken under a per-(reporter, target) advisory lock, so two submissions at once can't both insert.
    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(executeRaw.mock.calls[0]).toContain(`report:${ME}:POST:${POST_PUBLIC}`);
  });

  it("another reporter's open report on the same target doesn't block a new one", async () => {
    openReports = [{ reporterId: VICTIM, targetType: "POST", targetId: POST_PUBLIC }];
    await fileReport(form({ targetType: "POST", targetId: POST_PUBLIC }));
    expect(reportCreate).toHaveBeenCalledTimes(1);
  });

  it("is rate limited before anything is looked up", async () => {
    rateLimited = true;
    expect(await fileReport(form({ targetType: "POST", targetId: POST_PUBLIC }))).toEqual({ error: "rate_limited" });
    expect(reportCreate).not.toHaveBeenCalled();
  });
});

describe("resolveReport acts on the content's real author", () => {
  it("a report stored with a framed reportedUserId suspends the author, not the victim, and corrects the row", async () => {
    storedReport = {
      id: "crp00000000001",
      targetType: "POST",
      targetId: POST_PUBLIC,
      reportedUserId: VICTIM,
    };
    const fd = new FormData();
    fd.set("reportId", "crp00000000001");
    fd.set("action", "SUSPEND");
    fd.set("note", "Abusive post, confirmed.");
    expect(await resolveReport(fd)).toEqual({ error: null });

    expect(userUpdate).toHaveBeenCalledTimes(1);
    expect(userUpdate.mock.calls[0][0]).toMatchObject({ where: { id: AUTHOR } });
    expect(auditCreate.mock.calls[0][0]).toMatchObject({ data: { targetId: AUTHOR, action: "SUSPEND" } });
    expect(reportUpdate.mock.calls[0][0]).toMatchObject({ data: { reportedUserId: AUTHOR, status: "RESOLVED" } });
    // Both trust scores are recomputed: the author's goes down, the victim's stops counting this report.
    expect(recomputeTrustScore).toHaveBeenCalledWith(AUTHOR);
    expect(recomputeTrustScore).toHaveBeenCalledWith(VICTIM);
    expect(JSON.stringify(userUpdate.mock.calls)).not.toContain(VICTIM);
  });
});
