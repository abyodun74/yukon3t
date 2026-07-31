"use server";

import { revalidatePath } from "next/cache";
import { requireVerifiedUser, requireAdmin } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { reportSchema, moderationActionSchema } from "@/lib/validations";
import { checkRateLimit } from "@/lib/rate-limit";
import { recomputeTrustScore } from "@/lib/trust";

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

  await prisma.report.update({
    where: { id: reportId },
    data: {
      status: "RESOLVED",
      resolutionNote: note,
      resolvedAt: new Date(),
    },
  });

  if (report.reportedUserId) {
    await prisma.auditLog.create({
      data: {
        targetId: report.reportedUserId,
        action,
        reason: note,
        performedBy: admin.id,
      },
    });

    if (action === "SUSPEND" || action === "BAN") {
      await prisma.user.update({
        where: { id: report.reportedUserId },
        data: {
          status: action === "BAN" ? "BANNED" : "SUSPENDED",
          suspensionReason: note,
        },
      });
    }

    await recomputeTrustScore(report.reportedUserId);
  }

  revalidatePath("/admin/moderation");
  return { error: null };
}
