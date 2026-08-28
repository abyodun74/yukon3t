"use client";

import { TrustBadge } from "@/components/trust-badge";
import { UserLink } from "@/components/user-link";
import { SubscribeButton } from "@/components/subscribe-button";
import { useInfiniteScroll } from "@/lib/use-infinite-scroll";
import { loadMoreSubscribers, loadMoreSubscribing } from "@/app/actions/subscriptions";

type SubscriptionUser = {
  id: string;
  name: string | null;
  username: string | null;
  avatarUrl: string | null;
  trustBand: string;
};

type SubscriptionItem = { id: string; user: SubscriptionUser; subscribedByViewer: boolean };

function SubscriptionRows({
  items,
  hasMore,
  loading,
  sentinelRef,
  viewerId,
}: {
  items: SubscriptionItem[];
  hasMore: boolean;
  loading: boolean;
  sentinelRef: React.RefObject<HTMLDivElement | null>;
  viewerId: string;
}) {
  return (
    <>
      {items.map((r) => (
        <div key={r.id} className="animate-rise-in flex items-center justify-between gap-2 rounded-xl border border-line p-4">
          <div className="flex min-w-0 items-center gap-2">
            <UserLink userId={r.user.id} name={r.user.name} username={r.user.username} avatarUrl={r.user.avatarUrl} />
            <TrustBadge band={r.user.trustBand} />
          </div>
          {r.user.id !== viewerId && (
            <SubscribeButton targetId={r.user.id} initiallySubscribed={r.subscribedByViewer} variant="pill" />
          )}
        </div>
      ))}
      {hasMore && (
        <div ref={sentinelRef} className="flex justify-center py-2">
          {loading && <span className="animate-loading-pulse text-xs text-foreground-soft">Loading more...</span>}
        </div>
      )}
    </>
  );
}

export function SubscribersList({
  profileUserId,
  initialItems,
  initialHasMore,
  viewerId,
}: {
  profileUserId: string;
  initialItems: SubscriptionItem[];
  initialHasMore: boolean;
  viewerId: string;
}) {
  const { items, hasMore, loading, sentinelRef } = useInfiniteScroll({
    initialItems,
    initialHasMore,
    loadMore: (cursor) => loadMoreSubscribers(profileUserId, cursor),
    getCursor: (item) => item.id,
  });

  if (items.length === 0) return <p className="text-sm text-foreground-soft">No subscribers yet.</p>;

  return <SubscriptionRows items={items} hasMore={hasMore} loading={loading} sentinelRef={sentinelRef} viewerId={viewerId} />;
}

export function SubscribingList({
  profileUserId,
  initialItems,
  initialHasMore,
  viewerId,
}: {
  profileUserId: string;
  initialItems: SubscriptionItem[];
  initialHasMore: boolean;
  viewerId: string;
}) {
  const { items, hasMore, loading, sentinelRef } = useInfiniteScroll({
    initialItems,
    initialHasMore,
    loadMore: (cursor) => loadMoreSubscribing(profileUserId, cursor),
    getCursor: (item) => item.id,
  });

  if (items.length === 0) return <p className="text-sm text-foreground-soft">Not subscribed to anyone yet.</p>;

  return <SubscriptionRows items={items} hasMore={hasMore} loading={loading} sentinelRef={sentinelRef} viewerId={viewerId} />;
}
