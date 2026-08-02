import { notFound } from "next/navigation";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { PostComposer } from "@/components/post-composer";
import { CircleVoiceRoom } from "@/components/circle-voice-room";
import { CircleMembershipButton } from "@/components/circle-membership-button";
import { DeleteCircleButton } from "@/components/delete-circle-button";
import { PostCard } from "@/components/post-card";
import { BackButton } from "@/components/back-button";
import { postCardInclude, attachViewerState } from "@/lib/post-card-data";

export default async function CirclePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const me = await getOnboardedUserOrRedirect();
  const { slug } = await params;

  const circle = await prisma.circle.findUnique({
    where: { slug },
    include: {
      _count: { select: { members: true } },
      members: { where: { userId: me.id } },
      posts: {
        where: { moderationStatus: "PUBLISHED" },
        orderBy: { createdAt: "desc" },
        take: 30,
        include: postCardInclude,
      },
    },
  });

  if (!circle) notFound();

  const isMember = circle.members.length > 0;
  const isOwner = circle.createdById === me.id;
  const posts = await attachViewerState(circle.posts, me.id);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <BackButton fallbackHref="/circles" />
      <p className="text-xs font-medium uppercase tracking-wide text-teal">
        {circle.category}
      </p>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-4">
        <h1 className="min-w-0 text-2xl font-semibold">{circle.name}</h1>
        <div className="flex items-center gap-2">
          <CircleMembershipButton
            circleId={circle.id}
            isMember={isMember}
            isOwner={isOwner}
          />
          {(isOwner || me.isAdmin) && (
            <DeleteCircleButton circleId={circle.id} isAdminOverride={!isOwner} />
          )}
        </div>
      </div>
      <p className="mt-2 text-sm text-foreground-soft">{circle.description}</p>
      <p className="mt-1 text-xs text-foreground-soft">
        {circle._count.members} members
      </p>

      <div className="mt-8">
        <CircleVoiceRoom circleId={circle.id} canJoin={isMember || isOwner} />
      </div>

      <div className="mt-4">
        {isMember || isOwner ? (
          <PostComposer circleId={circle.id} />
        ) : (
          <p className="rounded-xl border border-line p-4 text-sm text-foreground-soft">
            Join this Circle to post.
          </p>
        )}
      </div>

      <div className="mt-8 space-y-4">
        {posts.map((post) => (
          <PostCard key={post.id} post={post} viewerId={me.id} viewerIsAdmin={me.isAdmin} />
        ))}
        {posts.length === 0 && (
          <p className="text-sm text-foreground-soft">
            No posts yet — be the first.
          </p>
        )}
      </div>
    </div>
  );
}
