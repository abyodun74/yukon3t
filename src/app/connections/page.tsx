import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { ConnectionResponseButtons } from "@/components/connection-response-buttons";
import { TrustBadge } from "@/components/trust-badge";
import { UserLink } from "@/components/user-link";
import Link from "next/link";
import { intentLabels } from "@/lib/validations";

// Each of the three lists below is its own unbounded query — a long-time
// user with dozens/hundreds of connections would otherwise turn this into
// an ever-growing single page. Paginated independently (same cursor +
// "Load more" pattern as the Home feed) so the page stays a normal length
// by default, same as everywhere else in the app.
const PAGE_SIZE = 20;

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ incomingBefore?: string; sentBefore?: string; connectedBefore?: string }>;
}) {
  const me = await getOnboardedUserOrRedirect();
  const { incomingBefore, sentBefore, connectedBefore } = await searchParams;

  const [incoming, outgoing, accepted] = await Promise.all([
    prisma.connection.findMany({
      where: { targetId: me.id, status: "PENDING" },
      include: { requester: { select: { id: true, name: true, username: true, avatarUrl: true, trustBand: true } } },
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      ...(incomingBefore ? { cursor: { id: incomingBefore }, skip: 1 } : {}),
    }),
    prisma.connection.findMany({
      where: { requesterId: me.id, status: "PENDING" },
      include: { target: { select: { id: true, name: true, username: true, avatarUrl: true, trustBand: true } } },
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      ...(sentBefore ? { cursor: { id: sentBefore }, skip: 1 } : {}),
    }),
    prisma.connection.findMany({
      where: {
        status: "ACCEPTED",
        OR: [{ requesterId: me.id }, { targetId: me.id }],
      },
      include: {
        requester: { select: { id: true, name: true, username: true, avatarUrl: true, trustBand: true } },
        target: { select: { id: true, name: true, username: true, avatarUrl: true, trustBand: true } },
      },
      orderBy: { respondedAt: "desc" },
      take: PAGE_SIZE,
      ...(connectedBefore ? { cursor: { id: connectedBefore }, skip: 1 } : {}),
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

  const preserveQuery = (overrides: Record<string, string>) => {
    const params = new URLSearchParams();
    if (incomingBefore) params.set("incomingBefore", incomingBefore);
    if (sentBefore) params.set("sentBefore", sentBefore);
    if (connectedBefore) params.set("connectedBefore", connectedBefore);
    for (const [key, value] of Object.entries(overrides)) params.set(key, value);
    return `/connections?${params.toString()}`;
  };

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
          {incoming.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between rounded-xl border border-line p-4"
            >
              <div>
                <div className="flex items-center gap-2">
                  <UserLink
                    userId={c.requester.id}
                    name={c.requester.name}
                    username={c.requester.username}
                    avatarUrl={c.requester.avatarUrl}
                  />
                  <TrustBadge band={c.requester.trustBand} />
                </div>
                <p className="text-xs text-foreground-soft">
                  wants to connect for {intentLabels[c.intentTag]}
                </p>
              </div>
              <ConnectionResponseButtons connectionId={c.id} />
            </div>
          ))}
          {incoming.length === 0 && (
            <p className="text-sm text-foreground-soft">No pending requests.</p>
          )}
          {incomingHasMore && (
            <Link
              href={preserveQuery({ incomingBefore: incoming[incoming.length - 1].id })}
              className="block rounded-lg border border-line px-4 py-2.5 text-center text-sm font-medium hover:border-accent hover:text-accent"
            >
              Load more
            </Link>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-soft">
          Sent requests
        </h2>
        <div className="mt-3 space-y-3">
          {outgoing.map((c) => (
            <div key={c.id} className="rounded-xl border border-line p-4">
              <div className="flex items-center gap-2">
                <UserLink
                  userId={c.target.id}
                  name={c.target.name}
                  username={c.target.username}
                  avatarUrl={c.target.avatarUrl}
                />
                <TrustBadge band={c.target.trustBand} />
              </div>
              <p className="text-xs text-foreground-soft">
                {intentLabels[c.intentTag]} — awaiting response
              </p>
            </div>
          ))}
          {outgoing.length === 0 && (
            <p className="text-sm text-foreground-soft">No pending sent requests.</p>
          )}
          {sentHasMore && (
            <Link
              href={preserveQuery({ sentBefore: outgoing[outgoing.length - 1].id })}
              className="block rounded-lg border border-line px-4 py-2.5 text-center text-sm font-medium hover:border-accent hover:text-accent"
            >
              Load more
            </Link>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-soft">
          Connected
        </h2>
        <div className="mt-3 space-y-3">
          {accepted.map((c) => {
            const other = c.requesterId === me.id ? c.target : c.requester;
            const conversationId = conversationIdByUserId.get(other.id);
            return (
              <div
                key={c.id}
                className="flex items-center justify-between rounded-xl border border-line p-4"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <UserLink
                      userId={other.id}
                      name={other.name}
                      username={other.username}
                      avatarUrl={other.avatarUrl}
                    />
                    <TrustBadge band={other.trustBand} />
                  </div>
                  <span className="text-xs text-foreground-soft">
                    {intentLabels[c.intentTag]}
                  </span>
                </div>
                {conversationId && (
                  <Link
                    href={`/messages/${conversationId}`}
                    className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink"
                  >
                    Message
                  </Link>
                )}
              </div>
            );
          })}
          {accepted.length === 0 && (
            <p className="text-sm text-foreground-soft">No connections yet.</p>
          )}
          {connectedHasMore && (
            <Link
              href={preserveQuery({ connectedBefore: accepted[accepted.length - 1].id })}
              className="block rounded-lg border border-line px-4 py-2.5 text-center text-sm font-medium hover:border-accent hover:text-accent"
            >
              Load more
            </Link>
          )}
        </div>
      </section>
    </div>
  );
}
