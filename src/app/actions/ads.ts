"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth-guards";
import { adBookingSchema, requestUploadSchema } from "@/lib/validations";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/client-ip";
import { moderateMedia } from "@/lib/moderation";
import {
  MEDIA_LIMITS,
  verifyUploadedSize,
  deleteOwnedObject,
  keyFromPublicUrl,
  createUploadUrl,
  isStorageConfigured,
} from "@/lib/storage";
import { adPriceCents, AD_CURRENCY } from "@/lib/ads";
import { isPaymentsConfigured, createAdCheckoutSession, refundAdPayment } from "@/lib/stripe";

/** Public, unauthenticated — mirrors requestUploadUrl but IP-rate-limited instead of user-keyed, and restricted to the two ad- upload kinds. */
export async function requestAdUploadUrl(formData: FormData) {
  if (!isStorageConfigured()) {
    return { error: "not_configured" as const };
  }

  const ip = await getClientIp();
  const allowed = await checkRateLimit("adUpload", ip);
  if (!allowed) {
    return { error: "rate_limited" as const };
  }

  const parsed = requestUploadSchema.safeParse({
    kind: formData.get("kind"),
    contentType: formData.get("contentType"),
  });
  if (!parsed.success || (parsed.data.kind !== "ad-image" && parsed.data.kind !== "ad-video")) {
    return { error: "invalid" as const };
  }

  try {
    // No user.id to scope the object key to (public flow) — a random
    // "anonymous" bucket keeps the same key shape createUploadUrl expects.
    const { uploadUrl, publicUrl, key } = await createUploadUrl({
      kind: parsed.data.kind,
      contentType: parsed.data.contentType,
      userId: "anonymous",
    });
    return { error: null, uploadUrl, publicUrl, key };
  } catch {
    return { error: "invalid" as const };
  }
}

/**
 * Books an ad: validates the submitted creative, moderates it up front
 * (rejecting outright rather than charging for something that'll never be
 * approved), then hands off to Stripe Checkout. The campaign only reaches
 * PENDING_REVIEW once the Stripe webhook confirms payment — this action
 * itself just gets as far as PENDING_PAYMENT.
 */
export async function createAdCampaign(formData: FormData) {
  const ip = await getClientIp();
  const allowed = await checkRateLimit("adBookingCreate", ip);
  if (!allowed) {
    return { error: "rate_limited" as const };
  }

  if (!isPaymentsConfigured()) {
    return { error: "not_configured" as const };
  }

  const parsed = adBookingSchema.safeParse({
    companyName: formData.get("companyName"),
    contactName: formData.get("contactName"),
    contactEmail: formData.get("contactEmail"),
    headline: formData.get("headline"),
    body: formData.get("body"),
    linkUrl: formData.get("linkUrl"),
    mediaType: formData.get("mediaType"),
    mediaUrl: formData.get("mediaUrl"),
    mediaThumbnailUrl: formData.get("mediaThumbnailUrl") || undefined,
    durationDays: formData.get("durationDays"),
  });
  if (!parsed.success) {
    return { error: "invalid" as const };
  }
  const { companyName, contactName, contactEmail, headline, body, linkUrl, mediaType, mediaUrl, mediaThumbnailUrl, durationDays } =
    parsed.data;

  const uploadedUrls = [mediaUrl, ...(mediaType === "VIDEO" && mediaThumbnailUrl ? [mediaThumbnailUrl] : [])];
  // Ad uploads are unauthenticated (no user.id), so requestAdUploadUrl mints
  // every ad-image/ad-video key under a shared "anonymous" owner segment —
  // that's the ownership boundary here, same idea as the per-user checks on
  // every other upload kind.
  async function cleanupUploads() {
    await Promise.all(
      uploadedUrls.map((url) => {
        const key = keyFromPublicUrl(url);
        return key ? deleteOwnedObject(key, "anonymous") : Promise.resolve();
      }),
    );
  }

  const key = keyFromPublicUrl(mediaUrl);
  const maxBytes = mediaType === "IMAGE" ? MEDIA_LIMITS["ad-image"] : MEDIA_LIMITS["ad-video"];
  const sizeOk = key && (await verifyUploadedSize({ key, maxBytes, ownerId: "anonymous" }));
  if (!sizeOk) {
    await cleanupUploads();
    return { error: "too_large" as const };
  }

  const modResult = await moderateMedia({
    text: `${headline}\n${body}`,
    imageUrls: mediaType === "IMAGE" ? [mediaUrl] : [],
    thumbnailUrl: mediaType === "VIDEO" ? mediaThumbnailUrl : undefined,
  });
  if (!modResult.allowed) {
    await cleanupUploads();
    return { error: "moderation" as const, categories: modResult.flaggedCategories };
  }

  const priceCents = adPriceCents(durationDays);

  const campaign = await prisma.adCampaign.create({
    data: {
      companyName,
      contactName,
      contactEmail,
      headline,
      body,
      linkUrl,
      mediaType,
      mediaUrl,
      durationDays,
      priceCents,
      currency: AD_CURRENCY,
      status: "DRAFT",
    },
  });

  let checkoutUrl: string | null | undefined;
  try {
    const session = await createAdCheckoutSession({
      campaignId: campaign.id,
      companyName,
      headline,
      priceCents,
      currency: AD_CURRENCY,
      contactEmail,
    });
    checkoutUrl = session.url;
    await prisma.adCampaign.update({
      where: { id: campaign.id },
      data: { status: "PENDING_PAYMENT", stripeCheckoutSessionId: session.sessionId },
    });
  } catch {
    await prisma.adCampaign.delete({ where: { id: campaign.id } });
    await cleanupUploads();
    return { error: "payment_setup_failed" as const };
  }

  if (!checkoutUrl) {
    return { error: "payment_setup_failed" as const };
  }

  redirect(checkoutUrl);
}

/** Admin-only: what's waiting on review, live, or otherwise worth seeing at a glance. */
export async function getAdCampaigns() {
  await requireAdmin();
  return prisma.adCampaign.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
}

/** Admin-only: approves a paid campaign and starts its run now. */
export async function approveAdCampaign(id: string) {
  const admin = await requireAdmin();

  const campaign = await prisma.adCampaign.findUnique({ where: { id } });
  if (!campaign || campaign.status !== "PENDING_REVIEW") {
    return { error: "not_found" as const };
  }

  const startAt = new Date();
  const endAt = new Date(startAt.getTime() + campaign.durationDays * 24 * 60 * 60 * 1000);

  await prisma.adCampaign.update({
    where: { id },
    data: { status: "ACTIVE", startAt, endAt, reviewedAt: new Date(), reviewedBy: admin.id },
  });

  revalidatePath("/admin/ads");
  return { error: null };
}

/** Admin-only: rejects a campaign and refunds it — an advertiser who paid for a service that never ran should get their money back automatically, not have to ask. */
export async function rejectAdCampaign(id: string, formData: FormData) {
  const admin = await requireAdmin();

  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) {
    return { error: "invalid" as const };
  }

  const campaign = await prisma.adCampaign.findUnique({ where: { id } });
  if (!campaign || (campaign.status !== "PENDING_REVIEW" && campaign.status !== "ACTIVE")) {
    return { error: "not_found" as const };
  }

  let refunded = false;
  if (campaign.stripePaymentIntentId) {
    refunded = await refundAdPayment(campaign.stripePaymentIntentId);
  }

  await prisma.adCampaign.update({
    where: { id },
    data: {
      status: "REJECTED",
      rejectionReason: reason,
      reviewedAt: new Date(),
      reviewedBy: admin.id,
      refundedAt: refunded ? new Date() : undefined,
    },
  });

  revalidatePath("/admin/ads");
  return { error: null, refunded };
}

/** Admin-only: pulls an already-live ad early (policy issue found after launch). */
export async function pauseAdCampaign(id: string) {
  await requireAdmin();

  await prisma.adCampaign.updateMany({
    where: { id, status: "ACTIVE" },
    data: { status: "PAUSED" },
  });

  revalidatePath("/admin/ads");
  return { error: null };
}

/** The one currently-running ad to show a viewer — picked at random among everything active and within its date window, not the same ad every time. */
export async function getActiveAdForDisplay() {
  const now = new Date();
  const count = await prisma.adCampaign.count({
    where: { status: "ACTIVE", startAt: { lte: now }, endAt: { gt: now } },
  });
  if (count === 0) return null;

  const skip = Math.floor(Math.random() * count);
  const [campaign] = await prisma.adCampaign.findMany({
    where: { status: "ACTIVE", startAt: { lte: now }, endAt: { gt: now } },
    skip,
    take: 1,
  });
  return campaign ?? null;
}

export async function recordAdImpression(id: string) {
  await prisma.adCampaign.updateMany({
    where: { id, status: "ACTIVE" },
    data: { impressionCount: { increment: 1 } },
  });
}

export async function recordAdClick(id: string) {
  await prisma.adCampaign.updateMany({
    where: { id, status: "ACTIVE" },
    data: { clickCount: { increment: 1 } },
  });
}
