import { prisma } from "@/lib/prisma";
import { deleteMediaIfUnreferenced } from "@/lib/media-cleanup";
import { deleteOwnedObject, keyFromPublicUrl } from "@/lib/storage";
import { isOwnedUploadKey } from "@/lib/media-keys";
import { deleteStoredAvatar } from "@/lib/avatar-storage";

// Account deletion (deleteMyAccount) cascades the rows, but the files behind them used to stay in the public bucket,
// reachable by URL, forever: an upload already referenced has no UploadRecord left, so the sweep never sees it (audit
// L7, 2026-10-29). The URLs are collected BEFORE the delete and removed AFTER it, through the same reference check
// every user-facing delete uses: a file another account still uses (their Story or Muse made from this person's post,
// a forwarded message) stays.

export type AccountMedia = { urls: string[]; circleCovers: string[]; avatarUrl: string | null };

const CHUNK = 200;

export async function collectAccountMedia(userId: string, avatarUrl: string | null): Promise<AccountMedia> {
  const [posts, comments, messages, stories, muses, moments, circles] = await Promise.all([
    prisma.post.findMany({ where: { authorId: userId }, select: { mediaUrls: true, videoUrl: true, videoThumbnailUrl: true } }),
    prisma.comment.findMany({
      where: { authorId: userId, OR: [{ audioUrl: { not: null } }, { videoUrl: { not: null } }] },
      select: { audioUrl: true, videoUrl: true, videoThumbnailUrl: true },
    }),
    prisma.message.findMany({
      where: { senderId: userId, mediaUrl: { not: null } },
      select: { mediaUrl: true, mediaThumbnailUrl: true },
    }),
    prisma.story.findMany({ where: { authorId: userId }, select: { mediaUrl: true, mediaThumbnailUrl: true } }),
    prisma.muse.findMany({ where: { authorId: userId }, select: { videoUrl: true, videoThumbnailUrl: true, audioUrl: true } }),
    prisma.ambientMoment.findMany({ where: { authorId: userId }, select: { imageUrl: true } }),
    prisma.circle.findMany({ where: { createdById: userId, coverImageUrl: { not: null } }, select: { coverImageUrl: true } }),
  ]);
  const urls = [
    ...posts.flatMap((p) => [...p.mediaUrls, p.videoUrl, p.videoThumbnailUrl]),
    ...comments.flatMap((c) => [c.audioUrl, c.videoUrl, c.videoThumbnailUrl]),
    ...messages.flatMap((m) => [m.mediaUrl, m.mediaThumbnailUrl]),
    ...stories.flatMap((s) => [s.mediaUrl, s.mediaThumbnailUrl]),
    ...muses.flatMap((m) => [m.videoUrl, m.videoThumbnailUrl, m.audioUrl]),
    ...moments.map((m) => m.imageUrl),
  ].filter((u): u is string => Boolean(u) && keyFromPublicUrl(u as string) !== null);
  // Circle covers aren't in findReferencedUrls; only this person's own `circle-cover/` uploads are candidates.
  const circleCovers = circles
    .map((c) => c.coverImageUrl)
    .filter((u): u is string => {
      const key = u ? keyFromPublicUrl(u) : null;
      return key !== null && isOwnedUploadKey(key, "circle-cover", userId);
    });
  return { urls: [...new Set(urls)], circleCovers: [...new Set(circleCovers)], avatarUrl };
}

/** Run only after the account row (and its cascades) is gone. Best effort: never throws. */
export async function deleteAccountMedia(userId: string, media: AccountMedia) {
  try {
    for (let i = 0; i < media.urls.length; i += CHUNK) {
      await deleteMediaIfUnreferenced(media.urls.slice(i, i + CHUNK));
    }
    if (media.circleCovers.length > 0) {
      const stillUsed = await prisma.circle.findMany({
        where: { coverImageUrl: { in: media.circleCovers } },
        select: { coverImageUrl: true },
      });
      const used = new Set(stillUsed.map((c) => c.coverImageUrl));
      await Promise.all(
        media.circleCovers
          .filter((u) => !used.has(u))
          .map((u) => {
            const key = keyFromPublicUrl(u);
            return key ? deleteOwnedObject(key, userId) : Promise.resolve();
          }),
      );
    }
    await deleteStoredAvatar(media.avatarUrl, userId);
  } catch (err) {
    console.error("[account-media] cleanup after account deletion failed — files left in place", err);
  }
}
