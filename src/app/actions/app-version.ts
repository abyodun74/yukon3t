"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { appUpdateNoticeSchema, appVersionPolicyFormSchema } from "@/lib/validations";
import {
  UPDATE_NOTICE_COOLDOWN_MS,
  checkAppVersionPolicy,
  olderBuildTokenWhere,
  type AppPlatform,
} from "@/lib/app-version";
import { forgetAppVersionPolicy } from "@/lib/app-version-server";
import { canSendFcm, sendFcmNoticeToTokens } from "@/lib/fcm";
import { appUpdatePush } from "@/lib/push-text";

// The app update card on /admin/system (admin-app-version-card.tsx). Rules in src/lib/app-version.ts.

/** Admin-only: saves one platform's update policy. A new or changed minBuild (force update) must be typed twice. */
export async function saveAppVersionPolicy(formData: FormData) {
  const admin = await requireAdmin();

  const parsed = appVersionPolicyFormSchema.safeParse({
    platform: formData.get("platform"),
    enabled: formData.get("enabled") === "on",
    iosAutoDetect: formData.get("iosAutoDetect") === "on",
    latestBuild: formData.get("latestBuild") ?? "",
    minBuild: formData.get("minBuild") ?? "",
    latestVersion: formData.get("latestVersion") ?? "",
    message: formData.get("message") ?? "",
    storeUrl: formData.get("storeUrl") ?? "",
    appStoreId: formData.get("appStoreId") ?? "",
    confirmMinBuild: formData.get("confirmMinBuild") ?? "",
  });
  if (!parsed.success) return { error: "invalid" as const };
  const { platform, ...form } = parsed.data;

  const existing = await prisma.appVersionPolicy.findUnique({ where: { platform }, select: { minBuild: true } });
  const checked = checkAppVersionPolicy(form, existing?.minBuild ?? null);
  if (checked.error) return { error: checked.error };
  const value = checked.value;

  await prisma.appVersionPolicy.upsert({
    where: { platform },
    create: { platform, ...value, updatedById: admin.id },
    update: { ...value, updatedById: admin.id },
  });
  await prisma.auditLog.create({
    data: {
      targetId: admin.id,
      action: "APP_VERSION_POLICY_UPDATED",
      reason:
        `${platform}: ${value.enabled ? "enabled" : "disabled"}, latestBuild ${value.latestBuild ?? "-"}, ` +
        `minBuild ${value.minBuild ?? "-"} (was ${existing?.minBuild ?? "-"}), latestVersion ${value.latestVersion ?? "-"}, ` +
        `appStoreId ${value.appStoreId ?? "-"}, iosAutoDetect ${value.iosAutoDetect}, storeUrl ${value.storeUrl ?? "-"}.`,
      performedBy: admin.id,
    },
  });

  forgetAppVersionPolicy(platform);
  revalidatePath("/admin/system");
  return { error: null };
}

/** The notice's audience: that platform's tokens on a known build below latestBuild (plus unknown builds, if asked). */
async function noticeAudience(platform: AppPlatform, includeUnknownBuild: boolean) {
  const policy = await prisma.appVersionPolicy.findUnique({
    where: { platform },
    select: { latestBuild: true, lastNotifiedAt: true },
  });
  if (!policy?.latestBuild) return null;
  const latestBuild = policy.latestBuild;
  const where = olderBuildTokenWhere(platform, latestBuild, includeUnknownBuild);
  return { latestBuild, lastNotifiedAt: policy.lastNotifiedAt, where, count: await prisma.fcmToken.count({ where }) };
}

/** Admin-only: how many devices "Notify users on older builds" would reach, for its confirmation step. */
export async function previewAppUpdateNotice(input: { platform: unknown; includeUnknownBuild: unknown }) {
  await requireAdmin();
  const parsed = appUpdateNoticeSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" as const };

  const audience = await noticeAudience(parsed.data.platform, parsed.data.includeUnknownBuild);
  if (!audience) return { error: "no_latest_build" as const };
  const nextAllowedAt = audience.lastNotifiedAt
    ? new Date(audience.lastNotifiedAt.getTime() + UPDATE_NOTICE_COOLDOWN_MS)
    : null;
  return {
    error: null,
    count: audience.count,
    latestBuild: audience.latestBuild,
    fcmConfigured: canSendFcm(),
    nextAllowedAt: nextAllowedAt && nextAllowedAt > new Date() ? nextAllowedAt.toISOString() : null,
  };
}

/**
 * Admin-only, and only from the confirmation step: pushes "Update available" to the devices on older builds, in each
 * recipient's language. Never sent automatically. At most once an hour per platform: the cooldown is claimed on the
 * policy row itself (a guarded updateMany), so it holds across server instances and doesn't depend on Redis.
 */
export async function sendAppUpdateNotice(input: { platform: unknown; includeUnknownBuild: unknown }) {
  const admin = await requireAdmin();
  const parsed = appUpdateNoticeSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" as const };
  const { platform, includeUnknownBuild } = parsed.data;
  if (!canSendFcm()) return { error: "fcm_not_configured" as const };

  const audience = await noticeAudience(platform, includeUnknownBuild);
  if (!audience) return { error: "no_latest_build" as const };
  if (audience.count === 0) return { error: "no_recipients" as const };

  const now = new Date();
  const claimed = await prisma.appVersionPolicy.updateMany({
    where: {
      platform,
      OR: [{ lastNotifiedAt: null }, { lastNotifiedAt: { lt: new Date(now.getTime() - UPDATE_NOTICE_COOLDOWN_MS) } }],
    },
    data: { lastNotifiedAt: now },
  });
  if (claimed.count === 0) return { error: "cooldown" as const };

  const sent = await sendFcmNoticeToTokens(audience.where, appUpdatePush);
  await prisma.auditLog.create({
    data: {
      targetId: admin.id,
      action: "APP_UPDATE_NOTICE_SENT",
      reason:
        `${platform}: update notice pushed to ${sent} device(s) below build ${audience.latestBuild}` +
        `${includeUnknownBuild ? " (unknown builds included)" : ""}.`,
      performedBy: admin.id,
    },
  });

  revalidatePath("/admin/system");
  return { error: null, sent };
}
