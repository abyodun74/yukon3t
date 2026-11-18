import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VIDEO_SCAN_MAX_ATTEMPTS } from "@/lib/video-scan-retry";

// The moderate-videos cron against a mocked database and Hive's VLM: a failed scan is logged with its diagnostic (one
// HEAD, failures only) and listed in the response; the give-up holds the video for an admin (FLAGGED + audit row, never
// the Stream review, nothing deleted); an unsure verdict is held for an admin at once; a flagged one is hidden with its
// reason; every claim is guarded on the retry wait being over. Runs scan up to three videos at a time within a time
// budget, and a rate-limit / credit / key failure sets a cooldown that makes the next runs skip Hive.

type Row = Record<string, unknown>;
let posts: Row[] = [];
let comments: Row[] = [];
let muses: Row[] = [];
const moderateVideo = vi.fn();
const head = vi.fn();
const captureError = vi.fn();
let storedCooldown: unknown = null;
const writeHiveCooldown = vi.fn(async (c: unknown) => {
  storedCooldown = c;
  return "redis";
});

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
  moderateVideo: (url: string, opts?: unknown) => moderateVideo(url, opts),
}));
const sleepMs = vi.fn<(ms: number) => Promise<void>>(async () => {});
vi.mock("@/lib/video-scan-budget", async (orig) => ({
  ...(await orig<typeof import("@/lib/video-scan-budget")>()),
  sleepMs: (ms: number) => sleepMs(ms),
}));
vi.mock("@/lib/hive-cooldown-store", () => ({
  readHiveCooldown: async () => ({ cooldown: storedCooldown, store: "redis" }),
  writeHiveCooldown: (c: unknown) => writeHiveCooldown(c),
}));

const { GET } = await import("@/app/api/cron/moderate-videos/route");

const VIDEO = "https://media.example.com/muse-video/cauthor1/abc.mp4";
const REJECTED = { ok: false, failure: "rejected_media", detail: 'HTTP 413 {"code":"too_large","message":"too big"}' };
const CLEAN = { ok: true, flagged: false, review: false, categories: [], reason: "clean" };
const UNSURE = { ok: true, flagged: false, review: true, categories: [], reason: "too dark to tell" };
const FLAGGED = {
  ok: true,
  flagged: true,
  review: false,
  categories: ["sexual_nudity"],
  reason: "partial nudity",
  usage: { inputTokens: 23_548, outputTokens: 79 },
};

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
  storedCooldown = null;
  head.mockResolvedValue({ ok: true, status: 200, contentType: "video/mp4", contentLength: 85_349_000 });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

const summaryLines = () =>
  (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls
    .map((c) => String(c[0]))
    .filter((l) => l.startsWith("[moderate-videos] summary:"));

/** Fake clock (Date only); the returned function moves it on, e.g. inside a mocked Hive call. */
function clock(start = Date.UTC(2026, 10, 16, 12, 0, 0)) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(start);
  return (ms: number) => vi.setSystemTime(Date.now() + ms);
}

describe("moderate-videos cron", () => {
  it("guards every claim on the retry wait being over", async () => {
    posts = [row("cpost1")];
    comments = [row("ccomment1")];
    muses = [row("cmuse1")];
    moderateVideo.mockResolvedValue(CLEAN);
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
    posts = [row("cpost1")];
    moderateVideo.mockResolvedValue({ ok: false, failure: "provider_error", detail: "HTTP 500 oops" });
    const body = await run();
    expect(moderateVideo).toHaveBeenCalledTimes(1);
    expect(body.hive).toEqual({ failure: "provider_error", detail: "HTTP 500 oops" });
    expect(body.failures[0]).toMatchObject({ id: "cpost1", status: 500, outcome: "run_stopped" });
    const unclaim = db.post.updateMany.mock.calls[1][0] as { data: Row };
    expect(unclaim.data).toEqual({ videoModeratedAt: null });
  });

  it("starts no new call once a provider-wide failure is seen; calls already in flight finish and are handed back", async () => {
    const url = (id: string) => `https://media.example.com/${id}.mp4`;
    posts = ["p1", "p2", "p3"].map((id) => row(id, { videoUrl: url(id) }));
    comments = ["c1", "c2", "c3"].map((id) => row(id, { videoUrl: url(id) }));
    moderateVideo.mockResolvedValue({ ok: false, failure: "provider_error", detail: "HTTP 500 oops" });
    const body = await run();
    expect(moderateVideo).toHaveBeenCalledTimes(3); // the first wave only
    expect(body.stoppedBy).toBe("provider_error");
    for (const update of allUpdates()) {
      expect(update.data).not.toHaveProperty("videoScanAttempts");
      expect(update.data).not.toHaveProperty("moderationStatus");
    }
    expect(allUpdates().filter((u) => u.data.videoModeratedAt === null)).toHaveLength(3); // all three un-claimed
    expect(captureError).toHaveBeenCalledTimes(1); // one report per run
  });

  it("never counts a provider-wide failure (429, credit, key, 5xx) against the video", async () => {
    for (const failure of ["rate_limited", "out_of_credit", "unauthorized", "provider_error", "unreachable"]) {
      vi.clearAllMocks();
      storedCooldown = null;
      posts = [row("cpost1", { videoScanAttempts: VIDEO_SCAN_MAX_ATTEMPTS - 1 })];
      moderateVideo.mockResolvedValue({ ok: false, failure, detail: "HTTP 429" });
      await run();
      expect(allUpdates().length, failure).toBe(2); // the claim and the un-claim
      for (const update of allUpdates()) {
        expect(update.data, failure).not.toHaveProperty("videoScanAttempts");
        expect(update.data, failure).not.toHaveProperty("moderationStatus");
      }
      expect(db.auditLog.create, failure).not.toHaveBeenCalled();
    }
  });

  it("scans up to three at a time, starting them in round-robin order, at most three per kind", async () => {
    clock();
    const url = (id: string) => `https://media.example.com/${id}.mp4`;
    posts = [row("p1", { videoUrl: url("p1") }), row("p2", { videoUrl: url("p2") })];
    comments = [row("c1", { videoUrl: url("c1") })];
    muses = [row("m1", { videoUrl: url("m1") }), row("m2", { videoUrl: url("m2") })];
    let inFlight = 0;
    let maxInFlight = 0;
    moderateVideo.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      for (let i = 0; i < 5; i++) await Promise.resolve();
      inFlight -= 1;
      return CLEAN;
    });
    const { runRotation } = await import("@/lib/video-scan-budget");
    const body = await run();
    const order = moderateVideo.mock.calls.map((c) => String(c[0]).slice(-6, -4));
    const expected = [
      ["p1", "c1", "m1", "p2", "m2"],
      ["c1", "m1", "p1", "m2", "p2"],
      ["m1", "p1", "c1", "m2", "p2"],
    ][runRotation(Date.now())];
    expect(order).toEqual(expected);
    expect(maxInFlight).toBe(3);
    for (const m of [db.post, db.comment, db.muse]) {
      expect((m.findMany.mock.calls[0] as unknown as [{ take: number }])[0].take).toBeLessThanOrEqual(3);
    }
    expect(body.stoppedBy).toBe("done");
    expect(body.posts).toMatchObject({ checked: 2, cleared: 2 });
    expect(summaryLines()).toHaveLength(1);
    expect(summaryLines()[0]).toContain("stoppedBy=done");
  });

  it("spaces call starts at least 250ms apart (under Hive's 5 requests per second)", async () => {
    clock();
    posts = [row("p1"), row("p2"), row("p3")];
    moderateVideo.mockResolvedValue(CLEAN);
    await run();
    // Frozen clock: the three workers reserve slots 0, 250 and 500ms; only the later two wait.
    expect(sleepMs.mock.calls.map((c) => c[0])).toEqual([250, 500]);
  });

  it("passes the row's duration so the scan samples at the fps rule", async () => {
    posts = [row("cpost1", { videoDurationSeconds: 42 })];
    moderateVideo.mockResolvedValue(CLEAN);
    await run();
    expect(moderateVideo).toHaveBeenCalledWith(VIDEO, { timeoutMs: expect.any(Number), durationSeconds: 42 });
  });

  it("stops claiming once the budget is spent and never starts a call that can't finish in it", async () => {
    const tick = clock();
    const url = (id: string) => `https://media.example.com/${id}.mp4`;
    posts = ["p1", "p2", "p3"].map((id) => row(id, { videoUrl: url(id) }));
    comments = ["c1", "c2", "c3"].map((id) => row(id, { videoUrl: url(id) }));
    moderateVideo.mockImplementation(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve(); // all three calls are in flight before time moves
      tick(8_000);
      return CLEAN;
    });
    const body = await run();
    // One wave of three calls, each given the whole 20s; 24s later nothing fits, so nothing else is claimed.
    expect(moderateVideo).toHaveBeenCalledTimes(3);
    for (const call of moderateVideo.mock.calls) expect((call[1] as { timeoutMs: number }).timeoutMs).toBe(20_000);
    expect(allUpdates()).toHaveLength(3); // the three claims, nothing more
    expect(body.stoppedBy).toBe("budget");
    expect(summaryLines()[0]).toMatch(/stoppedBy=budget budgetMs=24000\/20000 unclaimed=0/);
  });

  it("hands back, uncounted, a video whose call the budget cut short", async () => {
    const tick = clock();
    const url = (id: string) => `https://media.example.com/${id}.mp4`;
    posts = ["p1", "p2", "p3"].map((id) => row(id, { videoUrl: url(id) }));
    comments = [row("c1", { videoUrl: url("c1") })];
    let calls = 0;
    moderateVideo.mockImplementation(async () => {
      calls += 1;
      if (calls <= 3) {
        await Promise.resolve();
        tick(4_000);
        return CLEAN;
      }
      tick(8_000);
      return { ok: false, failure: "timeout" };
    });
    const body = await run();
    expect(moderateVideo).toHaveBeenCalledTimes(4);
    const last = moderateVideo.mock.calls[3];
    expect((last[1] as { timeoutMs: number }).timeoutMs).toBe(8_000); // 20s - 12s: under the 15s fair timeout
    const lastId = String(last[0]).slice(-6, -4);
    const unclaim = allUpdates().find((u) => u.where.id === lastId && u.data.videoModeratedAt === null)!;
    expect(unclaim.data).toEqual({ videoModeratedAt: null });
    expect(body.failures).toEqual([]);
    expect(head).not.toHaveBeenCalled();
    expect(body.stoppedBy).toBe("budget");
    expect(summaryLines()[0]).toContain("unclaimed=1");
  });

  it("still counts a timeout the video had a fair call for", async () => {
    clock();
    posts = [row("cpost1")];
    moderateVideo.mockResolvedValue({ ok: false, failure: "timeout" });
    await run();
    const retry = db.post.updateMany.mock.calls[1][0] as { data: Row };
    expect(retry.data).toMatchObject({ videoScanAttempts: { increment: 1 }, videoModeratedAt: null });
  });

  it("on a 429 stops, un-claims, sets a cooldown, and the next run skips Hive entirely", async () => {
    clock();
    posts = [row("cpost1")];
    moderateVideo.mockResolvedValue({ ok: false, failure: "rate_limited", detail: "HTTP 429 slow down" });
    const first = await run();
    expect(moderateVideo).toHaveBeenCalledTimes(1);
    expect(first.stoppedBy).toBe("rate_limited");
    expect(writeHiveCooldown).toHaveBeenCalledTimes(1);
    expect(storedCooldown).toMatchObject({ failure: "rate_limited", untilMs: Date.now() + 15 * 60_000 });
    expect(first.hive.cooldownUntil).toBe(new Date(Date.now() + 15 * 60_000).toISOString());
    expect(summaryLines()[0]).toContain("stoppedBy=rate_limited");
    expect(summaryLines()[0]).toContain("cooldown=set(rate_limited, 15m left, redis)");

    vi.clearAllMocks();
    vi.setSystemTime(Date.now() + 5 * 60_000);
    const second = await run();
    expect(second.skipped).toBe("hive_cooldown");
    expect(moderateVideo).not.toHaveBeenCalled();
    expect(db.post.findMany).not.toHaveBeenCalled();
    expect(allUpdates()).toEqual([]);
    expect(captureError).not.toHaveBeenCalled();
    expect(summaryLines()[0]).toContain("stoppedBy=cooldown");
    expect(summaryLines()[0]).toContain("cooldown=skipped(rate_limited, 10m left, redis)");

    vi.setSystemTime(Date.now() + 10 * 60_000); // cooldown over: Hive is tried again
    moderateVideo.mockResolvedValue(CLEAN);
    const third = await run();
    expect(third.stoppedBy).toBe("done");
    expect(moderateVideo).toHaveBeenCalled();
  });

  it("honours Retry-After and backs off an hour for an out-of-credit or refused key", async () => {
    clock();
    posts = [row("cpost1")];
    moderateVideo.mockResolvedValue({ ok: false, failure: "rate_limited", retryAfterSeconds: 40 * 60 });
    await run();
    expect(storedCooldown).toMatchObject({ untilMs: Date.now() + 40 * 60_000 });
    for (const failure of ["out_of_credit", "unauthorized"]) {
      storedCooldown = null;
      moderateVideo.mockResolvedValue({ ok: false, failure });
      await run();
      expect(storedCooldown, failure).toMatchObject({ failure, untilMs: Date.now() + 60 * 60_000 });
    }
  });

  it("sets no cooldown for a brief provider error", async () => {
    posts = [row("cpost1")];
    moderateVideo.mockResolvedValue({ ok: false, failure: "provider_error", detail: "HTTP 503" });
    await run();
    expect(writeHiveCooldown).not.toHaveBeenCalled();
    expect(summaryLines()[0]).toContain("stoppedBy=provider_error");
    expect(summaryLines()[0]).toContain("cooldown=none");
  });

  it("an overlapping run skips a video the other run already claimed (no second Hive call)", async () => {
    posts = [row("cpost1"), row("cpost2")];
    db.post.updateMany.mockResolvedValueOnce({ count: 0 }); // cpost1 taken by the other invocation
    moderateVideo.mockResolvedValue(CLEAN);
    const body = await run();
    expect(moderateVideo).toHaveBeenCalledTimes(1);
    expect(body.posts).toMatchObject({ checked: 1, cleared: 1 });
  });

  describe("VLM verdicts", () => {
    const logLines = () =>
      (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));

    it("clean: nothing written but the claim, counted as cleared", async () => {
      posts = [row("cpost1")];
      moderateVideo.mockResolvedValue(CLEAN);
      const body = await run();
      expect(allUpdates()).toHaveLength(1); // the claim
      expect(db.auditLog.create).not.toHaveBeenCalled();
      expect(body.posts).toMatchObject({ checked: 1, cleared: 1, flagged: 0, unsure: 0, heldForAdmin: 0 });
    });

    it("unsure: held for an admin at once, with the model's reason, no attempt counted", async () => {
      posts = [row("cpost1", { videoScanAttempts: 2 })];
      moderateVideo.mockResolvedValue(UNSURE);
      const body = await run();
      const hold = db.post.updateMany.mock.calls[1][0] as { where: Row; data: Row };
      expect(hold.where).toMatchObject({ id: "cpost1", moderationStatus: { in: ["PUBLISHED", "FLAGGED"] } });
      expect(hold.data).toEqual({ videoScanRetryAt: null, moderationStatus: "FLAGGED" });
      expect(hold.data).not.toHaveProperty("videoModeratedAt"); // stays claimed: out of the scan queue
      expect(db.auditLog.create).toHaveBeenCalledWith({
        data: {
          targetId: "cauthor1",
          action: "CONTENT_FLAGGED_FOR_REVIEW",
          performedBy: "system:video-scan-review-hold",
          reason: "Video held for admin review: automatic video scan was unsure (post:cpost1, VIDEO): too dark to tell",
        },
      });
      expect(body.posts).toMatchObject({ checked: 1, unsure: 1, heldForAdmin: 1, cleared: 0, failed: 0 });
      expect(head).not.toHaveBeenCalled();
      expect(body.failures).toEqual([]);
    });

    it("unsure on a live comment hides it and takes it out of the post's comment count", async () => {
      comments = [row("ccomment1")];
      moderateVideo.mockResolvedValue(UNSURE);
      await run();
      const hold = db.comment.updateMany.mock.calls[1][0] as { where: Row; data: Row };
      expect(hold.where).toMatchObject({ id: "ccomment1", moderationStatus: "PUBLISHED" });
      expect(hold.data).toMatchObject({ moderationStatus: "FLAGGED" });
      expect(hold.data).not.toHaveProperty("videoScanAttempts");
      expect(db.post.update).toHaveBeenCalledWith({ where: { id: "cparent1" }, data: { commentCount: { decrement: 1 } } });
      expect(db.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ reason: expect.stringContaining("was unsure (comment:ccomment1, VIDEO)") }),
      });
    });

    it("unsure on a row an admin re-stamped meanwhile writes no hold and no audit row", async () => {
      muses = [row("cmuse1")];
      moderateVideo.mockResolvedValue(UNSURE);
      db.muse.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
      const body = await run();
      expect(db.auditLog.create).not.toHaveBeenCalled();
      expect(body.muses).toMatchObject({ unsure: 1, heldForAdmin: 0 });
    });

    it("flagged: hidden with an audit row naming the categories and the reason", async () => {
      muses = [row("cmuse1")];
      moderateVideo.mockResolvedValue(FLAGGED);
      const body = await run();
      const write = db.muse.updateMany.mock.calls[1][0] as { where: Row; data: Row };
      expect(write.data).toEqual({ moderationStatus: "FLAGGED" });
      expect(db.auditLog.create).toHaveBeenCalledWith({
        data: {
          targetId: "cauthor1",
          action: "CONTENT_FLAGGED_FOR_REVIEW",
          performedBy: "system:video-scan-review-hold",
          reason:
            "Video held for admin review: automatic video scan flagged this video (muse:cmuse1, VIDEO): sexual_nudity; partial nudity",
        },
      });
      expect(body.muses).toMatchObject({ checked: 1, flagged: 1, cleared: 0 });
    });

    it("flagged on a live comment takes it out of the post's comment count", async () => {
      comments = [row("ccomment1")];
      moderateVideo.mockResolvedValue(FLAGGED);
      await run();
      expect(db.post.update).toHaveBeenCalledWith({ where: { id: "cparent1" }, data: { commentCount: { decrement: 1 } } });
      expect(db.auditLog.create).toHaveBeenCalledTimes(1);
    });

    it("a bad_response (unparsable / cut off) is a counted failure with a retry, never clean", async () => {
      posts = [row("cpost1")];
      moderateVideo.mockResolvedValue({ ok: false, failure: "bad_response", detail: "finish_reason length" });
      const body = await run();
      const retry = db.post.updateMany.mock.calls[1][0] as { data: Row };
      expect(retry.data).toMatchObject({ videoScanAttempts: { increment: 1 }, videoModeratedAt: null });
      expect(body.posts).toMatchObject({ cleared: 0, failed: 1 });
      expect(body.failures[0]).toMatchObject({ failure: "bad_response", outcome: "retry" });
    });

    it("a 400 (Hive's fetcher couldn't pull the file) goes the rejected_media retry -> hold path", async () => {
      posts = [row("cpost1", { videoScanAttempts: VIDEO_SCAN_MAX_ATTEMPTS - 1 })];
      moderateVideo.mockResolvedValue({ ok: false, failure: "rejected_media", detail: "HTTP 400 Unable to download" });
      const body = await run();
      expect(body.failures[0]).toMatchObject({ failure: "rejected_media", outcome: "hold_for_admin" });
      expect(db.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ performedBy: "system:video-scan-failed-hold" }),
      });
    });

    it("logs one verdict line per verdict, without the URL or the model's reason", async () => {
      posts = [row("cpost1", { videoDurationSeconds: 60 })];
      moderateVideo.mockResolvedValue(FLAGGED);
      await run();
      const lines = logLines().filter((l) => l.startsWith("[moderate-videos] verdict:"));
      expect(lines).toEqual([
        expect.stringMatching(
          /^\[moderate-videos\] verdict: post cpost1 flagged \(sexual_nudity\) fps=0\.5 frames=30 durationS=60 ms=\d+ tokens=23548\/79$/,
        ),
      ]);
      expect(lines[0]).not.toContain("media.example.com");
      expect(lines[0]).not.toContain("partial nudity");
      expect(summaryLines()[0]).toContain("posts checked=1 cleared=0 flagged=1 unsure=0 failed=0 held=0");
    });
  });

  it("logs the summary even when the run throws", async () => {
    db.post.findMany.mockRejectedValueOnce(new Error("db down"));
    await expect(GET(new Request("https://x/api/cron/moderate-videos"))).rejects.toThrow("db down");
    expect(summaryLines()[0]).toContain("stoppedBy=error");
  });
});
