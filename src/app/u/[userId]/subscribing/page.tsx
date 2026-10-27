import { notFound } from "next/navigation";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { BackButton } from "@/components/back-button";
import { SubscribingList } from "@/components/subscriptions-list";
import { format } from "@/lib/i18n/locales";
import { getDictionary } from "@/lib/i18n/server";

// Same cursor pagination as /connections/page.tsx, auto-loaded further pages
// as the viewer scrolls (see SubscribingList / loadMoreSubscribing).
const PAGE_SIZE = 20;

export default async function SubscribingPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const me = await getOnboardedUserOrRedirect();
  const { userId } = await params;
  const dictionary = await getDictionary();
  const t = dictionary.profile.page;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  // The shared guest-preview identity (src/lib/guest-preview.ts) has no profile and no lists.
  if (!user || user.status !== "ACTIVE" || !user.name || user.isGuestPreview) notFound();
  // Site admins are invisible platform-wide — see the same guard on
  // /u/[userId] itself.
  if (user.isAdmin && user.id !== me.id) notFound();

  const rows = await prisma.subscription.findMany({
    // Same admin exclusion as /u/[userId]/subscribers, kept in sync with
    // loadMoreSubscribing in actions/subscriptions.ts.
    where: { subscriberId: userId, subscribedTo: { isAdmin: false } },
    include: {
      subscribedTo: { select: { id: true, name: true, username: true, avatarUrl: true, trustBand: true } },
    },
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE,
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
      <BackButton label={dictionary.shell.common.back} />

      <h1 className="mt-2 text-2xl font-semibold">
        {user.id === me.id ? t.yourSubscribing : format(t.subscribingOf, { name: user.name })}
      </h1>

      <div className="mt-6 space-y-3">
        <SubscribingList
          profileUserId={userId}
          initialItems={rows.map((r) => ({
            id: r.id,
            user: r.subscribedTo,
            subscribedByViewer: subscribedByMeSet.has(r.subscribedTo.id),
          }))}
          initialHasMore={hasMore}
          viewerId={me.id}
        />
      </div>
    </div>
  );
}
