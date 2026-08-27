import { notFound } from "next/navigation";
import Link from "next/link";
import { Lock } from "lucide-react";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { PostComposer } from "@/components/post-composer";
import { CircleVoiceRoom } from "@/components/circle-voice-room";
import { CircleMembershipButton } from "@/components/circle-membership-button";
import { DeleteCircleButton } from "@/components/delete-circle-button";
import { CircleCoverUpload } from "@/components/circle-cover-upload";
import { CircleMemberManager } from "@/components/circle-member-manager";
import { CircleJoinRequestManager } from "@/components/circle-join-request-manager";
import { ChannelList } from "@/components/channel-list";
import { CircleSwitcher } from "@/components/circle-switcher";
import { ChannelSettingsModal } from "@/components/channel-settings-modal";
import { PostCard } from "@/components/post-card";
import { BackButton } from "@/components/back-button";
import { postCardInclude, attachViewerState } from "@/lib/post-card-data";
import { isCircleAdmin } from "@/lib/circle-permissions";
import { getMyCircles } from "@/app/actions/circles";

// Same cursor + "Load more" pattern as /connections/page.tsx.
const POSTS_PAGE_SIZE = 20;

export default async function CirclePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ channel?: string; postsBefore?: string }>;
}) {
  const me = await getOnboardedUserOrRedirect();
  const { slug } = await params;
  const { channel: requestedSlug, postsBefore } = await searchParams;

  const [circle, { circles: myCircles }] = await Promise.all([
    prisma.circle.findUnique({
      where: { slug },
      include: {
        _count: { select: { members: true } },
        members: { where: { userId: me.id } },
        channels: {
          orderBy: { position: "asc" },
          include: { members: { select: { userId: true } } },
        },
      },
    }),
    getMyCircles(),
  ]);

  if (!circle) notFound();

  const isMember = circle.members.length > 0;
  const isOwner = circle.createdById === me.id;
  const canModerate = isCircleAdmin(circle, circle.members[0] ?? null, me);

  const myJoinRequest = !isMember
    ? await prisma.circleJoinRequest.findUnique({
        where: { circleId_userId: { circleId: circle.id, userId: me.id } },
      })
    : null;
  const hasPendingRequest = myJoinRequest?.status === "PENDING";

  const isPrivateNonMember = circle.visibility === "PRIVATE" && !isMember && !canModerate;

  const pendingJoinRequests =
    canModerate && circle.visibility === "PRIVATE"
      ? await prisma.circleJoinRequest.findMany({
          where: { circleId: circle.id, status: "PENDING" },
          orderBy: { createdAt: "asc" },
          include: { user: { select: { id: true, name: true, username: true, avatarUrl: true } } },
        })
      : [];

  const accessibleChannels = circle.channels.filter(
    (c) => c.visibility === "PUBLIC" || canModerate || c.members.some((m) => m.userId === me.id),
  );
  const activeChannel =
    accessibleChannels.find((c) => c.slug === requestedSlug) ??
    accessibleChannels.find((c) => c.slug === "general") ??
    accessibleChannels[0] ??
    null;

  const rawPosts =
    activeChannel?.type === "TEXT"
      ? await prisma.post.findMany({
          where: { channelId: activeChannel.id, moderationStatus: "PUBLISHED" },
          orderBy: { createdAt: "desc" },
          take: POSTS_PAGE_SIZE,
          ...(postsBefore ? { cursor: { id: postsBefore }, skip: 1 } : {}),
          include: postCardInclude,
        })
      : [];
  const posts = await attachViewerState(rawPosts, me.id);
  const postsHaveMore = rawPosts.length === POSTS_PAGE_SIZE;

  const allMembers = isMember || isOwner
    ? await prisma.circleMembership.findMany({
        where: { circleId: circle.id },
        orderBy: { joinedAt: "asc" },
        include: { user: { select: { id: true, name: true, username: true, avatarUrl: true } } },
      })
    : [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <BackButton fallbackHref="/circles" />
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <p className="min-w-0 break-words text-xs font-medium uppercase tracking-wide text-teal">{circle.category.join(", ")}</p>
        {circle.visibility === "PRIVATE" && (
          <span title="Private Circle" className="flex items-center text-foreground-soft">
            <Lock size={12} />
          </span>
        )}
      </div>
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
          <h1 className="min-w-0 break-words text-2xl font-semibold">{circle.name}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CircleMembershipButton
            circleId={circle.id}
            isMember={isMember}
            isOwner={isOwner}
            visibility={circle.visibility}
            hasPendingRequest={hasPendingRequest}
          />
          {(isOwner || me.isAdmin) && (
            <DeleteCircleButton circleId={circle.id} isAdminOverride={!isOwner} />
          )}
        </div>
      </div>
      <p className="mt-2 break-words text-sm text-foreground-soft">{circle.description}</p>
      <p className="mt-1 text-xs text-foreground-soft">
        {circle._count.members} members
      </p>

      {isPrivateNonMember ? (
        <p className="mt-8 rounded-xl border border-line p-4 text-sm text-foreground-soft">
          This Circle is private. Request to join to see its channels and posts.
        </p>
      ) : (
        <>
          {canModerate && (
            <div className="mt-4">
              <CircleCoverUpload circleId={circle.id} currentUrl={circle.coverImageUrl} />
            </div>
          )}

          {canModerate && <CircleJoinRequestManager requests={pendingJoinRequests} />}

          <div className="mt-8 grid gap-6 md:grid-cols-[64px_200px_1fr]">
            <CircleSwitcher circles={myCircles} activeCircleId={circle.id} />

            <ChannelList
              circleId={circle.id}
              circleSlug={circle.slug}
              channels={accessibleChannels}
              activeSlug={activeChannel?.slug ?? ""}
              canManage={canModerate}
            />

            <div className="min-w-0">
              {activeChannel ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="truncate font-semibold">#{activeChannel.name}</h2>
                      {activeChannel.topic && (
                        <p className="truncate text-xs text-foreground-soft">{activeChannel.topic}</p>
                      )}
                    </div>
                    {canModerate && (
                      <ChannelSettingsModal
                        channel={activeChannel}
                        circleSlug={circle.slug}
                        circleMembers={allMembers.map((m) => m.user)}
                        channelMemberIds={activeChannel.members.map((m) => m.userId)}
                      />
                    )}
                  </div>

                  {activeChannel.type === "VOICE" ? (
                    <div className="mt-4">
                      <CircleVoiceRoom
                        key={activeChannel.id}
                        channelId={activeChannel.id}
                        canJoin={isMember || isOwner}
                        circleMembers={allMembers.map((m) => m.user)}
                      />
                    </div>
                  ) : (
                    <>
                      <div className="mt-4">
                        {isMember || isOwner ? (
                          <PostComposer circleId={circle.id} channelId={activeChannel.id} />
                        ) : (
                          <p className="rounded-xl border border-line p-4 text-sm text-foreground-soft">
                            Join this Circle to post.
                          </p>
                        )}
                      </div>
                      <div className="mt-6 space-y-4">
                        {posts.map((post) => (
                          <PostCard key={post.id} post={post} viewerId={me.id} viewerIsAdmin={me.isAdmin} />
                        ))}
                        {posts.length === 0 && (
                          <p className="text-sm text-foreground-soft">No posts yet — be the first.</p>
                        )}
                        {postsHaveMore && (
                          <Link
                            href={`/circles/${circle.slug}?${new URLSearchParams({
                              ...(activeChannel?.slug ? { channel: activeChannel.slug } : {}),
                              postsBefore: posts[posts.length - 1].id,
                            }).toString()}`}
                            className="block rounded-lg border border-line px-4 py-2.5 text-center text-sm font-medium hover:border-accent hover:text-accent"
                          >
                            Load more
                          </Link>
                        )}
                      </div>
                    </>
                  )}
                </>
              ) : (
                <p className="text-sm text-foreground-soft">No channels available.</p>
              )}
            </div>
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
        </>
      )}
    </div>
  );
}
