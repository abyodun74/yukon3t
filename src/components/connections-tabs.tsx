"use client";

import { useState } from "react";
import { IncomingRequestsList, SentRequestsList, ConnectedList } from "@/components/connections-lists";
import { cn } from "@/lib/utils";
import type { intentTagValues } from "@/lib/validations";

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
}) {
  const [tab, setTab] = useState<Tab>("connected");

  const tabs: { key: Tab; label: string }[] = [
    { key: "connected", label: "Connected" },
    { key: "incoming", label: incoming.count > 0 ? `Incoming (${incoming.count})` : "Incoming" },
    { key: "sent", label: sent.count > 0 ? `Sent (${sent.count})` : "Sent" },
  ];

  return (
    <div>
      <div className="flex gap-1.5 border-b border-line pb-3">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
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
        {tab === "connected" && <ConnectedList initialItems={connected.items} initialHasMore={connected.hasMore} />}
        {tab === "incoming" && <IncomingRequestsList initialItems={incoming.items} initialHasMore={incoming.hasMore} />}
        {tab === "sent" && <SentRequestsList initialItems={sent.items} initialHasMore={sent.hasMore} />}
      </div>
    </div>
  );
}
