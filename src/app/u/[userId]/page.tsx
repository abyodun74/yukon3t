import { notFound } from "next/navigation";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { TrustBadge } from "@/components/trust-badge";
import { ConnectButton } from "@/components/connect-button";
import { ReportTrigger } from "@/components/report-form";
import { BlockButton } from "@/components/block-button";
import { CallButton } from "@/components/call-button";
import { PostComposer } from "@/components/post-composer";
import { PostCard } from "@/components/post-card";
import { EditProfileForm } from "@/components/edit-profile-form";
import { BackButton } from "@/components/back-button";
import { ProfileStoryRing } from "@/components/profile-story-ring";
import { postCardInclude, attachViewerState } from "@/lib/post-card-data";

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

  const canSeePosts =
    !iBlockedThem &&
    (isOwnProfile || user.postsVisibility === "PUBLIC" || connection?.status === "ACCEPTED");

  const rawPosts = canSeePosts
    ? await prisma.post.findMany({
        where: { authorId: user.id, circleId: null, moderationStatus: "PUBLISHED" },
        orderBy: { createdAt: "desc" },
        take: 30,
        include: postCardInclude,
      })
    : [];
  const posts = await attachViewerState(rawPosts, me.id);

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
        <div className="flex items-center gap-4">
          <ProfileStoryRing
            avatarUrl={user.avatarUrl}
            name={user.name ?? "them"}
            stories={storiesForRing}
            isOwner={isOwnProfile}
          />
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold">{user.name}</h1>
            <p className="text-sm text-foreground-soft">
              {user.country ?? "Unknown location"}
            </p>
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

      {user.bio && <p className="mt-4 text-sm">{user.bio}</p>}

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
        {canSeePosts &&
          posts.map((post) => (
            <PostCard key={post.id} post={post} viewerId={me.id} viewerIsAdmin={me.isAdmin} />
          ))}
        {canSeePosts && posts.length === 0 && (
          <p className="text-sm text-foreground-soft">
            {isOwnProfile
              ? "Nothing posted yet — share a photo, a short video, or an update."
              : "No posts yet."}
          </p>
        )}
      </div>
    </div>
  );
}
