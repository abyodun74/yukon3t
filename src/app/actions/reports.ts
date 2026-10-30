"use server";

import { revalidatePath } from "next/cache";
import { requireVerifiedUser, requireAdmin } from "@/lib/auth-guards";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { activeWidgetTokensOf } from "@/lib/ambient-access";
import { reportSchema, moderationActionSchema, flaggedContentActionSchema } from "@/lib/validations";
import { checkRateLimit } from "@/lib/rate-limit";
import { recomputeTrustScore } from "@/lib/trust";
import { removeModeratedContent, cleanUpModeratedMedia } from "@/lib/content-moderation";
import { deleteStreamVideo } from "@/lib/cloudflare-stream";

export async function fileReport(formData: FormData) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("report", user.id);
  if (!allowed) {
    return { error: "rate_limited" };
  }

  const parsed = reportSchema.safeParse({
    targetType: formData.get("targetType"),
    targetId: formData.get("targetId"),
    reportedUserId: formData.get("reportedUserId") || undefined,
    reasonCategory: formData.get("reasonCategory") || undefined,
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { error: "invalid" };
  }

  let reportedUserId = parsed.data.reportedUserId;
  let evidenceText: string | undefined;

  if (parsed.data.targetType === "MESSAGE") {
    // A message report has to be about a message the reporter can actually see:
    // they must be in that conversation, and it can't be their own. The accused
    // is taken from the message itself — never from the client.
    const message = await prisma.message.findUnique({
      where: { id: parsed.data.targetId },
      select: { senderId: true, conversationId: true },
    });
    if (!message || message.senderId === user.id) {
      return { error: "invalid" };
    }
    const membership = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: message.conversationId, userId: user.id } },
      select: { id: true },
    });
    if (!membership) {
      return { error: "invalid" };
    }
    reportedUserId = message.senderId;

    // A secret (end-to-end encrypted) chat's messages are unreadable to us, so
    // the reporter's own app attaches the decrypted text. It's the reporter's
    // word — we can't verify it — and the admin queue says so.
    const evidence = z.string().trim().max(4000).safeParse(formData.get("evidenceText") ?? "");
    if (evidence.success && evidence.data) evidenceText = evidence.data;
  }

  await prisma.report.create({
    data: { ...parsed.data, reportedUserId, evidenceText, reporterId: user.id },
  });

  revalidatePath("/admin/moderation");
  return { error: null };
}

/**
 * Every action here writes an AuditLog entry with a reason, so the affected
 * user always has an explainable, appealable record — this directly answers
 * the "silent ban" / "closed door" complaints found against competitors
 * during the SWOT phase.
 */
export async function resolveReport(formData: FormData) {
  const admin = await requireAdmin();

  const parsed = moderationActionSchema.safeParse({
    reportId: formData.get("reportId"),
    action: formData.get("action"),
    note: formData.get("note"),
  });
  if (!parsed.success) {
    return { error: "invalid" };
  }
  const { reportId, action, note } = parsed.data;

  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report) {
    return { error: "not_found" };
  }

  // The report's own status update, any content removal, and the AuditLog
  // entry that makes it explainable/appealable all commit as one unit — a
  // crash partway through must never leave a user banned (or content gone)
  // with no audit record, or a report marked resolved with the enforcement
  // action it describes never having happened.
  let removedMediaUrls: string[] = [];
  let touchedUserId: string | null = null;

  await prisma.$transaction(async (tx) => {
    await tx.report.update({
      where: { id: reportId },
      data: {
        // A dismissed report was found to have no merit and must not count as
        // an "upheld" report — recomputeTrustScore() only penalizes RESOLVED
        // ones, so this needs its own status or a baseless report would still
        // dock the reported user's trust score.
        status: action === "REPORT_DISMISSED" ? "DISMISSED" : "RESOLVED",
        resolutionNote: note,
        resolvedAt: new Date(),
      },
    });

    if (action === "REMOVE_CONTENT") {
      // Content reports (POST/COMMENT/MESSAGE/CIRCLE/COLLAB_POST) resolve by
      // taking the reported content down, not by acting on reportedUserId.
      const removed = await removeModeratedContent(report.targetType, report.targetId, tx);
      if (removed) {
        await tx.auditLog.create({
          data: {
            targetId: removed.authorId,
            action: "CONTENT_REMOVED",
            reason: note,
            performedBy: admin.id,
          },
        });
        removedMediaUrls = removed.mediaUrlsToDelete;
        touchedUserId = removed.authorId;
      }
    } else if (report.reportedUserId) {
      await tx.auditLog.create({
        data: {
          targetId: report.reportedUserId,
          action,
          reason: note,
          performedBy: admin.id,
        },
      });

      if (action === "SUSPEND" || action === "BAN") {
        await tx.user.update({
          where: { id: report.reportedUserId },
          data: {
            status: action === "BAN" ? "BANNED" : "SUSPENDED",
            suspensionReason: note,
          },
        });
        // The ambient widget route also refuses a non-ACTIVE owner; revoking keeps a lifted suspension from
        // silently reviving an old token.
        await tx.ambientWidgetToken.updateMany(activeWidgetTokensOf(report.reportedUserId));
      }

      touchedUserId = report.reportedUserId;
    }
  });

  if (removedMediaUrls.length > 0) {
    await cleanUpModeratedMedia(removedMediaUrls);
  }
  if (touchedUserId) {
    await recomputeTrustScore(touchedUserId);
  }

  revalidatePath("/admin/moderation");
  return { error: null };
}

/**
 * Content that automated moderation flagged at creation time (see
 * moderateText/moderateMedia) is stored hidden but was previously never
 * reviewed by anyone — it just sat invisible forever. These two actions are
 * how an admin clears that queue: publish it after a human look, or remove it
 * outright.
 */
export async function approveFlaggedContent(formData: FormData) {
  await requireAdmin();

  const parsed = flaggedContentActionSchema.safeParse({
    contentType: formData.get("contentType"),
    contentId: formData.get("contentId"),
    decision: "APPROVE",
  });
  if (!parsed.success) {
    return { error: "invalid" };
  }
  const { contentType, contentId } = parsed.data;

  // An admin's "publish" has to be the last word on a video, and two crons
  // can each still be holding one: moderate-long-videos (a review in flight
  // or still owed) and moderate-videos (the Hive scan). So for POST, COMMENT
  // and MUSE the approval also ends both, in the same transaction as the
  // publish:
  //  - videoLongReviewNeeded: false is what moderate-long-videos' claim
  //    query and every one of its verdict writes are guarded on, so a
  //    review already running finds nothing to write and no later tick
  //    claims the row. Before this an approved video was simply flagged
  //    again by the next pass.
  //  - videoModeratedAt is stamped on anything with a video, even when
  //    already set: null would leave it for moderate-videos to scan (and
  //    flag) later, and a fresh value is how a Hive scan running right now
  //    learns its claim was superseded (that cron guards its writes on the
  //    timestamp it claimed with).
  // The Cloudflare Stream review copy, if there was one, is deleted once
  // the write has committed — nothing else is going to (video-review.ts
  // only deletes it when a review reaches a verdict).
  let reviewCopyUid: string | null = null;

  if (contentType === "POST") {
    reviewCopyUid = await prisma.$transaction(async (tx) => {
      const before = await tx.post.findUnique({
        where: { id: contentId },
        select: { videoStreamUid: true, albumId: true },
      });
      await tx.post.update({
        where: { id: contentId },
        data: {
          moderationStatus: "PUBLISHED",
          videoLongReviewNeeded: false,
          videoLongReviewClaimedAt: null,
          videoStreamUid: null,
        },
      });
      // A held multi-photo post is one hidden row per photo (createPost holds
      // them together): publishing the album's lead publishes all of them.
      if (before?.albumId) {
        await tx.post.updateMany({
          where: { albumId: before.albumId, moderationStatus: "FLAGGED" },
          data: { moderationStatus: "PUBLISHED" },
        });
      }
      await tx.post.updateMany({
        where: { id: contentId, videoUrl: { not: null } },
        data: { videoModeratedAt: new Date() },
      });
      return before?.videoStreamUid ?? null;
    });
    // Same set the moderate-long-videos cron's own "clean" verdict
    // revalidates (see reviewOnePost) — the post just became visible.
    revalidatePath("/circles", "layout");
    revalidatePath("/home");
    revalidatePath(`/post/${contentId}`);
  } else if (contentType === "COMMENT") {
    // createComment only increments commentCount when it publishes immediately;
    // a comment approved late needs that increment applied now instead —
    // transactional so the two writes can't drift apart on a crash/race.
    // The publish is its own write guarded on "not PUBLISHED yet", and the
    // increment follows only if it matched: a second click, a second admin,
    // or the long-video cron having published the comment in the meantime
    // must not count it twice. Ending the reviews (see above) happens either
    // way.
    const approved = await prisma.$transaction(async (tx) => {
      const before = await tx.comment.findUnique({
        where: { id: contentId },
        select: { postId: true, videoStreamUid: true },
      });
      if (!before) return null;
      const published = await tx.comment.updateMany({
        where: { id: contentId, moderationStatus: { not: "PUBLISHED" } },
        data: { moderationStatus: "PUBLISHED" },
      });
      await tx.comment.updateMany({
        where: { id: contentId },
        data: {
          videoLongReviewNeeded: false,
          videoLongReviewClaimedAt: null,
          videoStreamUid: null,
        },
      });
      await tx.comment.updateMany({
        where: { id: contentId, videoUrl: { not: null } },
        data: { videoModeratedAt: new Date() },
      });
      if (published.count > 0) {
        await tx.post.update({
          where: { id: before.postId },
          data: { commentCount: { increment: 1 } },
        });
      }
      return before;
    });
    if (!approved) {
      // Gone already (removed by another admin): refresh the queue too.
      revalidatePath("/admin/moderation");
      return { error: "not_found" };
    }
    reviewCopyUid = approved.videoStreamUid;
    revalidatePath(`/post/${approved.postId}`);
  } else if (contentType === "MUSE") {
    // Same terminal update the moderate-long-videos cron's own "clean"
    // verdict makes (see reviewOneMuse) — this is the manual equivalent for
    // a Muse an admin looked at directly instead of waiting on that
    // pipeline (or rescuing one whose automated review never reached a
    // verdict). Matches that path exactly: no notifySubscribers fan-out
    // here either, same as the automated "clean" case.
    reviewCopyUid = await prisma.$transaction(async (tx) => {
      const before = await tx.muse.findUnique({ where: { id: contentId }, select: { videoStreamUid: true } });
      await tx.muse.update({
        where: { id: contentId },
        data: {
          moderationStatus: "PUBLISHED",
          videoLongReviewNeeded: false,
          videoLongReviewClaimedAt: null,
          videoStreamUid: null,
        },
      });
      await tx.muse.updateMany({
        where: { id: contentId, videoUrl: { not: null } },
        data: { videoModeratedAt: new Date() },
      });
      return before?.videoStreamUid ?? null;
    });
    revalidatePath("/muse");
  } else {
    await prisma.message.update({ where: { id: contentId }, data: { moderationStatus: "PUBLISHED" } });
  }

  // Best-effort, like deleteStreamVideo itself (it logs and never throws):
  // the approval above has already committed and must not fail over this.
  if (reviewCopyUid) {
    await deleteStreamVideo(reviewCopyUid);
  }

  revalidatePath("/admin/moderation");
  return { error: null };
}

export async function removeFlaggedContent(formData: FormData) {
  const admin = await requireAdmin();

  const parsed = flaggedContentActionSchema.safeParse({
    contentType: formData.get("contentType"),
    contentId: formData.get("contentId"),
    decision: "REMOVE",
  });
  if (!parsed.success) {
    return { error: "invalid" };
  }
  const { contentType, contentId } = parsed.data;

  const removed = await prisma.$transaction(async (tx) => {
    const result = await removeModeratedContent(contentType, contentId, tx);
    if (result) {
      await tx.auditLog.create({
        data: {
          targetId: result.authorId,
          action: "CONTENT_REMOVED",
          reason: "Removed from the flagged content queue after review.",
          performedBy: admin.id,
        },
      });
    }
    return result;
  });

  if (removed) {
    await cleanUpModeratedMedia(removed.mediaUrlsToDelete);
    await recomputeTrustScore(removed.authorId);
  }

  revalidatePath("/admin/moderation");
  return { error: null };
}
