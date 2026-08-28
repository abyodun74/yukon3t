"use server";

import { revalidatePath } from "next/cache";
import { requireUser, requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { deleteObject, keyFromPublicUrl } from "@/lib/storage";
import { postSchema } from "@/lib/validations";
import { moderateText } from "@/lib/moderation";
import { postCardInclude, attachViewerState } from "@/lib/post-card-data";

const POSTS_PAGE_SIZE = 20;

/** Author-only: updates a post's text content and stamps editedAt. Media/type/event fields are immutable after posting. */
export async function editPost(postId: string, formData: FormData) {
  const user = await requireVerifiedUser();

  const parsed = postSchema.safeParse({ content: formData.get("content") });
  if (!parsed.success) {
    return { error: "invalid" as const };
  }
  const { content } = parsed.data;

  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) {
    return { error: "not_found" as const };
  }
  if (post.authorId !== user.id) {
    return { error: "forbidden" as const };
  }

  const modResult = await moderateText(content);
  const moderationStatus = modResult.allowed ? "PUBLISHED" : "FLAGGED";

  const updated = await prisma.post.update({
    where: { id: postId },
    data: { content, moderationStatus, editedAt: new Date() },
  });

  revalidatePath("/circles", "layout");
  revalidatePath("/home");
  revalidatePath(`/u/${post.authorId}`);
  revalidatePath(`/post/${postId}`);
  return { error: null, post: updated };
}

export async function deletePost(postId: string) {
  const user = await requireVerifiedUser();

  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) {
    return { error: "not_found" };
  }

  const canDelete = post.authorId === user.id || user.isAdmin;
  if (!canDelete) {
    return { error: "forbidden" };
  }

  // Cascades (onDelete: Cascade on Post.repostOf/sharedPost) remove any
  // reposts/shares of this post along with it — a post is always public, so
  // there's no separate "delete for me" state to track the way there is for
  // a private message. Deleting a post that is itself a repost or a share
  // (repostOfId/sharedPostId set) doesn't cascade anywhere, but must still
  // decrement the original's repostCount/shareCount — those were bumped
  // when the repost/share row was created (see repost()/shareToCircle() in
  // reposts.ts/shares.ts) and would otherwise stay permanently inflated.
  await prisma.$transaction([
    prisma.post.delete({ where: { id: postId } }),
    ...(post.repostOfId
      ? [prisma.post.update({ where: { id: post.repostOfId }, data: { repostCount: { decrement: 1 } } })]
      : []),
    ...(post.sharedPostId
      ? [prisma.post.update({ where: { id: post.sharedPostId }, data: { shareCount: { decrement: 1 } } })]
      : []),
  ]);

  const mediaUrls = [
    ...post.mediaUrls,
    ...(post.videoUrl ? [post.videoUrl] : []),
    ...(post.videoThumbnailUrl ? [post.videoThumbnailUrl] : []),
  ];
  for (const url of mediaUrls) {
    const key = keyFromPublicUrl(url);
    if (key) await deleteObject(key);
  }

  revalidatePath("/circles", "layout");
  revalidatePath("/home");
  revalidatePath(`/u/${post.authorId}`);
  revalidatePath(`/post/${postId}`);
  if (post.repostOfId) revalidatePath(`/post/${post.repostOfId}`);
  if (post.sharedPostId) revalidatePath(`/post/${post.sharedPostId}`);
  return { error: null };
}

/**
 * Auto-load-more for a profile's own posts (/u/[userId]) — called from the
 * client via useInfiniteScroll (src/lib/use-infinite-scroll.ts). Re-derives
 * the same visibility rule the page itself uses (src/app/u/[userId]/page.tsx's
 * `canSeePosts`) server-side rather than trusting the caller, so this can't
 * be used to page past a private profile's posts.
 */
export async function loadMoreProfilePosts(profileUserId: string, cursor: string) {
  const viewer = await requireUser();

  const profileUser = await prisma.user.findUnique({ where: { id: profileUserId } });
  if (!profileUser || profileUser.status !== "ACTIVE") {
    return { items: [], hasMore: false };
  }

  const isOwnProfile = profileUserId === viewer.id;
  const iBlockedThem = isOwnProfile
    ? false
    : Boolean(
        await prisma.block.findUnique({
          where: { blockerId_blockedId: { blockerId: viewer.id, blockedId: profileUserId } },
        }),
      );
  const connection = isOwnProfile
    ? null
    : await prisma.connection.findFirst({
        where: {
          OR: [
            { requesterId: viewer.id, targetId: profileUserId },
            { requesterId: profileUserId, targetId: viewer.id },
          ],
        },
      });
  const canSeePosts =
    !iBlockedThem &&
    (isOwnProfile ||
      (profileUser.postsVisibility !== "HIDDEN" &&
        (profileUser.postsVisibility === "PUBLIC" || connection?.status === "ACCEPTED")));
  if (!canSeePosts) {
    return { items: [], hasMore: false };
  }

  const rawPosts = await prisma.post.findMany({
    where: { authorId: profileUserId, circleId: null, moderationStatus: "PUBLISHED" },
    orderBy: { createdAt: "desc" },
    take: POSTS_PAGE_SIZE,
    cursor: { id: cursor },
    skip: 1,
    include: postCardInclude,
  });
  const items = await attachViewerState(rawPosts, viewer.id);
  return { items, hasMore: rawPosts.length === POSTS_PAGE_SIZE };
}
