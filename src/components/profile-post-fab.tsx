"use client";

import { Plus } from "lucide-react";
import { ScrollFab } from "@/components/scroll-fab";

function focusComposer() {
  const target = document.getElementById("profile-composer");
  target?.scrollIntoView({ behavior: "smooth", block: "center" });
  window.setTimeout(() => target?.querySelector("textarea")?.focus(), 300);
}

/**
 * Appears once #profile-composer scrolls out of view — same pattern as
 * CirclePostFab. Only ever rendered on the viewer's own profile (see
 * src/app/u/[userId]/page.tsx — #profile-composer itself only exists there
 * too, gated on isOwnProfile), so ScrollFab's observer never has a target
 * to find on someone else's profile and this component simply renders
 * nothing rather than needing its own ownership check.
 */
export function ProfilePostFab() {
  return (
    <ScrollFab
      hideWhileVisibleId="profile-composer"
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
