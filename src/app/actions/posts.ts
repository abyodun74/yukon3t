"use server";

import { revalidatePath } from "next/cache";
import { requireUser, requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { deleteMediaIfUnreferenced } from "@/lib/media-cleanup";
import { postSchema } from "@/lib/validations";
import { moderateText } from "@/lib/moderation";
import { postCardInclude, attachViewerState } from "@/lib/post-card-data";
import { getVisiblePostsWhere, LEAD_POST_ONLY } from "@/lib/post-visibility";

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

  // A multi-photo post is several sibling Post rows sharing one albumId
  // (see createPost in actions/circles.ts) — deleting any one of them
  // (lead or not) deletes the whole set together, the same granularity
  // "delete this post" had before an album could exist at all (it used to
  // be one Post row holding every image). Partial-album deletion (removing
  // just one photo, keeping the rest) isn't supported.
  const albumPosts = post.albumId
    ? await prisma.post.findMany({ where: { albumId: post.albumId } })
    : [post];

  // Cascades (onDelete: Cascade on Post.repostOf/sharedPost) remove any
  // reposts/shares of each of these posts along with it — a post is always
  // public, so there's no separate "delete for me" state to track the way
  // there is for a private message. A post that is itself a repost or a
  // share (repostOfId/sharedPostId set) doesn't cascade anywhere, but must
  // still decrement the original's repostCount/shareCount — those were
  // bumped when the repost/share row was created (see repost()/
  // shareToCircle() in reposts.ts/shares.ts) and would otherwise stay
  // permanently inflated. (An album's own siblings are never themselves
  // reposts/shares — only a standalone post being deleted here can have
  // repostOfId/sharedPostId set — but the same handling covers both
  // shapes without needing to special-case which one this is.)
  await prisma.$transaction([
    prisma.post.deleteMany({ where: { id: { in: albumPosts.map((p) => p.id) } } }),
    ...albumPosts.flatMap((p) => [
      ...(p.repostOfId
        ? [prisma.post.update({ where: { id: p.repostOfId }, data: { repostCount: { decrement: 1 } } })]
        : []),
      ...(p.sharedPostId
        ? [prisma.post.update({ where: { id: p.sharedPostId }, data: { shareCount: { decrement: 1 } } })]
        : []),
    ]),
  ]);

  const mediaUrls = albumPosts.flatMap((p) => [
    ...p.mediaUrls,
    ...(p.videoUrl ? [p.videoUrl] : []),
    ...(p.videoThumbnailUrl ? [p.videoThumbnailUrl] : []),
  ]);
  // Only files nothing else still uses (a Muse / Story / message may share this post's video).
  await deleteMediaIfUnreferenced(mediaUrls);

  revalidatePath("/circles", "layout");
  revalidatePath("/home");
  revalidatePath(`/u/${post.authorId}`);
  for (const p of albumPosts) {
    revalidatePath(`/post/${p.id}`);
    if (p.repostOfId) revalidatePath(`/post/${p.repostOfId}`);
    if (p.sharedPostId) revalidatePath(`/post/${p.sharedPostId}`);
  }
  return { error: null };
}

/**
 * Auto-load-more for a profile's own posts (/u/[userId]) — called from the
 * client via useInfiniteScroll (src/lib/use-infinite-scroll.ts). Re-derives
 * the same visibility rule the page itself uses (src/app/u/[userId]/page.tsx's
 * `canSeePosts` account-level check, plus getVisiblePostsWhere's per-post
 * Everyone/Friends only/Private check) server-side rather than trusting the
 * caller, so this can't be used to page past a private profile's — or a
 * single private post's — visibility.
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
    // AND, not a flat spread: getVisiblePostsWhere and LEAD_POST_ONLY each
    // have their own top-level OR — spreading both into one object would
    // let the second silently clobber the first instead of ANDing them.
    where: {
      authorId: profileUserId,
      circleId: null,
      AND: [await getVisiblePostsWhere(viewer.id), LEAD_POST_ONLY],
    },
    orderBy: { createdAt: "desc" },
    take: POSTS_PAGE_SIZE,
    cursor: { id: cursor },
    skip: 1,
    include: postCardInclude,
  });
  const items = await attachViewerState(rawPosts, viewer.id);
  return { items, hasMore: rawPosts.length === POSTS_PAGE_SIZE };
}
