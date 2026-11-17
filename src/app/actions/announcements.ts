"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { announcementSchema, announcementTranslationsSchema } from "@/lib/validations";
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
 * language without one get the English (src/lib/announcement-translations.ts). Translations can only be added here,
 * at creation: the admin page has no edit for a posted announcement.
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
