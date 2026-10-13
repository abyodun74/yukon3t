"use client";

import { useState, useTransition } from "react";
import { setGroupDiscoverable } from "@/app/actions/messages";
import { hapticSelection } from "@/lib/haptics";
import { useMessagesText } from "@/components/messages-text";

export function GroupDiscoverableToggle({
  conversationId,
  discoverable: initialDiscoverable,
}: {
  conversationId: string;
  discoverable: boolean;
}) {
  const [discoverable, setDiscoverable] = useState(initialDiscoverable);
  const [isPending, startTransition] = useTransition();
  const t = useMessagesText().t.group;

  function toggle() {
    hapticSelection();
    const next = !discoverable;
    setDiscoverable(next);
    startTransition(async () => {
      const result = await setGroupDiscoverable(conversationId, next);
      if (result.error) setDiscoverable(!next);
    });
  }

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={toggle}
      className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-foreground-soft hover:border-accent hover:text-accent disabled:opacity-50"
    >
      {discoverable ? t.discoverable : t.notDiscoverable}
    </button>
  );
}
