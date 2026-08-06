import { notFound } from "next/navigation";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { PostCard } from "@/components/post-card";
import { CommentComposer } from "@/components/comment-composer";
import { CommentList } from "@/components/comment-list";
import { BackButton } from "@/components/back-button";
import { postCardInclude, attachViewerState } from "@/lib/post-card-data";
import { isCircleAdmin, getCircleMembership } from "@/lib/circle-permissions";

export default async function PostDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await getOnboardedUserOrRedirect();
  const { id } = await params;

  const post = await prisma.post.findUnique({
    where: { id },
    include: { ...postCardInclude, author: true },
  });

  if (!post) notFound();

  const isOwnPost = post.authorId === me.id;
  if (post.moderationStatus !== "PUBLISHED" && !isOwnPost && !me.isAdmin) {
    notFound();
  }

  const canView =
    isOwnPost ||
    me.isAdmin ||
    post.author.postsVisibility === "PUBLIC" ||
    Boolean(
      await prisma.connection.findFirst({
        where: {
          status: "ACCEPTED",
          OR: [
            { requesterId: me.id, targetId: post.authorId },
            { requesterId: post.authorId, targetId: me.id },
          ],
        },
      }),
    );
  if (!canView) notFound();

  const [postWithState] = await attachViewerState(
    [
      {
        ...post,
        author: {
          id: post.author.id,
          name: post.author.name,
          username: post.author.username,
          avatarUrl: post.author.avatarUrl,
          trustBand: post.author.trustBand,
        },
      },
    ],
    me.id,
  );

  // Flat, not one level deep — chain comments nest to arbitrary depth, so
  // the tree is built client-side (buildCommentTree) from this list rather
  // than via a fixed-depth Prisma include. REMOVED (hidden) comments are
  // still fetched so their placeholder can hold the thread together; FLAGGED
  // ones (pending automated-moderation review) are excluded, same as before.
  const comments = await prisma.comment.findMany({
    where: { postId: id, moderationStatus: { in: ["PUBLISHED", "REMOVED"] } },
    orderBy: { createdAt: "asc" },
    include: {
      author: { select: { id: true, name: true, username: true, avatarUrl: true } },
      reactions: { select: { emoji: true, userId: true } },
    },
  });

  let canModerate = false;
  if (post.circleId) {
    const circle = await prisma.circle.findUnique({ where: { id: post.circleId } });
    if (circle) {
      const membership = await getCircleMembership(post.circleId, me.id);
      canModerate = isCircleAdmin(circle, membership, me);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <BackButton />

      <PostCard post={postWithState} viewerId={me.id} viewerIsAdmin={me.isAdmin} />

      <div className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-soft">
          Comments
        </h2>
        <CommentComposer postId={id} />
        <CommentList
          comments={comments}
          postId={id}
          postAuthorId={post.authorId}
          viewerId={me.id}
          viewerIsAdmin={me.isAdmin}
          canModerate={canModerate}
        />
      </div>
    </div>
  );
}
