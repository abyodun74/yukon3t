import { notFound } from "next/navigation";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { TrustBadge } from "@/components/trust-badge";
import { ConnectButton } from "@/components/connect-button";
import { ReportTrigger } from "@/components/report-form";
import { CallButton } from "@/components/call-button";
import { PostComposer } from "@/components/post-composer";
import { PostCard } from "@/components/post-card";
import { EditProfileForm } from "@/components/edit-profile-form";
import { BackButton } from "@/components/back-button";
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
    isOwnProfile || user.postsVisibility === "PUBLIC" || connection?.status === "ACCEPTED";

  const rawPosts = canSeePosts
    ? await prisma.post.findMany({
        where: { authorId: user.id, circleId: null, moderationStatus: "PUBLISHED" },
        orderBy: { createdAt: "desc" },
        take: 30,
        include: postCardInclude,
      })
    : [];
  const posts = await attachViewerState(rawPosts, me.id);

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
          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full border border-line bg-surface">
            {user.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-foreground-soft">
                No photo
              </div>
            )}
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold">{user.name}</h1>
            <p className="text-sm text-foreground-soft">
              {user.country ?? "Unknown location"}
            </p>
          </div>
        </div>
        <TrustBadge band={user.trustBand} />
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
