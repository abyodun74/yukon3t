import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock, Radio } from "lucide-react";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { PostComposer } from "@/components/post-composer";
import { CircleVoiceRoom } from "@/components/circle-voice-room";
import { CircleMembershipButton } from "@/components/circle-membership-button";
import { DeleteCircleButton } from "@/components/delete-circle-button";
import { CircleCoverUpload } from "@/components/circle-cover-upload";
import { CircleMemberManager } from "@/components/circle-member-manager";
import { CircleMemberList } from "@/components/circle-member-list";
import { CircleJoinRequestManager } from "@/components/circle-join-request-manager";
import { ChannelList } from "@/components/channel-list";
import { CircleSwitcher } from "@/components/circle-switcher";
import { ChannelSettingsModal } from "@/components/channel-settings-modal";
import { CircleDetailsEditModal } from "@/components/circle-details-edit-modal";
import { SubCircleList } from "@/components/sub-circle-list";
import { CIRCLE_CATEGORIES } from "@/lib/circle-categories";
import { CirclePostsList } from "@/components/circle-posts-list";
import { BackButton } from "@/components/back-button";
import { postCardInclude, attachViewerState } from "@/lib/post-card-data";
import { isCircleAdmin } from "@/lib/circle-permissions";
import { getMyCircles } from "@/app/actions/circles";
import { CirclePostFab } from "@/components/circle-post-fab";

// Same cursor pagination as /connections/page.tsx, auto-loaded further pages
// as the viewer scrolls (see CirclePostsList / loadMoreCirclePosts).
const POSTS_PAGE_SIZE = 20;

export default async function CirclePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ channel?: string }>;
}) {
  const me = await getOnboardedUserOrRedirect();
  const { slug } = await params;
  const { channel: requestedSlug } = await searchParams;

  const [circle, { circles: myCircles }] = await Promise.all([
    prisma.circle.findUnique({
      where: { slug },
      include: {
        _count: { select: { members: true } },
        members: { where: { userId: me.id } },
        // Set only on a sub-circle: its main Circle, for the "Part of …" link.
        parent: { select: { name: true, slug: true } },
        // Set only on a main Circle: its sub-circles, listed on this page.
        subCircles: {
          orderBy: { createdAt: "asc" },
          include: {
            _count: { select: { members: true } },
            members: { where: { userId: me.id }, select: { role: true } },
          },
        },
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

  const isPrivateNonMember = circle.visibility === "PRIVATE" && !isMember && !canModerate;
  // A Circle's posts, channels, voice rooms and live streams are for its MEMBERS only — public Circle or private.
  // "Public" only means anyone can find it and join; it doesn't put the Circle's content in front of non-members.
  const isNonMember = !isMember && !canModerate;

  const accessibleChannels = circle.channels.filter(
    (c) => c.visibility === "PUBLIC" || canModerate || c.members.some((m) => m.userId === me.id),
  );
  const activeChannel =
    accessibleChannels.find((c) => c.slug === requestedSlug) ??
    accessibleChannels.find((c) => c.slug === "general") ??
    accessibleChannels[0] ??
    null;

  // None of these four depend on one another — each only needs `circle`/
  // `canModerate`/`activeChannel`, already resolved above — so they run
  // together rather than as four sequential round trips.
  const [myJoinRequest, pendingJoinRequests, rawPosts, allMembers, circleLiveStreams, mySubCircleRequests] = await Promise.all([
    !isMember
      ? prisma.circleJoinRequest.findUnique({
          where: { circleId_userId: { circleId: circle.id, userId: me.id } },
        })
      : Promise.resolve(null),

    canModerate && circle.visibility === "PRIVATE"
      ? prisma.circleJoinRequest.findMany({
          where: { circleId: circle.id, status: "PENDING" },
          orderBy: { createdAt: "asc" },
          include: { user: { select: { id: true, name: true, username: true, avatarUrl: true } } },
        })
      : Promise.resolve([]),

    activeChannel?.type === "TEXT" && !isNonMember
      ? prisma.post.findMany({
          where: { channelId: activeChannel.id, moderationStatus: "PUBLISHED" },
          orderBy: { createdAt: "desc" },
          take: POSTS_PAGE_SIZE,
          include: postCardInclude,
        })
      : Promise.resolve([]),

    isMember || isOwner
      ? prisma.circleMembership.findMany({
          where: { circleId: circle.id },
          orderBy: { joinedAt: "asc" },
          include: { user: { select: { id: true, name: true, username: true, avatarUrl: true } } },
        })
      : Promise.resolve([]),

    // Circle-scoped live streams happening now — shown here (to members only) and nowhere else in the app.
    !isNonMember
      ? prisma.liveStream.findMany({
          where: { circleId: circle.id, status: "LIVE" },
          orderBy: { startedAt: "desc" },
          take: 10,
          select: { id: true, title: true, host: { select: { name: true, username: true } } },
        })
      : Promise.resolve([]),

    // Which of this Circle's sub-circles the viewer has a pending join
    // request to — so a private sub-circle's button reads "Request pending".
    circle.subCircles.length > 0
      ? prisma.circleJoinRequest.findMany({
          where: { userId: me.id, status: "PENDING", circleId: { in: circle.subCircles.map((s) => s.id) } },
          select: { circleId: true },
        })
      : Promise.resolve([]),
  ]);
  const hasPendingRequest = myJoinRequest?.status === "PENDING";
  const posts = await attachViewerState(rawPosts, me.id);
  const postsHaveMore = rawPosts.length === POSTS_PAGE_SIZE;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <BackButton fallbackHref="/circles" />
      {circle.parent && (
        <p className="text-xs text-foreground-soft">
          Sub-circle of{" "}
          <Link href={`/circles/${circle.parent.slug}`} className="font-medium text-accent hover:underline">
            {circle.parent.name}
          </Link>
        </p>
      )}
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
              alt={circle.name}
              className="h-12 w-12 shrink-0 rounded-xl object-cover"
            />
          )}
          <h1 className="min-w-0 break-words text-2xl font-semibold">{circle.name}</h1>
          {canModerate && (
            <CircleDetailsEditModal
              circleId={circle.id}
              name={circle.name}
              description={circle.description}
              category={circle.category}
              categoryOptions={CIRCLE_CATEGORIES}
            />
          )}
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
            <DeleteCircleButton
              circleId={circle.id}
              isAdminOverride={!isOwner}
              subCircleCount={circle.subCircles.length}
            />
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

          <SubCircleList
            parentSlug={circle.slug}
            subCircles={circle.subCircles}
            viewerId={me.id}
            pendingRequestCircleIds={mySubCircleRequests.map((r) => r.circleId)}
            canAdd={isOwner && !circle.parentId}
          />

          {isNonMember ? (
            <p className="mt-8 rounded-xl border border-line p-4 text-sm text-foreground-soft">
              Join this Circle to see its channels, posts and live streams — they&apos;re only visible to members.
            </p>
          ) : (
          <>
          {circleLiveStreams.length > 0 && (
            <div className="mt-6 space-y-2" data-testid="circle-live-now">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-danger">
                <Radio size={14} />
                Live now
              </h2>
              {circleLiveStreams.map((s) => (
                <Link
                  key={s.id}
                  href={`/live/${s.id}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-danger/40 px-4 py-3 text-sm hover:border-danger"
                >
                  <span className="min-w-0 truncate font-medium">{s.title}</span>
                  <span className="shrink-0 text-xs text-foreground-soft">{s.host.name ?? s.host.username}</span>
                </Link>
              ))}
            </div>
          )}

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
                          <div id="circle-composer">
                            <PostComposer circleId={circle.id} channelId={activeChannel.id} />
                          </div>
                        ) : (
                          <p className="rounded-xl border border-line p-4 text-sm text-foreground-soft">
                            Join this Circle to post.
                          </p>
                        )}
                      </div>
                      <div className="mt-6 space-y-4">
                        {posts.length === 0 && (
                          <p className="text-sm text-foreground-soft">No posts yet — be the first.</p>
                        )}
                        {posts.length > 0 && (
                          <CirclePostsList
                            // Remounts (fresh client state) when the active
                            // channel changes — same reasoning as Home's own
                            // PostFeedSection key (src/app/home/page.tsx).
                            key={activeChannel.id}
                            channelId={activeChannel.id}
                            initialPosts={posts}
                            initialHasMore={postsHaveMore}
                            viewerId={me.id}
                            viewerIsAdmin={me.isAdmin}
                          />
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
          </>
          )}

          {canModerate ? (
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
          ) : (
            // canModerate already covers the owner (see isCircleAdmin), so
            // this branch is reached by a plain member only.
            isMember && (
              <div className="mt-8">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-soft">
                  Members
                </h2>
                <div className="mt-3">
                  <CircleMemberList members={allMembers} />
                </div>
              </div>
            )
          )}
        </>
      )}

      <CirclePostFab />
    </div>
  );
}
