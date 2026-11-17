"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { announcementEditSchema, announcementSchema, announcementTranslationsSchema } from "@/lib/validations";
import { checkRateLimit } from "@/lib/rate-limit";
import { announcementPushPayload, type AnnouncementTranslationLocale } from "@/lib/announcement-translations";
import { broadcastFcmAnnouncement } from "@/lib/fcm";
import { broadcastPushAnnouncement } from "@/lib/push";
import { publishEvent } from "@/lib/realtime-server";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";
import { MEDIA_LIMITS, verifyUploadedSize, deleteObject, keyFromPublicUrl } from "@/lib/storage";
import { deleteOwnedUploads } from "@/lib/owned-uploads";

/**
 * Admin-only: posts a new "what's new" announcement. Visible to every user
 * via the WhatsNewBell the moment it's created (no per-user "send" step —
 * that part was already automatic), and now also actively pushed to every
 * registered device (native FCM + web push), not just left as a passive
 * badge someone has to notice on their own.
 *
 * `title`/`body` are the English (default) version. `translations` (optional, a JSON array of { locale, title, body }
 * from the form) adds the admin's own version for any of the other languages; readers and push recipients in a
 * language without one get the English (src/lib/announcement-translations.ts). A posted announcement's text,
 * translations and attachment can be changed later with updateAnnouncement (no new push).
 */
export async function createAnnouncement(formData: FormData) {
  const admin = await requireAdmin();

  const parsed = announcementSchema.safeParse({
    title: formData.get("title"),
    body: formData.get("body"),
    mediaType: formData.get("mediaType") || undefined,
    mediaUrl: formData.get("mediaUrl") || undefined,
    mediaThumbnailUrl: formData.get("mediaThumbnailUrl") || undefined,
  });
  if (!parsed.success) {
    return { error: "invalid" as const };
  }
  const { title, body, mediaType, mediaUrl, mediaThumbnailUrl } = parsed.data;

  const translations = parseTranslations(formData.get("translations"));

  // mediaType/mediaUrl travel together or not at all — same imperative
  // pairing check createAdCampaign/createStory use for their own optional
  // media fields. A thumbnail only ever makes sense alongside a VIDEO.
  if (Boolean(mediaType) !== Boolean(mediaUrl)) {
    return { error: "invalid" as const };
  }
  if (mediaThumbnailUrl && mediaType !== "VIDEO") {
    return { error: "invalid" as const };
  }

  // Cleans up whatever was actually uploaded (create-announcement-form.tsx
  // already uploaded the file to R2 before calling this action, same
  // upload-then-confirm shape every other composer in this app uses) —
  // called on every rejection path below so a failed post never leaves an
  // orphaned object behind.
  const cleanupUploads = () =>
    deleteOwnedUploads(mediaUrl ? [mediaUrl, ...(mediaThumbnailUrl ? [mediaThumbnailUrl] : [])] : [], admin.id);

  if (!translations.ok) {
    // The form checks this before uploading anything; this is the server's own check (a crafted request, or a
    // language half-filled after the client's check).
    await cleanupUploads();
    return { error: "invalid_translation" as const, locale: translations.locale };
  }

  if (mediaType && mediaUrl) {
    const key = keyFromPublicUrl(mediaUrl);
    const maxBytes = mediaType === "IMAGE" ? MEDIA_LIMITS["announcement-image"] : MEDIA_LIMITS["announcement-video"];
    const sizeOk = key && (await verifyUploadedSize({ key, maxBytes, ownerId: admin.id }));
    if (!sizeOk) {
      await cleanupUploads();
      return { error: "too_large" as const };
    }
    // No moderateMedia call here, unlike createAdCampaign/createStory — this
    // is admin-authored content, the same trust level that already reviews
    // everything else in the moderation queue, and the announcement's own
    // title/body text has never gone through moderation either.
  }

  await prisma.announcement.create({
    data: {
      title,
      body,
      createdById: admin.id,
      mediaType,
      mediaUrl,
      mediaThumbnailUrl,
      ...(translations.rows.length > 0 ? { translations: { create: translations.rows } } : {}),
    },
  });

  // Awaited, not fire-and-forget — a serverless function's execution can be
  // frozen the moment a response is sent, same reasoning every other push
  // send in this codebase (e.g. toggleLike's pushActivityNotification) is
  // awaited rather than left running in the background. Both are already
  // internally best-effort/never-throwing (see their own comments), so
  // awaiting them can't make announcement creation itself fail.
  // Each recipient's push is in their stored language (User.locale) when this announcement has that version, else
  // English; both senders read the language with the devices in one query and word it once per language.
  const pushText = announcementPushPayload({ title, body, translations: translations.rows });
  await broadcastFcmAnnouncement(pushText);
  await broadcastPushAnnouncement((locale) => ({ ...pushText(locale), url: "/whats-new" }));
  await publishEvent(REALTIME_CHANNELS.announcements(), "changed");

  revalidatePath("/admin/announcements");
  revalidatePath("/whats-new");
  return { error: null };
}

/**
 * Admin-only: edits a posted announcement in place (/admin/announcements/[id]/edit): the English title/body, the full
 * set of per-language versions (replaced as a whole in the same write, so a language left empty in the form is
 * removed and readers in it get the English again), and the attachment (`media`: keep, remove, or replace with a
 * file the form has just uploaded, checked like createAnnouncement's).
 *
 * Deliberately quiet: no push, no FCM, no realtime "announcements" signal, and createdAt is never written, so the
 * announcement keeps its place in every list and nobody's "new" badge (createdAt vs User.lastSeenAnnouncementAt)
 * comes back. Readers simply see the new text next time they open What's new.
 */
export async function updateAnnouncement(formData: FormData) {
  const admin = await requireAdmin();

  const edit = announcementEditSchema.safeParse({ id: formData.get("id"), media: formData.get("media") });
  const parsed = announcementSchema.safeParse({
    title: formData.get("title"),
    body: formData.get("body"),
    mediaType: formData.get("mediaType") || undefined,
    mediaUrl: formData.get("mediaUrl") || undefined,
    mediaThumbnailUrl: formData.get("mediaThumbnailUrl") || undefined,
  });
  // Only a "replace" carries new media, uploaded by the form just before this call; it is cleaned up on every
  // refusal below (deleteOwnedUploads only ever deletes this admin's own uploads).
  const newUploads =
    formData.get("media") === "replace"
      ? [formData.get("mediaUrl"), formData.get("mediaThumbnailUrl")].filter(
          (u): u is string => typeof u === "string" && u.length > 0,
        )
      : [];
  const cleanupUploads = () => deleteOwnedUploads(newUploads, admin.id);

  if (!edit.success || !parsed.success) {
    await cleanupUploads();
    return { error: "invalid" as const };
  }
  const { id, media } = edit.data;
  const { title, body, mediaType, mediaUrl, mediaThumbnailUrl } = parsed.data;

  if (media === "replace") {
    if (!mediaType || !mediaUrl || (mediaThumbnailUrl && mediaType !== "VIDEO")) {
      await cleanupUploads();
      return { error: "invalid" as const };
    }
  } else if (mediaType || mediaUrl || mediaThumbnailUrl) {
    // keep/remove never take new media.
    return { error: "invalid" as const };
  }

  const translations = parseTranslations(formData.get("translations"));
  if (!translations.ok) {
    await cleanupUploads();
    return { error: "invalid_translation" as const, locale: translations.locale };
  }

  if (!(await checkRateLimit("announcementEdit", admin.id))) {
    await cleanupUploads();
    return { error: "rate_limited" as const };
  }

  const existing = await prisma.announcement.findUnique({
    where: { id },
    select: { id: true, mediaUrl: true, mediaThumbnailUrl: true },
  });
  if (!existing) {
    await cleanupUploads();
    return { error: "not_found" as const };
  }

  if (media === "replace" && mediaType && mediaUrl) {
    const key = keyFromPublicUrl(mediaUrl);
    const maxBytes = mediaType === "IMAGE" ? MEDIA_LIMITS["announcement-image"] : MEDIA_LIMITS["announcement-video"];
    const sizeOk = key && (await verifyUploadedSize({ key, maxBytes, ownerId: admin.id }));
    if (!sizeOk) {
      await cleanupUploads();
      return { error: "too_large" as const };
    }
  }

  const mediaData =
    media === "keep"
      ? {}
      : media === "remove"
        ? { mediaType: null, mediaUrl: null, mediaThumbnailUrl: null }
        : { mediaType, mediaUrl, mediaThumbnailUrl: mediaThumbnailUrl ?? null };

  try {
    // One nested write, which Prisma runs as a single transaction: the base text, the attachment, and the whole set
    // of translations replaced (delete all, create the submitted ones). createdAt is not in it.
    await prisma.announcement.update({
      where: { id },
      data: {
        title,
        body,
        ...mediaData,
        translations: { deleteMany: {}, ...(translations.rows.length > 0 ? { create: translations.rows } : {}) },
      },
    });
  } catch (err) {
    await cleanupUploads();
    // Deleted by another admin between the read and the write.
    if ((err as { code?: unknown } | null)?.code === "P2025") return { error: "not_found" as const };
    throw err;
  }

  // The old attachment's files go only after the new state is committed (plain deleteObject, like
  // deleteAnnouncement: any admin may edit any announcement, whoever uploaded the file).
  if (media !== "keep") {
    const keep = new Set([mediaUrl, mediaThumbnailUrl].filter(Boolean));
    await Promise.all(
      [existing.mediaUrl, existing.mediaThumbnailUrl]
        .filter((url): url is string => Boolean(url) && !keep.has(url!))
        .map((url) => {
          const key = keyFromPublicUrl(url);
          return key ? deleteObject(key) : Promise.resolve();
        }),
    );
  }

  revalidatePath("/admin/announcements");
  revalidatePath(`/admin/announcements/${id}/edit`);
  revalidatePath("/whats-new");
  return { error: null };
}

/** Admin-only: removes an announcement outright (e.g. posted by mistake). */
export async function deleteAnnouncement(id: string) {
  await requireAdmin();

  const deleted = await prisma.announcement.delete({ where: { id } });

  // Not cascaded by the DB (mediaUrl is a plain string, not a storage
  // reference) — clean up the R2 object(s) ourselves so a deleted
  // announcement doesn't leave its attachment behind forever. A plain
  // deleteObject, not deleteOwnedObject/keyBelongsToOwner — any admin can
  // already delete any announcement outright regardless of who originally
  // posted it, so this shouldn't silently no-op just because a *different*
  // admin account's id doesn't match the key's own uploader segment.
  await Promise.all(
    [deleted.mediaUrl, deleted.mediaThumbnailUrl]
      .filter((url): url is string => Boolean(url))
      .map((url) => {
        const key = keyFromPublicUrl(url);
        return key ? deleteObject(key) : Promise.resolve();
      }),
  );

  revalidatePath("/admin/announcements");
  revalidatePath("/whats-new");
  return { error: null };
}

/** Marks every announcement up to now as seen — called when the caller opens /whats-new. */
export async function markAnnouncementsSeen() {
  const user = await requireUser();

  await prisma.user.update({
    where: { id: user.id },
    data: { lastSeenAnnouncementAt: new Date() },
  });

  return { error: null };
}

type ParsedTranslations =
  | { ok: true; rows: { locale: AnnouncementTranslationLocale; title: string; body: string }[] }
  | { ok: false; locale: string | null };

/** The form's `translations` field: absent or empty means none; anything unreadable or invalid refuses the post. */
function parseTranslations(raw: FormDataEntryValue | null): ParsedTranslations {
  if (raw === null || raw === "") return { ok: true, rows: [] };
  if (typeof raw !== "string") return { ok: false, locale: null };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, locale: null };
  }
  const parsed = announcementTranslationsSchema.safeParse(data);
  if (!parsed.success) {
    // Name the first language at fault so the form can open it.
    const index = parsed.error.issues.find((issue) => typeof issue.path[0] === "number")?.path[0];
    const row = Array.isArray(data) && typeof index === "number" ? (data[index] as { locale?: unknown } | undefined) : undefined;
    return { ok: false, locale: typeof row?.locale === "string" ? row.locale : null };
  }
  return {
    ok: true,
    rows: parsed.data.map((row) => ({ locale: row.locale as AnnouncementTranslationLocale, title: row.title, body: row.body })),
  };
}
