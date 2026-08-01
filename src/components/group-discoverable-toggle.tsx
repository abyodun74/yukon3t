"use client";

import { useState, useTransition } from "react";
import { setGroupDiscoverable } from "@/app/actions/messages";

export function GroupDiscoverableToggle({
  conversationId,
  discoverable: initialDiscoverable,
}: {
  conversationId: string;
  discoverable: boolean;
}) {
  const [discoverable, setDiscoverable] = useState(initialDiscoverable);
  const [isPending, startTransition] = useTransition();

  function toggle() {
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
      {discoverable ? "Discoverable" : "Not discoverable"}
    </button>
  );
}
