import { notFound } from "next/navigation";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { PostComposer } from "@/components/post-composer";
import { CircleVoiceRoom } from "@/components/circle-voice-room";
import { CircleMembershipButton } from "@/components/circle-membership-button";
import { DeleteCircleButton } from "@/components/delete-circle-button";
import { CircleCoverUpload } from "@/components/circle-cover-upload";
import { CircleMemberManager } from "@/components/circle-member-manager";
import { PostCard } from "@/components/post-card";
import { BackButton } from "@/components/back-button";
import { postCardInclude, attachViewerState } from "@/lib/post-card-data";
import { isCircleAdmin } from "@/lib/circle-permissions";

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
  const canModerate = isCircleAdmin(circle, circle.members[0] ?? null, me);
  const posts = await attachViewerState(circle.posts, me.id);

  const allMembers = canModerate
    ? await prisma.circleMembership.findMany({
        where: { circleId: circle.id },
        orderBy: { joinedAt: "asc" },
        include: { user: { select: { id: true, name: true, username: true, avatarUrl: true } } },
      })
    : [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <BackButton fallbackHref="/circles" />
      <p className="text-xs font-medium uppercase tracking-wide text-teal">
        {circle.category}
      </p>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {circle.coverImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={circle.coverImageUrl}
              alt=""
              className="h-12 w-12 shrink-0 rounded-xl object-cover"
            />
          )}
          <h1 className="min-w-0 text-2xl font-semibold">{circle.name}</h1>
        </div>
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

      {canModerate && (
        <div className="mt-4">
          <CircleCoverUpload circleId={circle.id} currentUrl={circle.coverImageUrl} />
        </div>
      )}

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

      {canModerate && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-soft">
            Members
          </h2>
          <p className="mt-1 text-xs text-foreground-soft">
            Co-admins get the same management powers as you, except deleting this Circle.
          </p>
          <div className="mt-3">
            <CircleMemberManager circleId={circle.id} members={allMembers} />
          </div>
        </div>
      )}

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
