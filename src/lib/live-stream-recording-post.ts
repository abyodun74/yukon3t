// The "Record & Post" pipeline: turns one finished Daily cloud recording
// into a real Post on the Home Feed (or in the stream's own Circle) with no
// human re-upload step — see LiveStreamRecordingPost in schema.prisma for
// the row this advances, and requestLiveStreamRecordingPost
// (actions/live-streams.ts) for where one comes from.
//
// Written in the same philosophy as video-review.ts: one call does one step
// (in_progress) or reaches a terminal outcome (done/flagged/terminal error),
// and what to do next is re-derived from live external state (Daily's own
// recording status, Cloudflare's own readiness) plus which of the row's
// pipeline columns are still null — never from a separate stage enum of its
// own. So it's safe to call repeatedly against the same row regardless of
// who's calling or how many times, and a killed/timed-out call loses at most
// that one call's API work. The process-live-stream-recordings cron loops it
// per row within its own poll budget.
//
// Unlike video-review.ts (a pure function over external state, whose caller
// owns all persistence), this owns the row itself: every step persists its
// own progress and the terminal outcomes write status DONE/FAILED and notify
// the host here. The cron only owns the claim and its own time budget.
//
// Order of steps, each a no-op once already satisfied:
//   a. Daily finished the recording → stream-copy it into R2
//   b. hand that R2 copy to Cloudflare Stream
//   c. capture a thumbnail frame into R2 *before* (d) deletes the Stream copy
//   d. the exact same long-video moderation review every other video post
//      goes through (advanceLongVideoReview, unmodified)
//   e. on a clean verdict, create the Post
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getRecording, getRecordingAccessLink } from "@/lib/daily";
import { createStreamCopy, deleteStreamVideo, isStreamReady, thumbnailUrl } from "@/lib/cloudflare-stream";
import { MEDIA_LIMITS, deleteObject, keyFromPublicUrl, uploadBuffer, uploadStream } from "@/lib/storage";
import { advanceLongVideoReview } from "@/lib/video-review";
import { moderateMedia } from "@/lib/moderation";
import { classifyPostCategory } from "@/lib/feed-category";
import { toPgVector } from "@/lib/embeddings";
import { notifySubscribers } from "@/lib/notify-subscribers";
import { isMembersOnlyPost } from "@/lib/post-visibility";
import { publishEvent } from "@/lib/realtime-server";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";
import { notifyLiveRecordingPostFailed } from "@/lib/live-recording-post-notice";

export type RecordingPostResult =
  // One step landed (or we're still waiting on Daily/Cloudflare) — whatever
  // progress exists is already persisted, so the caller should simply call
  // again later. The expected state for most ticks.
  | { kind: "in_progress" }
  // `terminal: false` — a Daily/Cloudflare/R2 call itself failed; the row
  // stays PENDING and a later tick retries from exactly here.
  // `terminal: true` — something this pipeline can never recover from (no
  // destination channel, Daily never finished, the caption/thumbnail failed
  // moderation); the row is already FAILED and the host already notified by
  // the time this returns. Same shape as video-convert.ts's ConversionStep.
  | { kind: "error"; reason: string; terminal: boolean }
  | { kind: "done"; postId: string }
  | { kind: "flagged"; reasons: string[] };

/** Row shape advanceRecordingPost needs — the cron's claim query selects exactly this. */
export type RecordingPostRow = {
  id: string;
  liveStreamId: string;
  recordingId: string;
  hostId: string;
  circleId: string | null;
  r2VideoUrl: string | null;
  videoDurationSeconds: number | null;
  thumbnailUrl: string | null;
  streamUid: string | null;
  createdAt: Date;
};

/**
 * How long a row is allowed to keep making no terminal progress before it's
 * given up on. Rule for this feature is explicitly "don't retry forever":
 * a recording Daily never finishes (an aborted/errored cloud recording,
 * which Daily simply leaves in a non-"finished" state) would otherwise be
 * re-polled by every tick indefinitely. Generous enough that a genuinely
 * long recording plus Cloudflare's own copy/encode/caption processing never
 * trips it.
 */
const GIVE_UP_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Bounds one attempt at streaming the recording out of Daily and into R2.
 * Kept under the cron route's own maxDuration so a stalled transfer is
 * abandoned cleanly (uploadStream aborts without leaving a half-written
 * object) and retried next tick, rather than having the platform kill the
 * whole function mid-write.
 */
const COPY_TIMEOUT_MS = 240_000;

/** Seconds into the video the Post's thumbnail frame is taken from — not 0, which is very often a black opening frame. */
const THUMBNAIL_AT_SECONDS = 1;

/**
 * Marks the row FAILED, discards the copies this pipeline made, tells the
 * host (best-effort), and returns the matching terminal result.
 *
 * The copies are deleted rather than left behind for two separate reasons: a
 * moderation-flagged video must not keep sitting in the public media bucket
 * (same policy as removeModeratedContent for every other flagged video in
 * this app) or on Cloudflare Stream, and no Post ever references these
 * objects, so on any other terminal failure they're simply orphans — a
 * full-length stream recording's worth of them.
 */
async function failRow(
  row: RecordingPostRow,
  reason: string,
  options: {
    /** The automated review's own reason list when moderation is what stopped this (so the host can be told which violation), a single plain token otherwise. */
    reasons: string[];
    moderated: boolean;
    /** True once advanceLongVideoReview has reached a verdict — it deletes the Stream copy itself at that point, so trying again here would only log a 404. */
    afterReview?: boolean;
  },
): Promise<RecordingPostResult> {
  await prisma.liveStreamRecordingPost.update({
    where: { id: row.id },
    data: { status: "FAILED", failReason: reason, claimedAt: null },
  });
  console.error(`[live-stream-recording-post] ${row.id} failed: ${reason}`);

  // Best-effort, same contract as deleteObject/deleteStreamVideo themselves
  // — a storage hiccup here must not turn a handled failure into a thrown
  // one, or stop the host being told.
  for (const url of [row.r2VideoUrl, row.thumbnailUrl]) {
    const key = url ? keyFromPublicUrl(url) : null;
    if (key) await deleteObject(key);
  }
  if (row.streamUid && !options.afterReview) await deleteStreamVideo(row.streamUid);

  await notifyLiveRecordingPostFailed(row.hostId, row.liveStreamId, options.reasons, {
    moderated: options.moderated,
  });
  return options.moderated && options.reasons.length > 0
    ? { kind: "flagged", reasons: options.reasons }
    : { kind: "error", reason, terminal: true };
}

/**
 * Streams the finished recording straight from Daily's signed download link
 * into R2 — never buffered in memory, same shape as copyDownloadToR2 in
 * video-convert-db.ts. The key is minted in the standard
 * `${kind}/${userId}/${uuid}.${ext}` form (see createUploadUrl) with the
 * host as owner, so every ownership check elsewhere in the app keeps working
 * on the resulting object.
 */
async function copyRecordingToR2(downloadUrl: string, hostId: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), COPY_TIMEOUT_MS);
  try {
    const res = await fetch(downloadUrl, { cache: "no-store", signal: controller.signal });
    if (!res.ok || !res.body) throw new Error(`download_${res.status}`);
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > MEDIA_LIMITS["post-video"]) throw new Error("too_large");
    return await uploadStream({
      key: `post-video/${hostId}/${randomUUID()}.mp4`,
      body: Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
      contentType: "video/mp4",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Creates the Post this whole pipeline exists for, mirroring createPost's own
 * sharedPostData field-for-field (actions/circles.ts) — the scoping was
 * already frozen onto the row at record-start time, so nothing here re-reads
 * the LiveStream's circle/target.
 */
async function createRecordingPost(
  row: RecordingPostRow & { r2VideoUrl: string; thumbnailUrl: string; videoDurationSeconds: number },
  title: string,
): Promise<RecordingPostResult> {
  // A Circle post is only ever surfaced through its channelId filter, never
  // a bare circleId one (see the post query in circles/[slug]/page.tsx), so
  // without a destination channel the post would exist and be visible to
  // nobody at all. Defended against rather than assumed: better a notified
  // failure than an invisible orphan.
  let channelId: string | undefined;
  if (row.circleId) {
    const channel = await prisma.channel.findFirst({
      where: { circleId: row.circleId, type: "TEXT" },
      orderBy: { position: "asc" },
      select: { id: true },
    });
    if (!channel) {
      return failRow(row, "no_destination_channel", {
        reasons: ["no_destination_channel"],
        moderated: false,
        afterReview: true,
      });
    }
    channelId = channel.id;
  }

  // Same bar createPost holds a video post's caption and thumbnail to —
  // the video body itself already passed the identical long-video review
  // above, but the stream's title has never been moderated anywhere (see
  // startLiveStream) and the extracted frame isn't necessarily one of the
  // 30s-interval frames that review sampled.
  const modResult = await moderateMedia({ text: title, thumbnailUrl: row.thumbnailUrl });
  if (!modResult.allowed) {
    return failRow(row, `moderation:${modResult.flaggedCategories.join(",")}`, {
      reasons: modResult.flaggedCategories,
      moderated: true,
      afterReview: true,
    });
  }

  const { category: feedCategory, embedding } = await classifyPostCategory(title);

  const post = await prisma.post.create({
    data: {
      authorId: row.hostId,
      circleId: row.circleId ?? undefined,
      channelId,
      content: title,
      // Circle posts are always stored PUBLIC (membership is the real
      // boundary there — see sharedPostData's own comment in createPost),
      // and an unscoped stream's recording is an ordinary public post, so
      // this is PUBLIC either way; what differs is circleId/channelId.
      visibility: "PUBLIC",
      feedCategory,
      mediaType: "VIDEO",
      videoUrl: row.r2VideoUrl,
      videoThumbnailUrl: row.thumbnailUrl,
      videoDurationSeconds: row.videoDurationSeconds,
      // Not FLAGGED the way a fresh over-10-minute upload would be: by
      // construction the long-video review already ran to a clean verdict
      // *before* this row ever existed as a Post, so there's nothing left
      // to hold it pending.
      moderationStatus: "PUBLISHED",
      // Both already settled above, so both are pre-claimed to keep either
      // moderation cron from redoing the work: moderate-videos keys on
      // videoModeratedAt being null (Hive is skipped even for a recording
      // short enough for its 60s scan, since the Cloudflare/OpenAI review
      // this video already passed samples frames *and* the transcript —
      // stricter, not weaker), and moderate-long-videos keys on
      // videoLongReviewNeeded, which is exactly the review we just ran.
      videoModeratedAt: new Date(),
      videoLongReviewNeeded: false,
    },
  });
  if (embedding) {
    await prisma.$executeRaw`UPDATE "Post" SET "embedding" = ${toPgVector(embedding)}::vector WHERE "id" = ${post.id}`;
  }

  await prisma.liveStreamRecordingPost.update({
    where: { id: row.id },
    data: { status: "DONE", postId: post.id, claimedAt: null },
  });

  // Same fan-out createPost does for a freshly PUBLISHED PUBLIC post, and
  // the same members-only gate: a PRIVATE Circle's (or private channel's)
  // post is stored PUBLIC too, so telling the host's subscribers about it
  // would reveal something they can't open.
  const membersOnly = await isMembersOnlyPost(post);
  if (!membersOnly) {
    await notifySubscribers(row.hostId, "SUBSCRIPTION_POST", { postId: post.id });
    await Promise.all([
      publishEvent(REALTIME_CHANNELS.homeFeed("all"), "changed"),
      publishEvent(REALTIME_CHANNELS.homeFeed(feedCategory), "changed"),
    ]);
  }

  revalidatePath("/circles", "layout");
  revalidatePath("/home");
  revalidatePath(`/u/${row.hostId}`);
  return { kind: "done", postId: post.id };
}

/** Advances one LiveStreamRecordingPost row by one step — see this file's top comment for the full sequence. */
export async function advanceRecordingPost(row: RecordingPostRow): Promise<RecordingPostResult> {
  if (Date.now() - row.createdAt.getTime() > GIVE_UP_AFTER_MS) {
    return failRow(row, "timed_out", { reasons: ["timed_out"], moderated: false });
  }

  // (a) Daily still owns the bytes — wait for it to finish, then take our
  // own copy. Daily's download links are short-lived and signed, so one is
  // fetched fresh here rather than ever being stored.
  if (!row.r2VideoUrl) {
    const recording = await getRecording(row.recordingId);
    if (!recording) return { kind: "error", reason: "daily_recording_unavailable", terminal: false };
    if (recording.status !== "finished") return { kind: "in_progress" };
    // A finished recording always carries its duration; without it there's
    // nothing to tell advanceLongVideoReview how much of the video to
    // sample, and guessing would mean a weaker review than any other video
    // post gets. Retried rather than failed outright (the give-up window
    // above is what bounds it).
    if (recording.durationSeconds === null) {
      return { kind: "error", reason: "daily_recording_missing_duration", terminal: false };
    }

    let r2VideoUrl: string;
    try {
      const downloadUrl = await getRecordingAccessLink(row.recordingId);
      r2VideoUrl = await copyRecordingToR2(downloadUrl, row.hostId);
    } catch (err) {
      console.error(`[live-stream-recording-post] R2 copy failed for ${row.id}`, err);
      return { kind: "error", reason: "r2_copy_failed", terminal: false };
    }

    await prisma.liveStreamRecordingPost.update({
      where: { id: row.id },
      data: { r2VideoUrl, videoDurationSeconds: Math.round(recording.durationSeconds) },
    });
    return { kind: "in_progress" };
  }

  // (b) Hand our copy to Cloudflare Stream — the untrusted-decode boundary
  // every video review in this app goes through (see cloudflare-stream.ts).
  if (!row.streamUid) {
    const uid = await createStreamCopy(row.r2VideoUrl);
    if (!uid) return { kind: "error", reason: "stream_copy_failed", terminal: false };
    await prisma.liveStreamRecordingPost.update({ where: { id: row.id }, data: { streamUid: uid } });
    return { kind: "in_progress" };
  }

  // (c) Capture the Post's thumbnail into our own bucket. This has to happen
  // before step (d): advanceLongVideoReview deletes the Stream copy the
  // moment it reaches a verdict, so a Stream-hosted thumbnail URL would
  // 404 by the time anyone saw the post.
  if (!row.thumbnailUrl) {
    const ready = await isStreamReady(row.streamUid);
    if (ready === null) return { kind: "error", reason: "stream_status_failed", terminal: false };
    if (!ready) return { kind: "in_progress" };

    let publicUrl: string;
    try {
      const res = await fetch(thumbnailUrl(row.streamUid, THUMBNAIL_AT_SECONDS), { cache: "no-store" });
      if (!res.ok) throw new Error(`thumbnail_${res.status}`);
      const body = new Uint8Array(await res.arrayBuffer());
      if (body.byteLength === 0 || body.byteLength > MEDIA_LIMITS["video-thumb"]) {
        throw new Error("thumbnail_size");
      }
      ({ publicUrl } = await uploadBuffer({
        kind: "video-thumb",
        contentType: "image/jpeg",
        userId: row.hostId,
        body,
      }));
    } catch (err) {
      console.error(`[live-stream-recording-post] thumbnail capture failed for ${row.id}`, err);
      return { kind: "error", reason: "thumbnail_failed", terminal: false };
    }

    await prisma.liveStreamRecordingPost.update({
      where: { id: row.id },
      data: { thumbnailUrl: publicUrl },
    });
    return { kind: "in_progress" };
  }

  // Set together with r2VideoUrl in step (a) — narrowing for the two steps
  // below, which both genuinely need it.
  if (row.videoDurationSeconds === null) {
    return { kind: "error", reason: "missing_duration", terminal: false };
  }

  // (d) The existing, unmodified long-video review — the exact same bar any
  // other video post over Hive's 60s scan cap is held to, not a parallel
  // check of our own.
  const review = await advanceLongVideoReview({
    videoUrl: row.r2VideoUrl,
    videoDurationSeconds: row.videoDurationSeconds,
    streamUid: row.streamUid,
  });

  if (review.kind === "in_progress") {
    // streamUid was already seeded in step (b) so this can't actually
    // change here — persisted anyway, same defensive shape as
    // moderate-long-videos' reviewOnePost.
    if (review.streamUid !== row.streamUid) {
      await prisma.liveStreamRecordingPost.update({
        where: { id: row.id },
        data: { streamUid: review.streamUid },
      });
    }
    return { kind: "in_progress" };
  }
  if (review.kind === "error") {
    return { kind: "error", reason: "review_failed", terminal: false };
  }
  if (review.kind === "flagged") {
    // Never silently becomes a post. Unlike a flagged *uploaded* video
    // (held FLAGGED for an admin to publish or remove), there's nothing to
    // hold here — no Post was ever created, and the host still has the
    // recording itself in the stream's Recordings list.
    return failRow(row, `moderation:${review.reasons.join("; ")}`, {
      reasons: review.reasons,
      moderated: true,
      afterReview: true,
    });
  }

  // (e) review.kind === "clean"
  const liveStream = await prisma.liveStream.findUnique({
    where: { id: row.liveStreamId },
    select: { title: true, targetUserId: true },
  });
  if (!liveStream) {
    return failRow(row, "live_stream_gone", {
      reasons: ["live_stream_gone"],
      moderated: false,
      afterReview: true,
    });
  }
  // Re-checked here as well as in the server action: there is no Post
  // visibility tier for "private to exactly one other person," so a
  // target-scoped stream's recording must never become a post no matter how
  // its row came to exist.
  if (liveStream.targetUserId) {
    return failRow(row, "target_scoped_stream", {
      reasons: ["target_scoped_stream"],
      moderated: false,
      afterReview: true,
    });
  }

  return createRecordingPost(
    {
      ...row,
      r2VideoUrl: row.r2VideoUrl,
      thumbnailUrl: row.thumbnailUrl,
      videoDurationSeconds: row.videoDurationSeconds,
    },
    liveStream.title,
  );
}
