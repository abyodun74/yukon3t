"use client";

import { useState } from "react";
import { IncomingRequestsList, SentRequestsList, ConnectedList } from "@/components/connections-lists";
import { cn } from "@/lib/utils";
import type { intentTagValues } from "@/lib/validations";
import type { pagesEn } from "@/lib/i18n/en/pages";
import { format } from "@/lib/i18n/locales";

type IntentTag = (typeof intentTagValues)[number];

type ConnectionUser = {
  id: string;
  name: string | null;
  username: string | null;
  avatarUrl: string | null;
  trustBand: string;
  lastSeenAt: Date | null;
};

type Tab = "connected" | "incoming" | "sent";

/**
 * Connected is the default (and, before this, only reachable-by-default)
 * view — Incoming/Sent requests moved behind a toggle rather than off the
 * page entirely, since accepting/declining an incoming request has no
 * other UI anywhere in the app (the notification bell just links back
 * here). Counts come from the page's own exact prisma.connection.count()
 * calls, not initialItems.length, since that's capped at PAGE_SIZE and
 * would silently undercount once a list has more than one page.
 */
export function ConnectionsTabs({
  connected,
  incoming,
  sent,
  currentUserId,
  labels,
}: {
  connected: {
    items: { id: string; other: ConnectionUser; intentTag: IntentTag; conversationId: string | null }[];
    hasMore: boolean;
  };
  incoming: {
    items: { id: string; requester: ConnectionUser; intentTag: IntentTag }[];
    hasMore: boolean;
    count: number;
  };
  sent: {
    items: { id: string; target: ConnectionUser; intentTag: IntentTag }[];
    hasMore: boolean;
    count: number;
  };
  currentUserId: string;
  labels: typeof pagesEn.connections;
}) {
  const [tab, setTab] = useState<Tab>("connected");

  const tabs: { key: Tab; label: string }[] = [
    { key: "connected", label: labels.connected },
    { key: "incoming", label: incoming.count > 0 ? format(labels.incomingCount, { count: incoming.count }) : labels.incoming },
    { key: "sent", label: sent.count > 0 ? format(labels.sentCount, { count: sent.count }) : labels.sent },
  ];

  return (
    <div>
      <div role="tablist" aria-label={labels.tabsLabel} className="flex gap-1.5 border-b border-line pb-3">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              tab === t.key ? "border-accent bg-accent-soft text-accent" : "border-line text-foreground-soft",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-4 space-y-3">
        {tab === "connected" && (
          <ConnectedList
            initialItems={connected.items}
            initialHasMore={connected.hasMore}
            currentUserId={currentUserId}
            labels={labels}
          />
        )}
        {tab === "incoming" && <IncomingRequestsList initialItems={incoming.items} initialHasMore={incoming.hasMore} labels={labels} />}
        {tab === "sent" && <SentRequestsList initialItems={sent.items} initialHasMore={sent.hasMore} labels={labels} />}
      </div>
    </div>
  );
}
