import { notFound } from "next/navigation";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { PostComposer } from "@/components/post-composer";
import { CircleMembershipButton } from "@/components/circle-membership-button";
import { PostCard } from "@/components/post-card";

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
        include: { author: { select: { id: true, name: true, trustBand: true } } },
      },
    },
  });

  if (!circle) notFound();

  const isMember = circle.members.length > 0;
  const isOwner = circle.createdById === me.id;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <p className="text-xs font-medium uppercase tracking-wide text-teal">
        {circle.category}
      </p>
      <div className="mt-1 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{circle.name}</h1>
        <CircleMembershipButton
          circleId={circle.id}
          isMember={isMember}
          isOwner={isOwner}
        />
      </div>
      <p className="mt-2 text-sm text-foreground-soft">{circle.description}</p>
      <p className="mt-1 text-xs text-foreground-soft">
        {circle._count.members} members
      </p>

      <div className="mt-8">
        {isMember || isOwner ? (
          <PostComposer circleId={circle.id} />
        ) : (
          <p className="rounded-xl border border-line p-4 text-sm text-foreground-soft">
            Join this Circle to post.
          </p>
        )}
      </div>

      <div className="mt-8 space-y-4">
        {circle.posts.map((post) => (
          <PostCard key={post.id} post={post} />
        ))}
        {circle.posts.length === 0 && (
          <p className="text-sm text-foreground-soft">
            No posts yet — be the first.
          </p>
        )}
      </div>
    </div>
  );
}
