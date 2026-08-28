"use client";

import Link from "next/link";
import { ConnectionResponseButtons } from "@/components/connection-response-buttons";
import { TrustBadge } from "@/components/trust-badge";
import { UserLink } from "@/components/user-link";
import { intentLabels, intentTagValues } from "@/lib/validations";
import { isOnline } from "@/lib/presence";
import { useInfiniteScroll } from "@/lib/use-infinite-scroll";
import {
  loadMoreIncomingConnections,
  loadMoreSentConnections,
  loadMoreAcceptedConnections,
} from "@/app/actions/connections";

type IntentTag = (typeof intentTagValues)[number];

type ConnectionUser = {
  id: string;
  name: string | null;
  username: string | null;
  avatarUrl: string | null;
  trustBand: string;
  lastSeenAt: Date | null;
};

function LoadingSentinel({ sentinelRef, loading }: { sentinelRef: React.RefObject<HTMLDivElement | null>; loading: boolean }) {
  return (
    <div ref={sentinelRef} className="flex justify-center py-2">
      {loading && <span className="animate-loading-pulse text-xs text-foreground-soft">Loading more...</span>}
    </div>
  );
}

export function IncomingRequestsList({
  initialItems,
  initialHasMore,
}: {
  initialItems: { id: string; requester: ConnectionUser; intentTag: IntentTag }[];
  initialHasMore: boolean;
}) {
  const { items, hasMore, loading, sentinelRef } = useInfiniteScroll({
    initialItems,
    initialHasMore,
    loadMore: loadMoreIncomingConnections,
    getCursor: (item) => item.id,
  });

  if (items.length === 0) {
    return <p className="text-sm text-foreground-soft">No pending requests.</p>;
  }

  return (
    <>
      {items.map((c) => (
        <div key={c.id} className="animate-rise-in flex items-center justify-between gap-2 rounded-xl border border-line p-4">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <UserLink
                userId={c.requester.id}
                name={c.requester.name}
                username={c.requester.username}
                avatarUrl={c.requester.avatarUrl}
                online={isOnline(c.requester.lastSeenAt)}
              />
              <TrustBadge band={c.requester.trustBand} />
            </div>
            <p className="text-xs text-foreground-soft">wants to connect for {intentLabels[c.intentTag]}</p>
          </div>
          <ConnectionResponseButtons connectionId={c.id} />
        </div>
      ))}
      {hasMore && <LoadingSentinel sentinelRef={sentinelRef} loading={loading} />}
    </>
  );
}

export function SentRequestsList({
  initialItems,
  initialHasMore,
}: {
  initialItems: { id: string; target: ConnectionUser; intentTag: IntentTag }[];
  initialHasMore: boolean;
}) {
  const { items, hasMore, loading, sentinelRef } = useInfiniteScroll({
    initialItems,
    initialHasMore,
    loadMore: loadMoreSentConnections,
    getCursor: (item) => item.id,
  });

  if (items.length === 0) {
    return <p className="text-sm text-foreground-soft">No pending sent requests.</p>;
  }

  return (
    <>
      {items.map((c) => (
        <div key={c.id} className="animate-rise-in rounded-xl border border-line p-4">
          <div className="flex items-center gap-2">
            <UserLink
              userId={c.target.id}
              name={c.target.name}
              username={c.target.username}
              avatarUrl={c.target.avatarUrl}
              online={isOnline(c.target.lastSeenAt)}
            />
            <TrustBadge band={c.target.trustBand} />
          </div>
          <p className="text-xs text-foreground-soft">{intentLabels[c.intentTag]} — awaiting response</p>
        </div>
      ))}
      {hasMore && <LoadingSentinel sentinelRef={sentinelRef} loading={loading} />}
    </>
  );
}

export function ConnectedList({
  initialItems,
  initialHasMore,
}: {
  initialItems: { id: string; other: ConnectionUser; intentTag: IntentTag; conversationId: string | null }[];
  initialHasMore: boolean;
}) {
  const { items, hasMore, loading, sentinelRef } = useInfiniteScroll({
    initialItems,
    initialHasMore,
    loadMore: loadMoreAcceptedConnections,
    getCursor: (item) => item.id,
  });

  if (items.length === 0) {
    return <p className="text-sm text-foreground-soft">No connections yet.</p>;
  }

  return (
    <>
      {items.map((c) => (
        <div key={c.id} className="animate-rise-in flex items-center justify-between gap-2 rounded-xl border border-line p-4">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <UserLink
                userId={c.other.id}
                name={c.other.name}
                username={c.other.username}
                avatarUrl={c.other.avatarUrl}
                online={isOnline(c.other.lastSeenAt)}
              />
              <TrustBadge band={c.other.trustBand} />
            </div>
            <span className="text-xs text-foreground-soft">{intentLabels[c.intentTag]}</span>
          </div>
          {c.conversationId && (
            <Link
              href={`/messages/${c.conversationId}`}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink"
            >
              Message
            </Link>
          )}
        </div>
      ))}
      {hasMore && <LoadingSentinel sentinelRef={sentinelRef} loading={loading} />}
    </>
  );
}
