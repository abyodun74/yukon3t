import { beforeEach, describe, expect, it, vi } from "vitest";
import { VIDEO_SCAN_MAX_ATTEMPTS } from "@/lib/video-scan-retry";

// The moderate-videos cron against a mocked database and Hive: a failed scan is logged with its diagnostic (one HEAD,
// failures only) and listed in the response; the give-up holds the video for an admin (FLAGGED + audit row, never the
// Stream review, nothing deleted); every claim is guarded on the retry wait being over.

type Row = Record<string, unknown>;
let posts: Row[] = [];
let comments: Row[] = [];
let muses: Row[] = [];
const moderateVideo = vi.fn();
const head = vi.fn();
const captureError = vi.fn();

function model(rows: () => Row[]) {
  return {
    findMany: vi.fn(async () => rows()),
    updateMany: vi.fn<(args: unknown) => Promise<{ count: number }>>(async () => ({ count: 1 })),
    update: vi.fn<(args: unknown) => Promise<object>>(async () => ({})),
  };
}
const db = {
  post: model(() => posts),
  comment: model(() => comments),
  muse: model(() => muses),
  auditLog: { create: vi.fn<(args: unknown) => Promise<object>>(async () => ({})) },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
};

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/cron-auth", () => ({ isCronAuthorized: () => true }));
vi.mock("@/lib/error-tracking", () => ({ captureError: (...a: unknown[]) => captureError(...a) }));
vi.mock("@/lib/video-scan-head", () => ({ headVideoForDiagnostics: (url: string) => head(url) }));
vi.mock("@/lib/hive", async (orig) => ({
  ...(await orig<typeof import("@/lib/hive")>()),
  moderateVideo: (url: string) => moderateVideo(url),
}));

const { GET } = await import("@/app/api/cron/moderate-videos/route");

const VIDEO = "https://media.example.com/muse-video/cauthor1/abc.mp4";
const REJECTED = { ok: false, failure: "rejected_media", detail: 'HTTP 413 {"code":"too_large","message":"too big"}' };

function row(id: string, over: Row = {}): Row {
  return {
    id,
    authorId: "cauthor1",
    videoUrl: VIDEO,
    postId: "cparent1",
    videoScanAttempts: 0,
    moderationStatus: "PUBLISHED",
    videoDurationSeconds: 42,
    ...over,
  };
}

async function run() {
  const res = await GET(new Request("https://x/api/cron/moderate-videos"));
  return res.json();
}

const allUpdates = () =>
  [db.post, db.comment, db.muse].flatMap((m) => m.updateMany.mock.calls.map((c) => c[0] as { where: Row; data: Row }));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "s";
  posts = [];
  comments = [];
  muses = [];
  head.mockResolvedValue({ ok: true, status: 200, contentType: "video/mp4", contentLength: 85_349_000 });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("moderate-videos cron", () => {
  it("guards every claim on the retry wait being over", async () => {
    posts = [row("cpost1")];
    comments = [row("ccomment1")];
    muses = [row("cmuse1")];
    moderateVideo.mockResolvedValue({ ok: true, flagged: false });
    await run();
    for (const m of [db.post, db.comment, db.muse]) {
      const claim = m.updateMany.mock.calls[0][0] as { where: Row };
      expect(claim.where).toMatchObject({ videoModeratedAt: null, OR: [{ videoScanRetryAt: null }, expect.anything()] });
    }
    expect(head).not.toHaveBeenCalled(); // no HEAD on a successful scan
  });

  it("logs a failed scan with size, type, duration and Hive's answer, and lists it in the response", async () => {
    muses = [row("cmuse1", { videoScanAttempts: 1 })];
    moderateVideo.mockResolvedValue(REJECTED);
    const body = await run();
    expect(head).toHaveBeenCalledTimes(1);
    expect(head).toHaveBeenCalledWith(VIDEO);
    const line = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as string;
    expect(line).toContain("muse cmuse1 (attempt 2/6; rejected_media, HTTP 413, code too_large");
    expect(line).toContain(".mp4, on media.example.com, 85.3 MB, video/mp4, 42s; next: retry");
    expect(line).not.toContain(VIDEO);
    expect(body.failures).toEqual([
      {
        kind: "muse",
        id: "cmuse1",
        status: 413,
        failure: "rejected_media",
        ext: "mp4",
        sizeMB: 85.3,
        durationS: 42,
        attempt: 2,
        outcome: "retry",
      },
    ]);
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("on give-up holds a published Muse for an admin with an audit row, never the Stream review", async () => {
    muses = [row("cmuse1", { videoScanAttempts: VIDEO_SCAN_MAX_ATTEMPTS - 1 })];
    moderateVideo.mockResolvedValue(REJECTED);
    const body = await run();
    const hold = db.muse.updateMany.mock.calls[1][0] as { where: Row; data: Row };
    expect(hold.where).toMatchObject({ id: "cmuse1", moderationStatus: { in: ["PUBLISHED", "FLAGGED"] } });
    expect(hold.data).toMatchObject({ moderationStatus: "FLAGGED", videoScanRetryAt: null });
    expect(hold.data).not.toHaveProperty("videoModeratedAt"); // stays claimed: out of Hive's queue
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: {
        targetId: "cauthor1",
        action: "CONTENT_FLAGGED_FOR_REVIEW",
        performedBy: "system:video-scan-failed-hold",
        reason: expect.stringContaining(
          "automatic video scan could not process this file (muse:cmuse1, VIDEO): Hive rejected_media, HTTP 413",
        ),
      },
    });
    for (const update of allUpdates()) expect(update.data).not.toHaveProperty("videoLongReviewNeeded");
    expect(body.muses.heldForAdmin).toBe(1);
    expect(body.failures[0].outcome).toBe("hold_for_admin");
    expect(captureError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ kind: "muse", id: "cmuse1", sizeMB: 85.3, durationS: 42, hiveStatus: 413 }),
    );
  });

  it("on give-up hides a live comment and takes it out of the post's comment count", async () => {
    comments = [row("ccomment1", { videoScanAttempts: VIDEO_SCAN_MAX_ATTEMPTS - 1 })];
    moderateVideo.mockResolvedValue(REJECTED);
    await run();
    const hold = db.comment.updateMany.mock.calls[1][0] as { where: Row; data: Row };
    expect(hold.where).toMatchObject({ id: "ccomment1", moderationStatus: "PUBLISHED" });
    expect(hold.data).toMatchObject({ moderationStatus: "FLAGGED" });
    expect(db.post.update).toHaveBeenCalledWith({ where: { id: "cparent1" }, data: { commentCount: { decrement: 1 } } });
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ reason: expect.stringContaining("(comment:ccomment1, VIDEO)") }),
    });
  });

  it("on give-up holds a post too, and writes no audit row when the claim was superseded", async () => {
    posts = [row("cpost1", { videoScanAttempts: VIDEO_SCAN_MAX_ATTEMPTS - 1 })];
    moderateVideo.mockResolvedValue(REJECTED);
    db.post.updateMany
      .mockResolvedValueOnce({ count: 1 }) // claim
      .mockResolvedValueOnce({ count: 0 }); // hold write: an admin re-stamped it meanwhile
    const body = await run();
    expect(db.auditLog.create).not.toHaveBeenCalled();
    expect(body.posts.heldForAdmin).toBe(0);
  });

  it("just stops for a removed video, with no hold", async () => {
    posts = [row("cpost1", { videoScanAttempts: VIDEO_SCAN_MAX_ATTEMPTS - 1, moderationStatus: "REMOVED" })];
    moderateVideo.mockResolvedValue(REJECTED);
    const body = await run();
    expect(db.auditLog.create).not.toHaveBeenCalled();
    expect(body.failures[0].outcome).toBe("stop");
    for (const update of allUpdates()) expect(update.data).not.toHaveProperty("moderationStatus");
  });

  it("a provider-wide failure un-claims the video, stops the run and still carries the diagnostic", async () => {
    posts = [row("cpost1"), row("cpost2")];
    moderateVideo.mockResolvedValue({ ok: false, failure: "provider_error", detail: "HTTP 500 oops" });
    const body = await run();
    expect(moderateVideo).toHaveBeenCalledTimes(1);
    expect(body.hive).toEqual({ failure: "provider_error", detail: "HTTP 500 oops" });
    expect(body.failures[0]).toMatchObject({ id: "cpost1", status: 500, outcome: "run_stopped" });
    const unclaim = db.post.updateMany.mock.calls[1][0] as { data: Row };
    expect(unclaim.data).toEqual({ videoModeratedAt: null });
  });
});
