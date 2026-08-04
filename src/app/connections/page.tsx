import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { ConnectionResponseButtons } from "@/components/connection-response-buttons";
import { TrustBadge } from "@/components/trust-badge";
import Link from "next/link";
import { intentLabels } from "@/lib/validations";

export default async function ConnectionsPage() {
  const me = await getOnboardedUserOrRedirect();

  const [incoming, outgoing, accepted, myConversations] = await Promise.all([
    prisma.connection.findMany({
      where: { targetId: me.id, status: "PENDING" },
      include: { requester: { select: { id: true, name: true, trustBand: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.connection.findMany({
      where: { requesterId: me.id, status: "PENDING" },
      include: { target: { select: { id: true, name: true, trustBand: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.connection.findMany({
      where: {
        status: "ACCEPTED",
        OR: [{ requesterId: me.id }, { targetId: me.id }],
      },
      include: {
        requester: { select: { id: true, name: true, trustBand: true } },
        target: { select: { id: true, name: true, trustBand: true } },
      },
      orderBy: { respondedAt: "desc" },
    }),
    // Maps each connected user to their shared conversation, so "Connected"
    // can link straight into the chat instead of just the profile. Only
    // needs me.id, so it runs alongside the other three instead of after.
    prisma.conversation.findMany({
      where: { members: { some: { userId: me.id } } },
      include: { members: { select: { userId: true } } },
    }),
  ]);
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
          {incoming.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between rounded-xl border border-line p-4"
            >
              <div>
                <div className="flex items-center gap-2">
                  <Link href={`/u/${c.requester.id}`} className="font-medium hover:text-accent">
                    {c.requester.name}
                  </Link>
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
                <Link href={`/u/${c.target.id}`} className="font-medium hover:text-accent">
                  {c.target.name}
                </Link>
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
                    <Link href={`/u/${other.id}`} className="font-medium hover:text-accent">
                      {other.name}
                    </Link>
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
        </div>
      </section>
    </div>
  );
}
