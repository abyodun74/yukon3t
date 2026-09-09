"use client";

import { Plus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { ScrollFab } from "@/components/scroll-fab";

/**
 * Appears once the inbox header (#messages-header — with its own "New
 * group"/"Discover groups" links) scrolls out of view in a long inbox.
 * Mirrors those same two entry points rather than inventing new ones.
 */
export function MessagesQuickActions() {
  const router = useRouter();

  return (
    <ScrollFab
      hideWhileVisibleId="messages-header"
      actions={[
        {
          key: "discover-groups",
          label: "Discover groups",
          icon: <Users size={16} />,
          iconClassName: "bg-teal text-white",
          onSelect: () => router.push("/messages/discover"),
        },
        {
          key: "new-group",
          label: "New group",
          icon: <Plus size={16} />,
          iconClassName: "bg-accent text-accent-ink",
          onSelect: () => router.push("/messages/new"),
        },
      ]}
    />
  );
}
