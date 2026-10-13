"use client";

import { Plus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { ScrollFab } from "@/components/scroll-fab";
import { useMessagesText } from "@/components/messages-text";

/**
 * Appears once the inbox header (#messages-header — with its own "New
 * group"/"Discover groups" links) scrolls out of view in a long inbox.
 * Mirrors those same two entry points rather than inventing new ones.
 */
export function MessagesQuickActions() {
  const router = useRouter();
  const { t } = useMessagesText();

  return (
    <ScrollFab
      hideWhileVisibleId="messages-header"
      actions={[
        {
          key: "discover-groups",
          label: t.inbox.discoverGroups,
          icon: <Users size={16} />,
          iconClassName: "bg-teal text-white",
          onSelect: () => router.push("/messages/discover"),
        },
        {
          key: "new-group",
          label: t.inbox.newGroup,
          icon: <Plus size={16} />,
          iconClassName: "bg-accent text-accent-ink",
          onSelect: () => router.push("/messages/new"),
        },
      ]}
    />
  );
}
