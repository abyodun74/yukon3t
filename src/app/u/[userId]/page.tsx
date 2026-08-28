import { notFound } from "next/navigation";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { TrustBadge } from "@/components/trust-badge";
import { ConnectButton } from "@/components/connect-button";
import { ReportTrigger } from "@/components/report-form";
import { BlockButton } from "@/components/block-button";
import { CallButton } from "@/components/call-button";
import { PostComposer } from "@/components/post-composer";
import { ProfilePostsList } from "@/components/profile-posts-list";
import { EditProfileForm } from "@/components/edit-profile-form";
import { BackButton } from "@/components/back-button";
import { ProfileStoryRing } from "@/components/profile-story-ring";
import { postCardInclude, attachViewerState } from "@/lib/post-card-data";
import { isOnline } from "@/lib/presence";

// Same cursor pagination as /connections/page.tsx, auto-loaded further pages
// as the viewer scrolls (see ProfilePostsList / loadMoreProfilePosts).
const POSTS_PAGE_SIZE = 20;

export default async function PublicProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const me = await getOnboardedUserOrRedirect();
  const { userId } = await params;
  const { error, saved } = await searchParams;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.status !== "ACTIVE" || !user.name) notFound();

  const isOwnProfile = user.id === me.id;
  const online = isOnline(user.lastSeenAt);

  const iBlockedThem = isOwnProfile
    ? false
    : !!(await prisma.block.findUnique({
        where: { blockerId_blockedId: { blockerId: me.id, blockedId: user.id } },
      }));

  const connection = isOwnProfile
    ? null
    : await prisma.connection.findFirst({
        where: {
          OR: [
            { requesterId: me.id, targetId: user.id },
            { requesterId: user.id, targetId: me.id },
          ],
        },
      });

  const conversationId =
    connection?.status === "ACCEPTED"
      ? (
          await prisma.conversation.findFirst({
            where: {
              AND: [
                { members: { some: { userId: me.id } } },
                { members: { some: { userId: user.id } } },
              ],
            },
            select: { id: true },
          })
        )?.id ?? null
      : null;

  const [subscriberCount, subscribingCount] = await Promise.all([
    prisma.subscription.count({ where: { subscribedToId: user.id } }),
    prisma.subscription.count({ where: { subscriberId: user.id } }),
  ]);

  const canSeePosts =
    !iBlockedThem &&
    (isOwnProfile ||
      (user.postsVisibility !== "HIDDEN" &&
        (user.postsVisibility === "PUBLIC" || connection?.status === "ACCEPTED")));

  const rawPosts = canSeePosts
    ? await prisma.post.findMany({
        where: { authorId: user.id, circleId: null, moderationStatus: "PUBLISHED" },
        orderBy: { createdAt: "desc" },
        take: POSTS_PAGE_SIZE,
        include: postCardInclude,
      })
    : [];
  const posts = await attachViewerState(rawPosts, me.id);
  const postsHaveMore = rawPosts.length === POSTS_PAGE_SIZE;

  const activeStories = canSeePosts
    ? await prisma.story.findMany({
        where: { authorId: user.id, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "asc" },
        include: { _count: { select: { views: true } } },
      })
    : [];
  const storiesForRing = activeStories.map((s) => ({
    id: s.id,
    mediaType: s.mediaType,
    mediaUrl: s.mediaUrl,
    mediaThumbnailUrl: s.mediaThumbnailUrl,
    caption: s.caption,
    createdAt: s.createdAt,
    viewCount: s._count.views,
  }));

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <BackButton />

      {saved && (
        <p className="mb-4 rounded-lg bg-success/10 px-4 py-2 text-sm text-success">
          Profile updated.
        </p>
      )}
      {error && (
        <p className="mb-4 rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">
          {error === "moderation"
            ? "Your bio didn't pass our content guidelines."
            : "Please check your inputs."}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-4">
          <ProfileStoryRing
            userId={user.id}
            avatarUrl={user.avatarUrl}
            name={user.name ?? "them"}
            stories={storiesForRing}
            isOwner={isOwnProfile}
            online={online}
          />
          <div className="min-w-0">
            <h1 className="break-words text-2xl font-semibold">{user.name}</h1>
            <p className="text-sm text-foreground-soft">
              {user.country ?? "Unknown location"}
            </p>
            {!isOwnProfile && (
              <p className="text-xs text-foreground-soft">
                {online ? (
                  <span className="text-success">● Online now</span>
                ) : user.lastSeenAt ? (
                  `Last seen ${formatDistanceToNow(user.lastSeenAt, { addSuffix: true })}`
                ) : (
                  "Offline"
                )}
              </p>
            )}
            <div className="mt-1 flex items-center gap-3 text-xs">
              <Link href={`/u/${user.id}/subscribers`} className="hover:text-accent hover:underline">
                <span className="font-semibold">{subscriberCount}</span>{" "}
                <span className="text-foreground-soft">Subscribers</span>
              </Link>
              <Link href={`/u/${user.id}/subscribing`} className="hover:text-accent hover:underline">
                <span className="font-semibold">{subscribingCount}</span>{" "}
                <span className="text-foreground-soft">Subscribing</span>
              </Link>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isOwnProfile && user.currentStreak > 0 && (
            <span className="text-xs text-foreground-soft">
              🔥 {user.currentStreak}-day streak
              {user.longestStreak > user.currentStreak && ` · best: ${user.longestStreak}`}
            </span>
          )}
          <TrustBadge band={user.trustBand} />
        </div>
      </div>

      {user.bio && <p className="mt-4 break-words text-sm">{user.bio}</p>}

      {user.interests.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {user.interests.map((i) => (
            <span
              key={i}
              className="rounded-full bg-line px-2.5 py-0.5 text-xs text-foreground-soft"
            >
              {i}
            </span>
          ))}
        </div>
      )}

      {isOwnProfile ? (
        <div className="mt-6">
          <EditProfileForm user={user} />
        </div>
      ) : iBlockedThem ? (
        <div className="mt-6 flex items-center gap-4">
          <p className="text-sm text-foreground-soft">You&apos;ve blocked this account.</p>
          <BlockButton targetId={user.id} targetName={user.name ?? "them"} initiallyBlocked />
        </div>
      ) : (
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <ConnectButton
            targetId={user.id}
            openToIntents={user.openToIntents}
            status={connection?.status ?? null}
            isRequester={connection?.requesterId === me.id}
            conversationId={conversationId}
          />
          {connection?.status === "ACCEPTED" && (
            <CallButton calleeId={user.id} calleeName={user.name ?? "them"} />
          )}
          <ReportTrigger targetType="USER" targetId={user.id} reportedUserId={user.id} label="Report account" />
          <BlockButton targetId={user.id} targetName={user.name ?? "them"} initiallyBlocked={false} />
        </div>
      )}

      <div className="mt-10 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-soft">
          {isOwnProfile ? "Your posts" : "Posts"}
        </h2>
        {isOwnProfile && <PostComposer />}
        {!canSeePosts && (
          <p className="text-sm text-foreground-soft">
            {user.name} only shares posts with their connections.
          </p>
        )}
        {canSeePosts && posts.length === 0 && (
          <p className="text-sm text-foreground-soft">
            {isOwnProfile
              ? "Nothing posted yet — share a photo, a short video, or an update."
              : "No posts yet."}
          </p>
        )}
        {canSeePosts && posts.length > 0 && (
          <ProfilePostsList
            profileUserId={user.id}
            initialPosts={posts}
            initialHasMore={postsHaveMore}
            viewerId={me.id}
            viewerIsAdmin={me.isAdmin}
          />
        )}
      </div>
    </div>
  );
}
