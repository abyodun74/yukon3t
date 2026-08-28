import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { IncomingRequestsList, SentRequestsList, ConnectedList } from "@/components/connections-lists";

// Each of the three lists below is its own unbounded query — a long-time
// user with dozens/hundreds of connections would otherwise turn this into
// an ever-growing single page. Paginated independently, same cursor
// pagination as the Home feed, auto-loading further pages as the viewer
// scrolls (see src/lib/use-infinite-scroll.ts) instead of a tap-to-load
// "Load more" link.
const PAGE_SIZE = 20;

export default async function ConnectionsPage() {
  const me = await getOnboardedUserOrRedirect();

  const [incoming, outgoing, accepted] = await Promise.all([
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
    prisma.connection.findMany({
      where: {
        status: "ACCEPTED",
        OR: [{ requesterId: me.id }, { targetId: me.id }],
      },
      include: {
        requester: { select: { id: true, name: true, username: true, avatarUrl: true, trustBand: true, lastSeenAt: true } },
        target: { select: { id: true, name: true, username: true, avatarUrl: true, trustBand: true, lastSeenAt: true } },
      },
      orderBy: { respondedAt: "desc" },
      take: PAGE_SIZE,
    }),
  ]);

  const incomingHasMore = incoming.length === PAGE_SIZE;
  const sentHasMore = outgoing.length === PAGE_SIZE;
  const connectedHasMore = accepted.length === PAGE_SIZE;

  // Maps each connected user on *this page* to their shared conversation, so
  // "Connected" can link straight into the chat instead of just the
  // profile — scoped to just these otherIds rather than every conversation
  // the viewer is in (group chats, Circle channels, etc.), which would be
  // its own unbounded query otherwise.
  const otherIds = accepted.map((c) => (c.requesterId === me.id ? c.target.id : c.requester.id));
  const myConversations = otherIds.length
    ? await prisma.conversation.findMany({
        where: {
          AND: [
            { members: { some: { userId: me.id } } },
            { members: { some: { userId: { in: otherIds } } } },
          ],
        },
        include: { members: { select: { userId: true } } },
      })
    : [];
  const conversationIdByUserId = new Map<string, string>();
  for (const c of myConversations) {
    const other = c.members.find((m) => m.userId !== me.id);
    if (other) conversationIdByUserId.set(other.userId, c.id);
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-10">
      <div>
        <h1 className="text-2xl font-semibold">Connections</h1>
      </div>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-soft">
          Incoming requests
        </h2>
        <div className="mt-3 space-y-3">
          <IncomingRequestsList initialItems={incoming} initialHasMore={incomingHasMore} />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-soft">
          Sent requests
        </h2>
        <div className="mt-3 space-y-3">
          <SentRequestsList initialItems={outgoing} initialHasMore={sentHasMore} />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-soft">
          Connected
        </h2>
        <div className="mt-3 space-y-3">
          <ConnectedList
            initialItems={accepted.map((c) => {
              const other = c.requesterId === me.id ? c.target : c.requester;
              return {
                id: c.id,
                other,
                intentTag: c.intentTag,
                conversationId: conversationIdByUserId.get(other.id) ?? null,
              };
            })}
            initialHasMore={connectedHasMore}
          />
        </div>
      </section>
    </div>
  );
}
