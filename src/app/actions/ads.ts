"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth-guards";
import { adBookingSchema, adUploadRequestSchema } from "@/lib/validations";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/client-ip";
import { isBotSubmission } from "@/lib/bot-protection";
import { passesBotGate } from "@/lib/bot-gate";
import { captchaErrorCode } from "@/lib/turnstile-shared";
import { moderateMedia } from "@/lib/moderation";
import {
  MEDIA_LIMITS,
  verifyUploadedSize,
  deleteOwnedObject,
  keyFromPublicUrl,
  createUploadUrl,
  isStorageConfigured,
  validateContentType,
} from "@/lib/storage";
import { recordUploads } from "@/lib/upload-records";
import { isOwnedUploadKey } from "@/lib/media-keys";
import { encodeAdUploadPass, verifyAdUploadPass } from "@/lib/ad-upload-pass";
import { adPriceCents, AD_CURRENCY, AD_UPLOAD_PASS_FIELD } from "@/lib/ads";
import { isPaymentsConfigured, createAdCheckoutSession, refundAdPayment } from "@/lib/stripe";

/** How long the public ad flow's presigned PUTs live: a 25MB photo or a 30s (max 250MB) clip, not a 2GB post video. */
const AD_IMAGE_UPLOAD_URL_TTL_SECONDS = 300;
const AD_VIDEO_UPLOAD_URL_TTL_SECONDS = 60 * 60;
/** Every ad upload is minted under this owner segment (there is no account), see createAdCampaign's checks. */
const AD_UPLOAD_OWNER = "anonymous";

/**
 * Public, unauthenticated: presigned PUTs for one booking's creative (and a video's poster frame). It used to be
 * open to anyone with only an IP limit (audit H4), so now it is the step that runs the bot check (honeypot + Turnstile
 * via passesBotGate), checks the declared type and size against the ad kinds' caps before minting anything, keeps the
 * URLs short-lived, and records the uploads so sweep-abandoned-uploads removes any that never become a booking. The
 * returned pass lets createAdCampaign skip a second Turnstile tap for exactly these keys (src/lib/ad-upload-pass.ts).
 */
export async function requestAdUpload(formData: FormData) {
  if (isBotSubmission(formData)) {
    return { error: "invalid" as const };
  }
  if (!isStorageConfigured()) {
    return { error: "not_configured" as const };
  }

  const ip = await getClientIp();
  const botCheck = await passesBotGate(formData, ip, "requestAdUpload");
  if (!botCheck.ok) {
    return { error: captchaErrorCode(botCheck.reason) };
  }
  const allowed = await checkRateLimit("adUpload", ip);
  if (!allowed) {
    return { error: "rate_limited" as const };
  }

  const parsed = adUploadRequestSchema.safeParse({
    mediaType: formData.get("mediaType"),
    contentType: formData.get("contentType"),
    size: formData.get("size"),
    thumbContentType: formData.get("thumbContentType") || undefined,
    thumbSize: formData.get("thumbSize") || undefined,
  });
  if (!parsed.success) {
    return { error: "invalid" as const };
  }
  const { mediaType, contentType, size, thumbContentType, thumbSize } = parsed.data;
  const kind = mediaType === "IMAGE" ? "ad-image" : "ad-video";
  if (!validateContentType(kind, contentType)) {
    return { error: "invalid" as const };
  }
  if (size > MEDIA_LIMITS[kind]) {
    return { error: "too_large" as const };
  }
  const thumbType = mediaType === "VIDEO" ? thumbContentType : undefined;
  if (thumbType !== undefined) {
    if (!validateContentType("ad-image", thumbType) || !thumbSize || thumbSize > MEDIA_LIMITS["video-thumb"]) {
      return { error: "invalid" as const };
    }
  }

  try {
    const main = await createUploadUrl({
      kind,
      contentType,
      userId: AD_UPLOAD_OWNER,
      expiresInSeconds: kind === "ad-video" ? AD_VIDEO_UPLOAD_URL_TTL_SECONDS : AD_IMAGE_UPLOAD_URL_TTL_SECONDS,
    });
    const thumb =
      thumbType !== undefined
        ? await createUploadUrl({
            kind: "ad-image",
            contentType: thumbType,
            userId: AD_UPLOAD_OWNER,
            expiresInSeconds: AD_IMAGE_UPLOAD_URL_TTL_SECONDS,
          })
        : null;
    await recordUploads(
      [{ key: main.key, kind }, ...(thumb ? [{ key: thumb.key, kind: "ad-image" }] : [])],
      AD_UPLOAD_OWNER,
    );
    const pass = await encodeAdUploadPass(thumb ? [main.key, thumb.key] : [main.key], process.env.AUTH_SECRET!);
    return { error: null, main, thumb, pass };
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
  // No auth wall on this form (see rate-limit.ts's adBookingCreate comment),
  // so it gets the same honeypot/timing bot check as sign-up and password
  // reset — reported as a plain "invalid" rather than a distinct code, same
  // reasoning as those two.
  if (isBotSubmission(formData)) {
    return { error: "invalid" as const };
  }

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

  // The bot check ran when these exact files were requested (requestAdUpload); its pass names their keys. The files
  // must be this flow's own ad uploads of the right kind, never another object in the bucket.
  const mediaKey = keyFromPublicUrl(mediaUrl);
  const thumbKey = mediaType === "VIDEO" && mediaThumbnailUrl ? keyFromPublicUrl(mediaThumbnailUrl) : null;
  const mediaKind = mediaType === "IMAGE" ? "ad-image" : "ad-video";
  if (
    !mediaKey ||
    !isOwnedUploadKey(mediaKey, mediaKind, AD_UPLOAD_OWNER) ||
    (mediaType === "VIDEO" && mediaThumbnailUrl && (!thumbKey || !isOwnedUploadKey(thumbKey, "ad-image", AD_UPLOAD_OWNER)))
  ) {
    return { error: "invalid" as const };
  }
  const passOk = await verifyAdUploadPass(
    formData.get(AD_UPLOAD_PASS_FIELD),
    thumbKey ? [mediaKey, thumbKey] : [mediaKey],
    process.env.AUTH_SECRET!,
  );
  if (!passOk) {
    return { error: "captcha" as const };
  }
  // One booking per upload: a pass can't be replayed to open more checkouts for the same file.
  if (await prisma.adCampaign.findFirst({ where: { mediaUrl }, select: { id: true } })) {
    return { error: "invalid" as const };
  }

  // Only the keys checked above (this flow's own uploads, named by the pass).
  async function cleanupUploads() {
    await Promise.all(
      [mediaKey, thumbKey].map((key) => (key ? deleteOwnedObject(key, AD_UPLOAD_OWNER) : Promise.resolve())),
    );
  }

  const sizeOk =
    (await verifyUploadedSize({ key: mediaKey, maxBytes: MEDIA_LIMITS[mediaKind], ownerId: AD_UPLOAD_OWNER })) &&
    (!thumbKey ||
      (await verifyUploadedSize({ key: thumbKey, maxBytes: MEDIA_LIMITS["video-thumb"], ownerId: AD_UPLOAD_OWNER })));
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
  // The poster frame was only for this check; the campaign stores the creative alone.
  if (thumbKey) await deleteOwnedObject(thumbKey, AD_UPLOAD_OWNER);

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

/**
 * Admin-only: what's waiting on review, live, or otherwise worth seeing at
 * a glance. `select` scoped to exactly what /admin/ads (and the
 * AdReviewActions it renders per row) actually display — advertiserUserId/
 * startAt/stripeCheckoutSessionId/stripePaymentIntentId/paidAt/
 * refundedAt/reviewedAt/reviewedBy/createdAt/updatedAt aren't shown there.
 */
export async function getAdCampaigns() {
  await requireAdmin();
  return prisma.adCampaign.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      companyName: true,
      headline: true,
      body: true,
      linkUrl: true,
      mediaType: true,
      mediaUrl: true,
      contactName: true,
      contactEmail: true,
      priceCents: true,
      currency: true,
      durationDays: true,
      status: true,
      endAt: true,
      impressionCount: true,
      clickCount: true,
      rejectionReason: true,
    },
  });
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

/**
 * The one currently-running ad to show a viewer — picked at random among
 * everything active and within its date window, not the same ad every
 * time. Deliberately public/unauthenticated, same as createAdCampaign
 * above — AdSlot renders on the logged-out landing page (src/app/page.tsx)
 * as well as /home, so this can't require a session. `select` is scoped to
 * exactly what AdSlot/AdClickTracker render (id/companyName/headline/body/
 * linkUrl/mediaType/mediaUrl) — AdCampaign otherwise carries real PII
 * (contactName/contactEmail) and Stripe identifiers
 * (stripeCheckoutSessionId/stripePaymentIntentId) that have no business
 * reaching an anonymous viewer's browser.
 */
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
    select: { id: true, companyName: true, headline: true, body: true, linkUrl: true, mediaType: true, mediaUrl: true },
  });
  return campaign ?? null;
}

// Deliberately public/unauthenticated, same reasoning as
// getActiveAdForDisplay above — AdSlot (which calls this right after
// fetching the ad) renders for anonymous landing-page visitors too. Scoped
// to an already-ACTIVE campaign id and returns nothing, so the only
// possible abuse is inflating a count, not reading or writing anything
// sensitive.
export async function recordAdImpression(id: string) {
  await prisma.adCampaign.updateMany({
    where: { id, status: "ACTIVE" },
    data: { impressionCount: { increment: 1 } },
  });
}

// Same reasoning as recordAdImpression above.
export async function recordAdClick(id: string) {
  await prisma.adCampaign.updateMany({
    where: { id, status: "ACTIVE" },
    data: { clickCount: { increment: 1 } },
  });
}
