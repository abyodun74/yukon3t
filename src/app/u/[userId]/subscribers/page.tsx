import { notFound } from "next/navigation";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { BackButton } from "@/components/back-button";
import { SubscribersList } from "@/components/subscriptions-list";

// Same cursor pagination as /connections/page.tsx, auto-loaded further pages
// as the viewer scrolls (see SubscribersList / loadMoreSubscribers).
const PAGE_SIZE = 20;

export default async function SubscribersPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const me = await getOnboardedUserOrRedirect();
  const { userId } = await params;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.status !== "ACTIVE" || !user.name) notFound();

  const rows = await prisma.subscription.findMany({
    where: { subscribedToId: userId },
    include: {
      subscriber: { select: { id: true, name: true, username: true, avatarUrl: true, trustBand: true } },
    },
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE,
  });
  const hasMore = rows.length === PAGE_SIZE;

  const listedIds = rows.map((r) => r.subscriber.id).filter((id) => id !== me.id);
  const myOwnSubscriptions = listedIds.length
    ? await prisma.subscription.findMany({
        where: { subscriberId: me.id, subscribedToId: { in: listedIds } },
        select: { subscribedToId: true },
      })
    : [];
  const subscribedByMeSet = new Set(myOwnSubscriptions.map((s) => s.subscribedToId));

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <BackButton />

      <h1 className="mt-2 text-2xl font-semibold">
        {user.id === me.id ? "Your subscribers" : `${user.name}'s subscribers`}
      </h1>

      <div className="mt-6 space-y-3">
        <SubscribersList
          profileUserId={userId}
          initialItems={rows.map((r) => ({
            id: r.id,
            user: r.subscriber,
            subscribedByViewer: subscribedByMeSet.has(r.subscriber.id),
          }))}
          initialHasMore={hasMore}
          viewerId={me.id}
        />
      </div>
    </div>
  );
}
