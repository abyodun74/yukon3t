import { notFound } from "next/navigation";
import Link from "next/link";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { BackButton } from "@/components/back-button";
import { TrustBadge } from "@/components/trust-badge";
import { UserLink } from "@/components/user-link";
import { SubscribeButton } from "@/components/subscribe-button";

// Same cursor + "Load more" pagination pattern as /connections/page.tsx.
const PAGE_SIZE = 20;

export default async function SubscribingPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ before?: string }>;
}) {
  const me = await getOnboardedUserOrRedirect();
  const { userId } = await params;
  const { before } = await searchParams;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.status !== "ACTIVE" || !user.name) notFound();

  const rows = await prisma.subscription.findMany({
    where: { subscriberId: userId },
    include: {
      subscribedTo: { select: { id: true, name: true, username: true, avatarUrl: true, trustBand: true } },
    },
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE,
    ...(before ? { cursor: { id: before }, skip: 1 } : {}),
  });
  const hasMore = rows.length === PAGE_SIZE;

  const listedIds = rows.map((r) => r.subscribedTo.id).filter((id) => id !== me.id);
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
        {user.id === me.id ? "Who you subscribe to" : `Who ${user.name} subscribes to`}
      </h1>

      <div className="mt-6 space-y-3">
        {rows.map((r) => (
          <div
            key={r.id}
            className="flex items-center justify-between gap-2 rounded-xl border border-line p-4"
          >
            <div className="flex min-w-0 items-center gap-2">
              <UserLink
                userId={r.subscribedTo.id}
                name={r.subscribedTo.name}
                username={r.subscribedTo.username}
                avatarUrl={r.subscribedTo.avatarUrl}
              />
              <TrustBadge band={r.subscribedTo.trustBand} />
            </div>
            {r.subscribedTo.id !== me.id && (
              <SubscribeButton
                targetId={r.subscribedTo.id}
                initiallySubscribed={subscribedByMeSet.has(r.subscribedTo.id)}
                variant="pill"
              />
            )}
          </div>
        ))}
        {rows.length === 0 && (
          <p className="text-sm text-foreground-soft">Not subscribed to anyone yet.</p>
        )}
        {hasMore && (
          <Link
            href={`/u/${userId}/subscribing?before=${rows[rows.length - 1].id}`}
            className="block rounded-lg border border-line px-4 py-2.5 text-center text-sm font-medium hover:border-accent hover:text-accent"
          >
            Load more
          </Link>
        )}
      </div>
    </div>
  );
}
