import { UserLink } from "@/components/user-link";
import { TrustBadge } from "@/components/trust-badge";
import { ConnectButton } from "@/components/connect-button";
import { intentTagValues } from "@/lib/validations";

type IntentTag = (typeof intentTagValues)[number];

type Item = {
  person: {
    id: string;
    name: string | null;
    username: string | null;
    avatarUrl: string | null;
    trustBand: string;
    openToIntents: IntentTag[];
  };
  mutualCount: number;
  connectionStatus: "PENDING" | "ACCEPTED" | "DECLINED" | null;
  isRequester: boolean;
  conversationId: string | null;
};

/** A horizontal row of mutual-connection-based suggestions — see getPeopleYouMayKnow (actions/discover.ts). Renders nothing if there's nothing to suggest, rather than an empty section header. */
export function PeopleYouMayKnow({ items }: { items: Item[] }) {
  if (items.length === 0) return null;

  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold">People you may know</h2>
      <div className="mt-3 flex gap-3 overflow-x-auto pb-2">
        {items.map(({ person, mutualCount, connectionStatus, isRequester, conversationId }) => (
          <div
            key={person.id}
            className="animate-rise-in w-48 shrink-0 rounded-xl border border-line p-3"
          >
            <div className="flex items-center justify-between gap-1">
              <UserLink
                userId={person.id}
                name={person.name}
                username={person.username}
                avatarUrl={person.avatarUrl}
                avatarSize={32}
                showUsername={false}
                className="min-w-0 font-semibold"
              />
              <TrustBadge band={person.trustBand} />
            </div>
            <p className="mt-2 text-xs text-foreground-soft">
              {mutualCount} mutual connection{mutualCount === 1 ? "" : "s"}
            </p>
            <div className="mt-3">
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
      </div>
    </div>
  );
}
