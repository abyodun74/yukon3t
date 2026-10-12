import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { moderateVideo } from "@/lib/hive";
import { isCronAuthorized } from "@/lib/cron-auth";
import { HIVE_VIDEO_MODERATION_MAX_SECONDS } from "@/lib/storage";
import { captureError } from "@/lib/error-tracking";

const BATCH_SIZE = 20;

/**
 * Triggered on a schedule (Netlify Scheduled Function), same pattern as the
 * other cron routes — this is the only place video-body moderation runs
 * (see src/lib/hive.ts; Hive's Visual Moderation API is synchronous, so
 * calling it here rather than inline at post creation keeps a potentially
 * slow third-party call out of the user-facing publish request).
 *
 * Claims each post (sets videoModeratedAt) BEFORE calling Hive, not after —
 * unlike the read-only polling this route originally did against a
 * different API, this call is the real (billable) moderation work, so an
 * overlapping cron run must not redo it. On failure, un-claims the post so
 * a later run retries instead of silently leaving it unmoderated forever.
 *
 * The claim's timestamp doubles as a token: the FLAGGED write and the
 * un-claim are both guarded on videoModeratedAt still being exactly the
 * value this run wrote. An admin publishing the row from /admin/moderation
 * (approveFlaggedContent) re-stamps videoModeratedAt, so a Hive call that
 * was in flight at that moment matches nothing afterwards — it can neither
 * flag what the admin just approved nor hand the row back for another scan.
 * Same in moderateCommentVideos and moderateMuseVideos below.
 */
async function moderatePostVideos() {
  const pending = await prisma.post.findMany({
    where: { mediaType: "VIDEO", videoModeratedAt: null, videoUrl: { not: null } },
    select: { id: true, videoUrl: true },
    take: BATCH_SIZE,
  });

  let flagged = 0;
  let cleared = 0;
  let failed = 0;

  for (const post of pending) {
    const claimedAt = new Date();
    const claimed = await prisma.post.updateMany({
      where: { id: post.id, videoModeratedAt: null },
      data: { videoModeratedAt: claimedAt },
    });
    if (claimed.count === 0) continue; // another run already claimed it

    try {
      const result = await moderateVideo(post.videoUrl!);
      if (result === null) {
        await prisma.post.updateMany({ where: { id: post.id, videoModeratedAt: claimedAt }, data: { videoModeratedAt: null } });
        failed += 1;
        continue;
      }
      if (result.flagged) {
        const written = await prisma.post.updateMany({
          where: { id: post.id, videoModeratedAt: claimedAt },
          data: { moderationStatus: "FLAGGED" },
        });
        if (written.count > 0) flagged += 1;
      } else {
        cleared += 1;
      }
    } catch (err) {
      await prisma.post.updateMany({ where: { id: post.id, videoModeratedAt: claimedAt }, data: { videoModeratedAt: null } });
      failed += 1;
      console.error(`[moderate-videos] failed to moderate video for post ${post.id}`, err);
      await captureError(err, { route: "cron/moderate-videos", kind: "post", postId: post.id });
    }
  }

  return { checked: pending.length, flagged, cleared, failed };
}

// Same logic as moderatePostVideos, applied to Comment instead of Post —
// Comment has no mediaType column (a comment can carry video alongside
// text/gif/audio independently, see schema.prisma), so the query is just
// "has a video, not yet moderated" with no extra discriminant needed.
async function moderateCommentVideos() {
  const pending = await prisma.comment.findMany({
    where: { videoModeratedAt: null, videoUrl: { not: null } },
    select: { id: true, videoUrl: true, postId: true },
    take: BATCH_SIZE,
  });

  let flagged = 0;
  let cleared = 0;
  let failed = 0;

  for (const comment of pending) {
    const claimedAt = new Date();
    const claimed = await prisma.comment.updateMany({
      where: { id: comment.id, videoModeratedAt: null },
      data: { videoModeratedAt: claimedAt },
    });
    if (claimed.count === 0) continue;

    try {
      const result = await moderateVideo(comment.videoUrl!);
      if (result === null) {
        await prisma.comment.updateMany({ where: { id: comment.id, videoModeratedAt: claimedAt }, data: { videoModeratedAt: null } });
        failed += 1;
        continue;
      }
      if (result.flagged) {
        // Flagging a comment that is live takes it out of the post's
        // commentCount (PUBLISHED comments only) in the same transaction.
        // The first write only matches a PUBLISHED row, so its count says
        // whether there is anything to decrement; the second covers a row
        // that wasn't PUBLISHED (hidden by a moderator meanwhile), which is
        // flagged as before.
        const written = await prisma.$transaction(async (tx) => {
          const unpublished = await tx.comment.updateMany({
            where: { id: comment.id, videoModeratedAt: claimedAt, moderationStatus: "PUBLISHED" },
            data: { moderationStatus: "FLAGGED" },
          });
          if (unpublished.count > 0) {
            await tx.post.update({
              where: { id: comment.postId },
              data: { commentCount: { decrement: 1 } },
            });
            return unpublished.count;
          }
          const other = await tx.comment.updateMany({
            where: { id: comment.id, videoModeratedAt: claimedAt },
            data: { moderationStatus: "FLAGGED" },
          });
          return other.count;
        });
        if (written > 0) flagged += 1;
      } else {
        cleared += 1;
      }
    } catch (err) {
      await prisma.comment.updateMany({ where: { id: comment.id, videoModeratedAt: claimedAt }, data: { videoModeratedAt: null } });
      failed += 1;
      console.error(`[moderate-videos] failed to moderate video for comment ${comment.id}`, err);
      await captureError(err, { route: "cron/moderate-videos", kind: "comment", commentId: comment.id });
    }
  }

  return { checked: pending.length, flagged, cleared, failed };
}

// Same logic as moderateCommentVideos, applied to Muse. mediaType: "VIDEO"
// excludes EMBED rows (see Muse's own mediaType doc comment — no video body
// of ours exists for those to scan; Hive would just error on a null
// videoUrl). A Muse over HIVE_VIDEO_MODERATION_MAX_SECONDS is excluded here
// (its videoModeratedAt is already pre-claimed at creation — see createMuse)
// and instead goes through moderate-long-videos' Cloudflare Stream review
// fork, same as an over-the-cap Post/Comment.
async function moderateMuseVideos() {
  const pending = await prisma.muse.findMany({
    where: {
      mediaType: "VIDEO",
      videoModeratedAt: null,
      videoDurationSeconds: { lte: HIVE_VIDEO_MODERATION_MAX_SECONDS },
    },
    select: { id: true, videoUrl: true },
    take: BATCH_SIZE,
  });

  let flagged = 0;
  let cleared = 0;
  let failed = 0;

  for (const muse of pending) {
    const claimedAt = new Date();
    const claimed = await prisma.muse.updateMany({
      where: { id: muse.id, videoModeratedAt: null },
      data: { videoModeratedAt: claimedAt },
    });
    if (claimed.count === 0) continue;

    try {
      const result = await moderateVideo(muse.videoUrl!);
      if (result === null) {
        await prisma.muse.updateMany({ where: { id: muse.id, videoModeratedAt: claimedAt }, data: { videoModeratedAt: null } });
        failed += 1;
        continue;
      }
      if (result.flagged) {
        const written = await prisma.muse.updateMany({
          where: { id: muse.id, videoModeratedAt: claimedAt },
          data: { moderationStatus: "FLAGGED" },
        });
        if (written.count > 0) flagged += 1;
      } else {
        cleared += 1;
      }
    } catch (err) {
      await prisma.muse.updateMany({ where: { id: muse.id, videoModeratedAt: claimedAt }, data: { videoModeratedAt: null } });
      failed += 1;
      console.error(`[moderate-videos] failed to moderate video for muse ${muse.id}`, err);
      await captureError(err, { route: "cron/moderate-videos", kind: "muse", museId: muse.id });
    }
  }

  return { checked: pending.length, flagged, cleared, failed };
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [posts, comments, muses] = await Promise.all([
    moderatePostVideos(),
    moderateCommentVideos(),
    moderateMuseVideos(),
  ]);

  return NextResponse.json({ error: null, posts, comments, muses });
}
