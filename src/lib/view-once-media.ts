import { prisma } from "@/lib/prisma";
import { deletePrivateObject } from "@/lib/storage";

/**
 * Deletes a view-once message's file from the private bucket and then its ViewOnceMedia row. In that order, and the
 * row only once R2 has confirmed the delete: the row is the only record of the key, so dropping it first would leave
 * a file nothing could find again (until the bucket's lifecycle rule). Returns true when nothing is left — including
 * when there was nothing to begin with, so every caller can repeat it safely.
 */
export async function destroyViewOnceMedia(messageId: string): Promise<boolean> {
  const media = await prisma.viewOnceMedia.findUnique({ where: { messageId }, select: { objectKey: true } });
  if (!media) return true;
  if (!(await deletePrivateObject(media.objectKey))) return false;
  await prisma.viewOnceMedia.deleteMany({ where: { messageId } });
  return true;
}
