"use client";

import { TrustBadge } from "@/components/trust-badge";
import { ConnectButton } from "@/components/connect-button";
import { UserLink } from "@/components/user-link";
import { intentLabels, intentTagValues } from "@/lib/validations";
import { isOnline } from "@/lib/presence";
import { useInfiniteScroll } from "@/lib/use-infinite-scroll";
import { loadMoreDiscoverPeople } from "@/app/actions/discover";

// Matches loadMoreDiscoverPeople's own PAGE_SIZE (src/app/actions/discover.ts).
const PAGE_SIZE = 30;

type IntentTag = (typeof intentTagValues)[number];

type DiscoverPerson = {
  id: string;
  name: string | null;
  username: string | null;
  avatarUrl: string | null;
  country: string | null;
  bio: string | null;
  trustBand: string;
  lastSeenAt: Date | null;
  openToIntents: IntentTag[];
};

type DiscoverItem = {
  person: DiscoverPerson;
  connectionStatus: "PENDING" | "ACCEPTED" | "DECLINED" | null;
  isRequester: boolean;
  conversationId: string | null;
};

export function DiscoverPeopleList({
  initialItems,
  initialHasMore,
  intent,
  country,
  sort,
}: {
  initialItems: DiscoverItem[];
  initialHasMore: boolean;
  intent?: string;
  country?: string;
  sort: string;
}) {
  const { items, hasMore, loading, sentinelRef } = useInfiniteScroll({
    initialItems,
    initialHasMore,
    loadMore: (cursor) => loadMoreDiscoverPeople(cursor, { intent, country, sort }),
    getCursor: (_item, index) => String(Math.floor((index + 1) / PAGE_SIZE) + 1),
  });

  return (
    <>
      {items.map(({ person, connectionStatus, isRequester, conversationId }) => (
        <div key={person.id} className="animate-rise-in min-w-0 rounded-xl border border-line p-4">
          <div className="flex min-w-0 items-center justify-between">
            <UserLink
              userId={person.id}
              name={person.name}
              username={person.username}
              avatarUrl={person.avatarUrl}
              avatarSize={28}
              className="font-semibold"
              online={isOnline(person.lastSeenAt)}
            />
            <TrustBadge band={person.trustBand} />
          </div>
          <p className="mt-1 text-xs text-foreground-soft">{person.country ?? "Unknown location"}</p>
          {person.bio && (
            <p className="mt-2 line-clamp-3 break-words text-sm text-foreground-soft">{person.bio}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-1">
            {person.openToIntents.map((tag) => (
              <span key={tag} className="rounded-full bg-teal/10 px-2 py-0.5 text-[11px] text-teal">
                {intentLabels[tag]}
              </span>
            ))}
          </div>
          <div className="mt-4">
            <ConnectButton
              targetId={person.id}
              openToIntents={person.openToIntents}
              status={connectionStatus}
              isRequester={isRequester}
              conversationId={conversationId}
            />
          </div>
        </div>
      ))}
      {items.length === 0 && (
        <p className="text-sm text-foreground-soft">
          {sort === "online"
            ? "No one matching those filters is online right now — try again in a bit."
            : "No one matches those filters yet — try broadening them."}
        </p>
      )}
      {hasMore && (
        <div ref={sentinelRef} className="col-span-full flex justify-center py-4">
          {loading && <span className="animate-loading-pulse text-xs text-foreground-soft">Loading more...</span>}
        </div>
      )}
    </>
  );
}
