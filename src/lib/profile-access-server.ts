import { prisma } from "@/lib/prisma";
import { isBlockedEitherWay } from "@/lib/blocks";
import { PROFILE_OWNER_SELECT, canSeeProfileContent, canSeeStoriesOf, profileIsListed } from "@/lib/profile-access";

/** The profile owner's row for profile-access.ts's rules, or null. */
export function loadProfileOwner(userId: string) {
  return prisma.user.findUnique({ where: { id: userId }, select: PROFILE_OWNER_SELECT });
}

async function areConnected(viewerId: string, ownerId: string) {
  const connection = await prisma.connection.findFirst({
    where: {
      status: "ACCEPTED",
      OR: [
        { requesterId: viewerId, targetId: ownerId },
        { requesterId: ownerId, targetId: viewerId },
      ],
    },
    select: { id: true },
  });
  return Boolean(connection);
}

/** loadMoreProfilePosts' account-level gate: the same answer /u/[userId] gives for `canSeePosts`. */
export async function viewerCanSeeProfilePosts(viewerId: string, ownerId: string) {
  const owner = await loadProfileOwner(ownerId);
  if (!owner || !profileIsListed(owner, viewerId)) return false;
  if (owner.id === viewerId) return true;
  const [iBlockedThem, connected] = await Promise.all([
    prisma.block
      .findUnique({ where: { blockerId_blockedId: { blockerId: viewerId, blockedId: ownerId } }, select: { id: true } })
      .then(Boolean),
    areConnected(viewerId, ownerId),
  ]);
  return canSeeProfileContent({ owner, viewerId, iBlockedThem, connected });
}

/** Whether the viewer may see `authorId`'s Stories (canSeeStoriesOf). */
export async function viewerCanSeeStoriesOf(viewerId: string, authorId: string) {
  if (viewerId === authorId) return true;
  const owner = await loadProfileOwner(authorId);
  if (!owner || !profileIsListed(owner, viewerId)) return false;
  const [blockedEitherWay, connected] = await Promise.all([
    isBlockedEitherWay(viewerId, authorId),
    areConnected(viewerId, authorId),
  ]);
  return canSeeStoriesOf({ owner, viewerId, blockedEitherWay, connected });
}

/**
 * One unexpired Story the viewer may see, or null (expired, missing, or its author's Stories are not visible to
 * them). Every Story action that takes a story id from the browser starts here.
 */
export async function loadViewableStory(viewerId: string, storyId: unknown) {
  if (typeof storyId !== "string" || !storyId) return null;
  const story = await prisma.story.findUnique({
    where: { id: storyId },
    select: { id: true, authorId: true, expiresAt: true },
  });
  if (!story || story.expiresAt < new Date()) return null;
  return (await viewerCanSeeStoriesOf(viewerId, story.authorId)) ? story : null;
}
