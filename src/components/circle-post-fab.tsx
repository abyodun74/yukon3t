"use client";

import { Plus } from "lucide-react";
import { ScrollFab } from "@/components/scroll-fab";

function focusComposer() {
  const target = document.getElementById("circle-composer");
  target?.scrollIntoView({ behavior: "smooth", block: "center" });
  window.setTimeout(() => target?.querySelector("textarea")?.focus(), 300);
}

/**
 * Appears once #circle-composer scrolls out of view. If the active channel
 * is voice-only or the viewer can't post, that element never renders at
 * all (see circles/[slug]/page.tsx) — ScrollFab's observer just no-ops in
 * that case, so this stays hidden rather than needing its own "can post"
 * prop threaded through from the page.
 */
export function CirclePostFab() {
  return (
    <ScrollFab
      hideWhileVisibleId="circle-composer"
      actions={[
        {
          key: "new-post",
          label: "New post",
          icon: <Plus size={24} />,
          iconClassName: "bg-accent text-accent-ink",
          onSelect: focusComposer,
        },
      ]}
    />
  );
}
