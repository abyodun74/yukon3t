import Link from "next/link";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { PostComposer } from "@/components/post-composer";
import { PostCard } from "@/components/post-card";
import { StreakBanner } from "@/components/streak-banner";
import { postCardInclude, attachViewerState } from "@/lib/post-card-data";
import { dayNumber } from "@/lib/trust";

const PAGE_SIZE = 30;

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ before?: string }>;
}) {
  const me = await getOnboardedUserOrRedirect();
  const { before } = await searchParams;

  const [circleMemberships, connections] = await Promise.all([
    prisma.circleMembership.findMany({
      where: { userId: me.id },
      select: { circleId: true },
    }),
    prisma.connection.findMany({
      where: { status: "ACCEPTED", OR: [{ requesterId: me.id }, { targetId: me.id }] },
    }),
  ]);

  const circleIds = circleMemberships.map((m) => m.circleId);
  const connectionUserIds = connections.map((c) =>
    c.requesterId === me.id ? c.targetId : c.requesterId,
  );

  const rawPosts = await prisma.post.findMany({
    where: {
      moderationStatus: "PUBLISHED",
      author: { status: "ACTIVE" },
      OR: [
        ...(circleIds.length ? [{ circleId: { in: circleIds } }] : []),
        { authorId: { in: [...connectionUserIds, me.id] } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE,
    ...(before ? { cursor: { id: before }, skip: 1 } : {}),
    include: postCardInclude,
  });

  const posts = await attachViewerState(rawPosts, me.id);
  const lastPost = rawPosts[rawPosts.length - 1];
  const hasMore = rawPosts.length === PAGE_SIZE;
  const activeToday = Boolean(me.lastActiveAt && dayNumber(me.lastActiveAt) === dayNumber(new Date()));

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Home</h1>
      <p className="mt-1 text-sm text-foreground-soft">
        Posts from your Circles and connections.
      </p>

      <StreakBanner
        currentStreak={me.currentStreak}
        longestStreak={me.longestStreak}
        activeToday={activeToday}
      />

      <div className="mt-6">
        <PostComposer placeholder="Share a photo, a short video, or an update..." />
      </div>

      <div className="mt-8 space-y-4">
        {posts.map((post) => (
          <PostCard key={post.id} post={post} viewerId={me.id} viewerIsAdmin={me.isAdmin} />
        ))}
        {posts.length === 0 && (
          <p className="text-sm text-foreground-soft">
            Nothing here yet — join a Circle or connect with someone to see
            their posts.
          </p>
        )}
        {hasMore && lastPost && (
          <Link
            href={`/home?before=${lastPost.id}`}
            className="block rounded-lg border border-line px-4 py-2.5 text-center text-sm font-medium hover:border-accent hover:text-accent"
          >
            Load more
          </Link>
        )}
      </div>
    </div>
  );
}
