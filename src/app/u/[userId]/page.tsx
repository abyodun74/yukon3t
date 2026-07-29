import { notFound } from "next/navigation";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { TrustBadge } from "@/components/trust-badge";
import { ConnectButton } from "@/components/connect-button";
import { ReportButton } from "@/components/report-form";
import { PostComposer } from "@/components/post-composer";
import { PostCard } from "@/components/post-card";

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const me = await getOnboardedUserOrRedirect();
  const { userId } = await params;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.status !== "ACTIVE" || !user.name) notFound();

  const posts = await prisma.post.findMany({
    where: { authorId: user.id, circleId: null, moderationStatus: "PUBLISHED" },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: { author: { select: { id: true, name: true, trustBand: true } } },
  });

  const isOwnProfile = user.id === me.id;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="flex items-center justify-between">
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
          <div>
            <h1 className="text-2xl font-semibold">{user.name}</h1>
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

      {!isOwnProfile && (
        <div className="mt-6 flex items-center gap-4">
          <ConnectButton targetId={user.id} openToIntents={user.openToIntents} />
          <ReportButton targetType="USER" targetId={user.id} reportedUserId={user.id} />
        </div>
      )}

      <div className="mt-10 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-soft">
          {isOwnProfile ? "Your posts" : "Posts"}
        </h2>
        {isOwnProfile && <PostComposer />}
        {posts.map((post) => (
          <PostCard key={post.id} post={post} />
        ))}
        {posts.length === 0 && (
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
