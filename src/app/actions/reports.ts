"use server";

import { revalidatePath } from "next/cache";
import { requireVerifiedUser, requireAdmin } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { reportSchema, moderationActionSchema, flaggedContentActionSchema } from "@/lib/validations";
import { checkRateLimit } from "@/lib/rate-limit";
import { recomputeTrustScore } from "@/lib/trust";
import { removeModeratedContent, cleanUpModeratedMedia } from "@/lib/content-moderation";

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

  await prisma.report.create({
    data: { ...parsed.data, reporterId: user.id },
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
  let removedMediaKeys: string[] = [];
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
        removedMediaKeys = removed.mediaKeysToDelete;
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
      }

      touchedUserId = report.reportedUserId;
    }
  });

  if (removedMediaKeys.length > 0) {
    await cleanUpModeratedMedia(removedMediaKeys);
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

  if (contentType === "POST") {
    await prisma.post.update({ where: { id: contentId }, data: { moderationStatus: "PUBLISHED" } });
  } else if (contentType === "COMMENT") {
    // createComment only increments commentCount when it publishes immediately;
    // a comment approved late needs that increment applied now instead —
    // transactional so the two writes can't drift apart on a crash/race.
    await prisma.$transaction(async (tx) => {
      const comment = await tx.comment.update({
        where: { id: contentId },
        data: { moderationStatus: "PUBLISHED" },
      });
      await tx.post.update({
        where: { id: comment.postId },
        data: { commentCount: { increment: 1 } },
      });
    });
  } else {
    await prisma.message.update({ where: { id: contentId }, data: { moderationStatus: "PUBLISHED" } });
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
    await cleanUpModeratedMedia(removed.mediaKeysToDelete);
    await recomputeTrustScore(removed.authorId);
  }

  revalidatePath("/admin/moderation");
  return { error: null };
}
