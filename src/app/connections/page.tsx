import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { ConnectionsTabs } from "@/components/connections-tabs";
import { getInitialAcceptedConnections } from "@/app/actions/connections";
import { ConnectionsFindPeopleFab } from "@/components/connections-find-people-fab";

// Each of the three lists below is its own unbounded query — a long-time
// user with dozens/hundreds of connections would otherwise turn this into
// an ever-growing single page. Paginated independently, same cursor
// pagination as the Home feed, auto-loading further pages as the viewer
// scrolls (see src/lib/use-infinite-scroll.ts) instead of a tap-to-load
// "Load more" link.
const PAGE_SIZE = 20;

export default async function ConnectionsPage() {
  const me = await getOnboardedUserOrRedirect();

  const [incoming, outgoing, connected, incomingCount, outgoingCount] = await Promise.all([
    prisma.connection.findMany({
      where: { targetId: me.id, status: "PENDING" },
      include: { requester: { select: { id: true, name: true, username: true, avatarUrl: true, trustBand: true, lastSeenAt: true } } },
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
    }),
    prisma.connection.findMany({
      where: { requesterId: me.id, status: "PENDING" },
      include: { target: { select: { id: true, name: true, username: true, avatarUrl: true, trustBand: true, lastSeenAt: true } } },
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
    }),
    // Ordered by most recent DM activity (not respondedAt) — see
    // getInitialAcceptedConnections in actions/connections.ts, also used
    // by the "Connected" tab's own auto-load-more.
    getInitialAcceptedConnections(me.id),
    // Exact counts for the tab pills — initialItems.length is capped at
    // PAGE_SIZE and would silently undercount past the first page.
    prisma.connection.count({ where: { targetId: me.id, status: "PENDING" } }),
    prisma.connection.count({ where: { requesterId: me.id, status: "PENDING" } }),
  ]);

  const incomingHasMore = incoming.length === PAGE_SIZE;
  const sentHasMore = outgoing.length === PAGE_SIZE;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Connections</h1>
      </div>

      <ConnectionsTabs
        connected={connected}
        incoming={{ items: incoming, hasMore: incomingHasMore, count: incomingCount }}
        sent={{ items: outgoing, hasMore: sentHasMore, count: outgoingCount }}
      />
      <ConnectionsFindPeopleFab />
    </div>
  );
}
