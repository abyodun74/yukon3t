"use client";

import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { ScrollFab } from "@/components/scroll-fab";

/**
 * Always shown (no hideWhileVisibleId) — unlike Home/Circles/Profile,
 * this page has nothing else on it offering the same shortcut to hide
 * against, and a new user's empty "No connections yet" Connections page
 * is exactly when they'd want this most, which a scroll-to-reveal FAB
 * would never surface on a page too short to scroll. The single action
 * jumps to /discover ("Discover people" — see src/app/discover/page.tsx),
 * the actual find-new-people flow.
 */
export function ConnectionsFindPeopleFab() {
  const router = useRouter();

  return (
    <ScrollFab
      actions={[
        {
          key: "find-people",
          label: "Find people",
          icon: <UserPlus size={20} />,
          iconClassName: "bg-accent text-accent-ink",
          onSelect: () => router.push("/discover"),
        },
      ]}
    />
  );
}
